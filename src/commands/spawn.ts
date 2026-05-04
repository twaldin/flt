import { resolveAdapter } from '../adapters/registry'
import { projectInstructions } from '../instructions'
import type { InstructionProjection } from '../instructions'
import { projectSkills } from '../skills'
import { createWorktree, isGitRepo } from '../worktree'
import { loadState, setAgent, hasAgent } from '../state'
import type { AgentState } from '../state'
import { getPreset, resolvePresetEnv } from '../presets'
import * as tmux from '../tmux'
import { join, resolve } from 'path'
import { homedir } from 'os'
import { createInterface } from 'node:readline'
import { appendEvent } from '../activity'
import { resolveModelForCli } from '../model-resolution'
import { deliver, deliverKeys } from '../delivery'

interface SpawnArgs {
  name: string
  cli?: string
  model?: string
  preset?: string
  dir?: string
  worktree?: boolean
  /** Pin the new worktree to this exact git ref (branch name or SHA). */
  worktreeBase?: string
  bootstrap?: string
  parent?: string
  persistent?: boolean
  ephemeral?: boolean
  skills?: string[]
  allSkills?: boolean
  noModelResolve?: boolean
  workflow?: string
  workflowStep?: string
  /** Project root for sidebar `wt:` display. Workflow engine passes
   * run.vars._input.dir; manual spawns inherit baseDir. */
  projectRoot?: string
  extraEnv?: Record<string, string>
  _callerName?: string
  _callerDepth?: number
  _termWidth?: number
  _termHeight?: number
}

const CLAUDE_CODE_TIER_ENV_KEYS = {
  sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
} as const

function resolveDisplayedModel(
  cli: string,
  resolvedModel: string | undefined,
  presetModel: string | undefined,
  presetEnv: Record<string, string>,
): string {
  const cliModel = resolvedModel ?? 'default'
  if (cli !== 'claude-code' || !presetModel || !resolvedModel) return cliModel

  const presetTier = presetModel.trim().toLowerCase() as keyof typeof CLAUDE_CODE_TIER_ENV_KEYS
  const envKey = CLAUDE_CODE_TIER_ENV_KEYS[presetTier]
  if (!envKey) return cliModel

  // Only map to env override when we're actually using the preset's tier model,
  // not when caller passed an explicit model override.
  if (resolvedModel.trim().toLowerCase() !== presetTier) return cliModel

  const envModel = presetEnv[envKey]?.trim()
  return envModel || cliModel
}

export function isDangerousWorkdir(dir: string): boolean {
  const h = process.env.HOME || homedir()
  const norm = dir.endsWith('/') ? dir.slice(0, -1) : dir

  if (norm === h) return true
  // dir is a parent of HOME (e.g. /Users would be a parent of /Users/foo)
  if (h.startsWith(norm + '/')) return true

  for (const dot of ['.claude', '.codex', '.opencode', '.gemini', '.flt']) {
    const dotPath = join(h, dot)
    if (norm === dotPath || norm.startsWith(dotPath + '/')) {
      if (dot === '.flt') {
        const agentsPrefix = `${dotPath}/agents/`
        if (norm.startsWith(agentsPrefix)) {
          const remainder = norm.slice(agentsPrefix.length)
          const [agentName] = remainder.split('/')
          if (agentName) return false
        }
      }
      return true
    }
  }

  for (const root of ['/', '/etc', '/usr', '/System', '/Library']) {
    if (norm === root || (root !== '/' && norm.startsWith(root + '/'))) return true
  }

  return false
}

export async function confirmDangerousWorkdir(dir: string): Promise<boolean> {
  if (process.env.FLT_TUI_ACTIVE === '1') {
    process.stderr.write(`flt: refusing to spawn into dangerous workdir under TUI: ${dir}\n`)
    return false
  }

  process.stderr.write(
    `WARNING: Spawning into ${dir} may leak skills/state into your global CLI config. Continue? (y/N): `,
  )
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin })
    rl.once('line', line => {
      rl.close()
      resolve(line.trim().toLowerCase() === 'y')
    })
    rl.once('close', () => resolve(false))
  })
}

