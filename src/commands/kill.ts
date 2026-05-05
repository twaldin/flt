import { getAgent, removeAgent, loadState } from '../state'
import { removeWorktree } from '../worktree'
import * as tmux from '../tmux'
import { execSync, execFileSync } from 'child_process'
import { appendEvent } from '../activity'
import { resolveRemote } from '../remotes'
import { shellEscapeSingle, sshExec } from '../ssh'

interface KillArgs {
  name: string
  preserveWorktree?: boolean
  // Set by the workflow engine when it kills its own agents (step completion,
  // retry, cancel). Suppresses the cancelWorkflow cascade so engine-initiated
  // kills don't nuke the run they belong to. External `flt kill` leaves this
  // false so user-triggered kills still cancel the workflow as intended.
  fromWorkflow?: boolean
}

export async function kill(args: KillArgs): Promise<void> {
  if (process.env.FLT_CONTROLLER !== '1') {
    const { ensureController } = await import('./controller')
    const { sendToController } = await import('../controller/client')
    await ensureController()
    const result = await sendToController({ action: 'kill', args: { name: args.name } })
    if (!result.ok) throw new Error(result.error ?? 'Kill failed')
    if (!process.env.FLT_TUI_ACTIVE) console.log(result.data)
    return
  }
  return killDirect(args)
}

interface WorkflowEngineNotifier {
  getWorkflowForAgent: (name: string) => string | null
  handleStepFailure: (workflowId: string) => Promise<void>
}

export async function notifyEngineOfKill(
  name: string,
  fromWorkflow: boolean | undefined,
  engine?: WorkflowEngineNotifier,
): Promise<void> {
  if (fromWorkflow) return

  try {
    const resolvedEngine = engine
      ?? (require('../workflow/engine') as typeof import('../workflow/engine'))
    const workflowId = resolvedEngine.getWorkflowForAgent(name)
    if (workflowId) {
      await resolvedEngine.handleStepFailure(workflowId)
    }
  } catch {}
}

