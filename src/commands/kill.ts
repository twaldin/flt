import { getAgent, removeAgent, loadState } from '../state'
import { removeWorktree } from '../worktree'
import { restoreInstructions } from '../instructions'
import { cleanupSkills } from '../skills'
import { resolveAdapter } from '../adapters/registry'
import * as tmux from '../tmux'
import { execSync, execFileSync } from 'child_process'

interface KillArgs {
  name: string
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

export function killDirect(args: KillArgs): void {
  const { name } = args
  const agent = getAgent(name)

  if (!agent) {
    throw new Error(`Agent "${name}" not found.`)
  }

  // Kill the process tree
  const panePid = tmux.getPanePid(agent.tmuxSession)
  if (panePid) {
    killProcessTree(panePid)
  }

  // Kill tmux session
  tmux.killSession(agent.tmuxSession)

  // Clean up worktree
  if (agent.worktreePath && agent.worktreeBranch) {
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
    const adapter = resolveAdapter(agent.cli)
    if (adapter.instructionFile) {
      restoreInstructions(agent.dir, adapter.instructionFile)
    }
    cleanupSkills(agent.dir, adapter, name)
  } catch {
    // Best-effort
  }

  // Remove from state
  removeAgent(name)

  if (!process.env.FLT_TUI_ACTIVE) {
    console.log(`Killed ${name}`)
  }
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