function buildIsolationEnv(_cli: string, _workDir: string): Record<string, string> {
  // No env override. Claude-code's CLAUDE_CONFIG_DIR override hid the user's
  // OAuth login. Opencode's XDG_CONFIG_HOME override hid its provider config.
  // After `flt skill move-from-claude` + `flt plugin uninstall`, the user's
  // global skill set is small enough that we don't need env-level isolation —
  // the per-cli skill copy into <workdir>/.claude/skills/ (or .opencode/, or
  // .flt/skills/ mirror + instruction-list) is sufficient. The agent gets
  // exactly the skills flt selected plus whatever the user keeps globally.
  return {}
}

export async function spawn(args: SpawnArgs): Promise<void> {
  // Workdir safety check runs before the controller dispatch so it executes in
  // the user's terminal process where stdin is interactive.
  {
    const effectivePreset = args.preset ?? (getPreset(args.name) ? args.name : undefined)
    const presetDir = effectivePreset ? getPreset(effectivePreset)?.dir : undefined
    const rawDir = args.dir ?? presetDir
    const expanded = rawDir?.startsWith('~')
      ? rawDir.replace(/^~/, process.env.HOME || homedir())
      : rawDir
    const checkDir = resolve(expanded || process.cwd())
    if (isDangerousWorkdir(checkDir)) {
      const confirmed = await confirmDangerousWorkdir(checkDir)
      if (!confirmed) {
        if (!process.env.FLT_TUI_ACTIVE) console.error('Spawn cancelled.')
        return
      }
    }
  }

  if (process.env.FLT_CONTROLLER !== '1') {
    const { ensureController } = await import('./controller')
    const { sendToController } = await import('../controller/client')
    await ensureController()
    // Capture caller context here and pass through RPC
    const result = await sendToController({
      action: 'spawn',
      args: {
        ...args,
        _callerName: process.env.FLT_AGENT_NAME,
        _callerDepth: parseInt(process.env.FLT_DEPTH ?? '0', 10),
        _termWidth: process.stdout.columns,
        _termHeight: process.stdout.rows,
      },
    })
    if (!result.ok) throw new Error(result.error ?? 'Spawn failed')
    if (!process.env.FLT_TUI_ACTIVE) console.log(result.data)
    return
  }
  return spawnDirect(args)
}