export function killDirect(args: KillArgs): void {
  const { name } = args
  const agent = getAgent(name)

  if (!agent) {
    throw new Error(`Agent "${name}" not found.`)
  }

  const isSsh = agent.location?.type === 'ssh'
  let extracted: { cost_usd: number | null, tokens_in: number | null, tokens_out: number | null } | null = null

  if (isSsh) {
    const remote = resolveRemote(agent.location.host)
    const killResult = sshExec(remote, `tmux kill-session -t ${agent.tmuxSession}`)
    if (killResult.status !== 0) {
      throw new Error(killResult.stderr.trim() || `Failed to kill SSH agent "${name}".`)
    }

    if (agent.worktreePath && agent.worktreeBranch && !args.preserveWorktree) {
      try {
        sshExec(
          remote,
          `cd ${shellEscapeSingle(agent.dir)} && git worktree remove --force ${shellEscapeSingle(agent.worktreePath)} && git branch -D ${shellEscapeSingle(agent.worktreeBranch)}`,
        )
      } catch {
        // Best-effort cleanup
      }
    }
  } else {
    // Kill the process tree
    const panePid = tmux.getPanePid(agent.tmuxSession)
    if (panePid) {
      killProcessTree(panePid)
    }

    // Kill tmux session
    tmux.killSession(agent.tmuxSession)

    // Give the agent's CLI a moment to flush its trailing session-log entry
    // before we try to parse it. claude-code receives SIGHUP when tmux dies
    // and may have a half-written final JSONL line otherwise.
    Bun.sleepSync(300)

    // Post-exit: best-effort cost/token extraction via harness parser.
    // Never throws; failure just means no cost data is recorded.
    try {
      const { harnessExtract } = require('../harness') as typeof import('../harness')
      const { appendInbox } = require('./init') as typeof import('./init')
      extracted = harnessExtract({
        cli: agent.cli,
        workdir: agent.dir,
        spawnedAt: agent.spawnedAt,
      })
      if (extracted === null && agent.cli === 'claude-code') {
        appendInbox('WATCHDOG', `no session log for ${name}`)
      }
    } catch {
      // Best-effort
    }

    // Archive the run (even if extraction returned null — we still want a record).
    try {
      const { archiveRun } = require('../harness') as typeof import('../harness')
      archiveRun(
        { name, cli: agent.cli, model: agent.model, dir: agent.dir, spawnedAt: agent.spawnedAt },
        extracted,
      )
    } catch {}

    // Clean up worktree (skip if preserveWorktree — workflow steps need it for next agent)
    if (agent.worktreePath && agent.worktreeBranch && !args.preserveWorktree) {
      // Find the base repo dir — worktree parent
      try {
        const repoDir = execSync('git rev-parse --show-toplevel', {
          cwd: agent.dir,
          encoding: 'utf-8',
          timeout: 5000,
        }).trim()
        removeWorktree(repoDir, agent.worktreePath, agent.worktreeBranch)
      } catch {
        // Best-effort cleanup
      }
    }

    // Restore instruction file backup
    try {
      const { resolveAdapter } = require('../adapters/registry') as typeof import('../adapters/registry')
      const { restoreInstructions } = require('../instructions') as typeof import('../instructions')
      const { cleanupSkills } = require('../skills') as typeof import('../skills')
      const adapter = resolveAdapter(agent.cli)
      if (agent.instructionProjection) {
        restoreInstructions(agent.instructionProjection)
      }
      cleanupSkills(agent.dir, adapter)
    } catch {
      // Best-effort
    }
  }

  // Notify workflow engine for external kills so it can apply normal
  // step-failure handling. Engine-initiated kills set fromWorkflow and skip.
  notifyEngineOfKill(name, args.fromWorkflow).catch(() => {})

  // Remove from state + clean up poller tracking
  removeAgent(name)
  try {
    const { cleanupAgent } = require('../controller/poller') as typeof import('../controller/poller')
    cleanupAgent(name)
  } catch {}

  appendEvent({
    type: 'kill',
    agent: name,
    detail: 'killed',
    at: new Date().toISOString(),
    cost_usd: extracted?.cost_usd ?? null,
    tokens_in: extracted?.tokens_in ?? null,
    tokens_out: extracted?.tokens_out ?? null,
  })

  if (!process.env.FLT_TUI_ACTIVE) {
    const costLine = extracted
      ? formatCostLine(extracted)
      : ''
    console.log(`Killed ${name}${costLine}`)
  }
}

function formatCostLine(r: { cost_usd: number | null, tokens_in: number | null, tokens_out: number | null }): string {
  const parts: string[] = []
  if (r.tokens_in != null || r.tokens_out != null) {
    parts.push(`tokens=${r.tokens_in ?? '?'}/${r.tokens_out ?? '?'}`)
  }
  if (r.cost_usd != null) {
    parts.push(`cost=$${r.cost_usd.toFixed(4)}`)
  }
  return parts.length > 0 ? `  (${parts.join(' ')})` : ''
}

function killProcessTree(pid: number): void {
  // Get all child PIDs
  const children = getChildPids(pid)

  // Kill children depth-first
  for (const child of children.reverse()) {
    try { process.kill(child, 'SIGTERM') } catch {}
  }

  // Kill parent
  try { process.kill(pid, 'SIGTERM') } catch {}

  // Wait briefly, then SIGKILL any survivors
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    const alive = [pid, ...children].some(p => {
      try { process.kill(p, 0); return true } catch { return false }
    })
    if (!alive) return
    Bun.sleepSync(100)
  }

  for (const p of [pid, ...children]) {
    try { process.kill(p, 'SIGKILL') } catch {}
  }
}

function getChildPids(pid: number): number[] {
  try {
    const out = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf-8', timeout: 3000 })
    const pids = out.trim().split('\n').map(Number).filter(n => !isNaN(n))
    const grandchildren = pids.flatMap(p => getChildPids(p))
    return [...pids, ...grandchildren]
  } catch {
    return []
  }
}
