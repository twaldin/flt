import { resolveAdapter } from '../adapters/registry'
import { projectInstructions } from '../instructions'
import { createWorktree, isGitRepo } from '../worktree'
import { loadState, setAgent, hasAgent } from '../state'
import * as tmux from '../tmux'
import { resolve } from 'path'

interface SpawnArgs {
  name: string
  cli: string
  model?: string
  dir?: string
  worktree?: boolean
  bootstrap?: string
}

export async function spawn(args: SpawnArgs): Promise<void> {
  const {
    name,
    cli,
    model,
    dir: rawDir,
    worktree = true,
    bootstrap,
  } = args

  // Validate name uniqueness
  if (hasAgent(name)) {
    throw new Error(`Agent "${name}" already exists. Use "flt kill ${name}" first.`)
  }

  // Validate name format
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error('Agent name must be alphanumeric with dashes/underscores only.')
  }

  const adapter = resolveAdapter(cli)
  const baseDir = resolve(rawDir || process.cwd())

  // Check depth limit
  const state = loadState()
  const callerDepth = parseInt(process.env.FLT_DEPTH ?? '0', 10)
  if (callerDepth >= state.config.maxDepth) {
    throw new Error(`Max agent depth (${state.config.maxDepth}) reached.`)
  }

  // Determine working directory
  let workDir = baseDir
  let worktreePath: string | undefined
  let worktreeBranch: string | undefined

  if (worktree) {
    if (!isGitRepo(baseDir)) {
      throw new Error(`Cannot create worktree: "${baseDir}" is not a git repository.`)
    }
    const wt = createWorktree(baseDir, name)
    workDir = wt.path
    worktreePath = wt.path
    worktreeBranch = wt.branch
  }

  // Project instructions into workspace
  if (adapter.instructionFile) {
    const parentName = process.env.FLT_AGENT_NAME ?? 'orchestrator'
    projectInstructions(workDir, adapter.instructionFile, {
      agentName: name,
      parentName,
      cli: adapter.name,
      model: model ?? 'default',
    })
  }

  // Build spawn command
  const cliArgs = adapter.spawnArgs({ model, dir: workDir })
  const command = cliArgs.join(' ')

  // Determine parent info for env vars
  const parentName = process.env.FLT_AGENT_NAME ?? 'orchestrator'
  const parentSession = process.env.FLT_AGENT_NAME
    ? `flt-${process.env.FLT_AGENT_NAME}`
    : (state.orchestrator?.tmuxSession ?? 'flt')

  const sessionName = `flt-${name}`

  // Create tmux session with env vars
  tmux.createSession(sessionName, workDir, command, {
    FLT_AGENT_NAME: name,
    FLT_PARENT_SESSION: parentSession,
    FLT_PARENT_NAME: parentName,
    FLT_DEPTH: String(callerDepth + 1),
    PATH: `${process.env.PATH}`,
  })

  // Poll for readiness (60s timeout — some CLIs have multiple sequential dialogs)
  await waitForReady(sessionName, adapter, 60_000)

  // Send bootstrap message if provided
  if (bootstrap) {
    await sendBootstrap(sessionName, adapter, bootstrap)
  }

  // Register in state
  setAgent(name, {
    cli: adapter.name,
    model: model ?? 'default',
    tmuxSession: sessionName,
    parentName,
    dir: workDir,
    worktreePath,
    worktreeBranch,
    spawnedAt: new Date().toISOString(),
  })

  console.log(`Spawned ${name} (${adapter.name}/${model ?? 'default'}) in ${sessionName}`)
}

async function waitForReady(
  session: string,
  adapter: ReturnType<typeof resolveAdapter>,
  timeoutMs = 30_000,
): Promise<void> {
  const start = Date.now()
  let lastContent = ''
  let stableCount = 0

  while (Date.now() - start < timeoutMs) {
    if (!tmux.hasSession(session)) {
      throw new Error(`Agent session "${session}" died during startup.`)
    }

    const pane = tmux.capturePane(session)
    const readyState = adapter.detectReady(pane)

    if (readyState === 'dialog') {
      const keys = adapter.handleDialog(pane)
      if (keys) {
        tmux.sendKeys(session, keys)
        stableCount = 0
        await sleep(1000)
        continue
      }
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

    lastContent = pane
    await sleep(500)
  }

  throw new Error(`Agent "${session}" did not become ready within ${timeoutMs / 1000}s.`)
}

async function sendBootstrap(
  session: string,
  adapter: ReturnType<typeof resolveAdapter>,
  message: string,
): Promise<void> {
  // Use paste buffer for long messages, send-keys for short
  if (message.length > 200 || message.includes('\n')) {
    tmux.pasteBuffer(session, message)
  } else {
    tmux.sendLiteral(session, message)
  }
  await sleep(300) // Let tmux process the paste
  tmux.sendKeys(session, adapter.submitKeys)
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