export async function spawnDirect(args: SpawnArgs): Promise<void> {
  const {
    name,
    cli: explicitCli,
    model,
    preset,
    dir: rawDir,
    worktree = true,
    bootstrap,
    extraEnv,
  } = args

  let cli = explicitCli
  let resolvedModel = model

  // Auto-detect name → preset: if no --preset flag but a preset with the same name exists, use it
  const effectivePreset = preset ?? (getPreset(name) ? name : undefined)

  let presetSoul: string | undefined
  let presetModel: string | undefined
  let presetDir: string | undefined
  let presetParent: string | undefined
  let presetWorktree: boolean | undefined
  let presetPersistent: boolean | undefined
  let presetEnv: Record<string, string> = {}
  let presetSkills: string[] | undefined
  let presetAllSkills: boolean | undefined
  if (effectivePreset) {
    const presetConfig = getPreset(effectivePreset)
    if (!presetConfig) {
      throw new Error(`Preset "${effectivePreset}" does not exist. Use "flt presets list".`)
    }
    cli = cli ?? presetConfig.cli
    resolvedModel = resolvedModel ?? presetConfig.model
    presetModel = presetConfig.model
    presetSoul = presetConfig.soul
    presetDir = presetConfig.dir
    presetParent = presetConfig.parent
    presetWorktree = presetConfig.worktree
    presetPersistent = presetConfig.persistent
    presetEnv = resolvePresetEnv(presetConfig.env)
    presetSkills = presetConfig.skills
    presetAllSkills = presetConfig.allSkills
  }

  if (!cli) {
    throw new Error('Missing CLI adapter. Provide "--cli <cli>" or "--preset <name>".')
  }

  // Resolve model alias to cli-specific identifier (best-effort).
  // On any failure we keep raw passthrough semantics.
  try {
    resolvedModel = resolveModelForCli(cli, resolvedModel, args.noModelResolve)
  } catch {
    // passthrough
  }

  // Validate name uniqueness
  if (hasAgent(name)) {
    throw new Error(`Agent "${name}" already exists. Use "flt kill ${name}" first.`)
  }

  // Validate name format
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error('Agent name must be alphanumeric with dashes/underscores only.')
  }
  // Refuse very short names — almost always a paste-truncation mishap
  // (e.g. `:spawn p<Enter>` from a stray clipboard fragment that began with
  // "p = subprocess.Popen(...)"). Workflow agents always have multi-segment
  // names, so this only catches manual single-char spawns.
  if (name.length < 3) {
    throw new Error(
      `Agent name "${name}" is too short (min 3 chars). If you meant this, pick a longer name.`,
    )
  }

  const adapter = resolveAdapter(cli)

  // Resolve dir: explicit flag > preset > cwd
  let resolvedDir = rawDir ?? presetDir
  // Expand ~ in dir paths
  if (resolvedDir?.startsWith('~')) {
    resolvedDir = resolvedDir.replace(/^~/, process.env.HOME || require('os').homedir())
  }
  const baseDir = resolve(resolvedDir || process.cwd())

  // Check depth limit
  const state = loadState()
  const callerDepth = args._callerDepth ?? parseInt(process.env.FLT_DEPTH ?? '0', 10)
  if (callerDepth >= state.config.maxDepth) {
    throw new Error(`Max agent depth (${state.config.maxDepth}) reached.`)
  }

  // Determine working directory
  let workDir = baseDir
  let worktreePath: string | undefined
  let worktreeBranch: string | undefined

  // Resolve worktree: explicit --no-worktree flag > preset > default (true)
  const useWorktree = worktree && (presetWorktree !== false)
  if (useWorktree) {
    if (!isGitRepo(baseDir)) {
      throw new Error(`Cannot create worktree: "${baseDir}" is not a git repository.`)
    }
    const wt = createWorktree(baseDir, name, args.worktreeBase)
    workDir = wt.path
    worktreePath = wt.path
    worktreeBranch = wt.branch
  }

  // Hard rule: no two agents in the same workdir. Manifest + skill copies are
  // workdir-scoped; co-tenants would clobber each other on cleanup.
  for (const [otherName, otherAgent] of Object.entries(state.agents ?? {})) {
    if (otherAgent.dir === workDir) {
      throw new Error(
        `Workdir "${workDir}" is already in use by agent "${otherName}". `
        + `Run "flt kill ${otherName}" first, or omit --no-worktree to spawn into a fresh worktree.`,
      )
    }
  }

  // Determine parent: --parent flag > preset > caller agent > 'human'
  const callerName = args._callerName ?? process.env.FLT_AGENT_NAME
  let parentName: string
  if (args.parent) {
    parentName = args.parent
  } else if (presetParent) {
    parentName = presetParent
  } else if (callerName && callerName !== 'cron') {
    parentName = callerName
  } else {
    parentName = 'human'
  }

  // Resolve parent session for env propagation
  const orchSession = state.orchestrator?.tmuxSession ?? 'unknown'
  const parentSession = parentName !== 'human' && tmux.hasSession(`flt-${parentName}`)
    ? `flt-${parentName}`
    : orchSession

  // Project instructions into workspace
  let instructionProjection: InstructionProjection | undefined

  const explicitSkills = args.skills ?? []
  const selectedSkills = explicitSkills.length > 0 ? explicitSkills : (presetSkills ?? [])
  const allSkills = args.allSkills ?? presetAllSkills ?? false

  // Project selected skills into workspace (opt-in only)
  const projectedSkills = projectSkills(workDir, adapter, {
    requested: selectedSkills,
    all: allSkills,
  }) ?? { names: [], warnings: [] }
  for (const warning of projectedSkills.warnings) {
    console.error(`Warning: ${warning}`)
  }

  if (adapter.instructionFile) {
    instructionProjection = projectInstructions(workDir, adapter.instructionFile, {
      agentName: name,
      parentName,
      cli: adapter.name,
      model: resolvedModel ?? 'default',
      workflow: args.workflow,
      step: args.workflowStep,
      presetSoul,
      skillNames: projectedSkills.names,
    })
  }

  // Build spawn command — shell-quote args that contain special chars
  const cliArgs = adapter.spawnArgs({ model: resolvedModel, dir: workDir })
  const command = cliArgs.map(arg =>
    /[[\]{}()*?!$&;|<>'"\\` ~#]/.test(arg) ? `'${arg.replace(/'/g, "'\\''")}'` : arg
  ).join(' ')

  const sessionName = `flt-${name}`

  // Create tmux session with env vars. Preset env takes priority over adapter env
  // because presets are user-level overrides (e.g. swapping claude-code to z.ai).
  const adapterEnv = adapter.env?.() ?? {}
  const isolationEnv = buildIsolationEnv(adapter.name, workDir)
  const mergedPath = presetEnv.PATH ?? adapterEnv.PATH ?? `${process.env.PATH}`
  const initialWidth = args._termWidth ?? process.stdout.columns ?? 80
  const initialHeight = args._termHeight ?? process.stdout.rows ?? 24

  tmux.createSession(sessionName, workDir, command, {
    ...adapterEnv,
    ...isolationEnv,
    ...presetEnv,
    ...extraEnv,
    FLT_AGENT_NAME: name,
    FLT_PARENT_SESSION: parentSession,
    FLT_PARENT_NAME: parentName,
    FLT_DEPTH: String(callerDepth + 1),
    PATH: mergedPath,
  }, initialWidth, initialHeight)

  // Poll for readiness (60s timeout — some CLIs have multiple sequential dialogs)
  await waitForReady(sessionName, adapter, 60_000)

  // Resize to current terminal dimensions so agent doesn't start at tmux's 80x24 default
  const termWidth = args._termWidth ?? process.stdout.columns ?? 80
  const termHeight = args._termHeight ?? process.stdout.rows ?? 24
  tmux.resizeWindow(sessionName, termWidth, termHeight)

  // Register in state before bootstrap — agent is live and discoverable immediately
  const displayedModel = resolveDisplayedModel(adapter.name, resolvedModel, presetModel, presetEnv)
  const agentState: AgentState = {
    cli: adapter.name,
    model: displayedModel,
    tmuxSession: sessionName,
    parentName,
    dir: workDir,
    instructionProjection,
    worktreePath,
    worktreeBranch,
    projectRoot: args.projectRoot ?? (useWorktree ? baseDir : undefined),
    workflow: args.workflow,
    spawnedAt: new Date().toISOString(),
    persistent: args.persistent ?? presetPersistent,
    ephemeral: args.ephemeral,
  }
  setAgent(name, agentState)

  appendEvent({
    type: 'spawn',
    agent: name,
    detail: `cli=${adapter.name} model=${resolvedModel ?? 'default'}${effectivePreset ? ` preset=${effectivePreset}` : ''} dir=${workDir}${projectedSkills.names.length ? ` skills=${projectedSkills.names.join(',')}` : ''}${args.noModelResolve ? ' modelResolve=off' : ''}`,
    at: new Date().toISOString(),
  })

  // Send bootstrap message if provided
  if (bootstrap) {
    await sendBootstrap(agentState, adapter, bootstrap, workDir)
  }

  if (!process.env.FLT_TUI_ACTIVE) {
    console.log(`Spawned ${name} (${adapter.name}/${resolvedModel ?? 'default'}) in ${sessionName}`)
  }
}

const ANSI_STRIP_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07\x1b]*[\x07\x1b]/g

function stripAnsiForCompare(s: string): string {
  return s.replace(ANSI_STRIP_RE, '')
}

/**
 * Returns true when the bootstrap payload (or its first 40 chars) appears in
 * the ANSI-stripped pane buffer.
 * Exported for unit testing.
 */
export function verifyBootstrapDelivered(paneContent: string, payload: string): boolean {
  const stripped = stripAnsiForCompare(paneContent)
  const needle = payload.length > 40 ? payload.slice(0, 40) : payload
  return stripped.includes(needle)
}

async function waitForReady(
  session: string,
  adapter: ReturnType<typeof resolveAdapter>,
  timeoutMs = 30_000,
): Promise<void> {
  const start = Date.now()
  let lastContent = ''
  let lastStripped = ''
  let stableCount = 0
  // Defense-in-depth: when an adapter's detectReady never returns 'ready' (e.g.
  // a banner that handleDialog can't dismiss), fall through to a stable-pane
  // fallback. After ~8s of unchanged ANSI-stripped pane content we assume the
  // agent is up regardless of what detectReady says.
  let fallbackStableCount = 0

  while (Date.now() - start < timeoutMs) {
    if (!tmux.hasSession(session)) {
      throw new Error(`Agent session "${session}" died during startup.`)
    }

    const pane = tmux.capturePane(session)
    const stripped = stripAnsiForCompare(pane)
    const readyState = adapter.detectReady(pane)

    if (readyState === 'dialog') {
      const keys = adapter.handleDialog(pane)
      if (keys) {
        tmux.sendKeys(session, keys)
        stableCount = 0
        fallbackStableCount = 0
        await sleep(1000)
        continue
      }
      // 'dialog' with null keys is a non-actionable signal. Don't loop forever
      // waiting for keys that will never come — fall through to the stable-pane
      // fallback below.
    }

    if (readyState === 'ready') {
      if (pane === lastContent) {
        stableCount++
        if (stableCount >= 2) return // 2 consecutive stable reads
      } else {
        stableCount = 0
      }
    } else {
      stableCount = 0
    }

    if (stripped === lastStripped && stripped.length > 0) {
      fallbackStableCount++
      // 16 polls * 500ms = ~8s of unchanged ANSI-stripped pane → assume ready.
      if (fallbackStableCount >= 16) return
    } else {
      fallbackStableCount = 0
    }

    lastContent = pane
    lastStripped = stripped
    await sleep(500)
  }

  // Don't throw — agent is likely ready, just undetected.
  // Registration + bootstrap still happen after this returns.
}

async function sendBootstrap(
  agent: AgentState,
  adapter: ReturnType<typeof resolveAdapter>,
  message: string,
  workDir: string,
): Promise<void> {
  // Multi-line bootstrap can't be safely pasted: many CLIs (pi, opencode,
  // sometimes claude-code/codex under tmux paste-buffer) treat each newline
  // as Enter, fragmenting the brief into one submit per line. So:
  //   - single-line bootstraps go through directly (sendLiteral or paste)
  //   - multi-line bootstraps are persisted to <workdir>/.flt/bootstrap.md
  //     and replaced with a one-line redirect that tells the agent to read
  //     the file. Preserves markdown structure and stays within tmux's
  //     single-line submit semantics.
  const isMultiLine = /\r|\n/.test(message)
  let payload: string
  if (isMultiLine) {
    const briefDir = join(workDir, '.flt')
    const briefPath = join(briefDir, 'bootstrap.md')
    const { mkdirSync, writeFileSync } = await import('fs')
    mkdirSync(briefDir, { recursive: true })
    writeFileSync(briefPath, message)
    payload = `Read .flt/bootstrap.md in this workdir and follow the instructions there carefully. Do not skip steps.`
  } else {
    payload = message
  }
  deliver(agent, payload)
  await sleep(300)
  deliverKeys(agent, adapter.submitKeys)

  await sleep(500)
  const pane = tmux.capturePane(agent.tmuxSession)
  if (!verifyBootstrapDelivered(pane, payload)) {
    await sleep(2000)
    deliver(agent, payload)
    await sleep(300)
    deliverKeys(agent, adapter.submitKeys)
    await sleep(500)
    const pane2 = tmux.capturePane(agent.tmuxSession)
    if (!verifyBootstrapDelivered(pane2, payload)) {
      console.warn(`flt: bootstrap delivery unconfirmed for ${agent.tmuxSession} — agent may not have received its task`)
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
