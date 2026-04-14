export interface CallerContext {
  mode: 'human' | 'agent'
  agentName?: string
  parentSession?: string
  parentName?: string
  depth: number
}

export function detectCaller(): CallerContext {
  let agentName = process.env.FLT_AGENT_NAME
  let parentSession = process.env.FLT_PARENT_SESSION
  let parentName = process.env.FLT_PARENT_NAME
  let depth = parseInt(process.env.FLT_DEPTH ?? '0', 10)

  // If env vars are missing, try reading from tmux session environment
  // (some CLIs like codex don't propagate tmux session env to subprocesses)
  if (!agentName) {
    const tmuxEnv = readTmuxSessionEnv()
    if (tmuxEnv.FLT_AGENT_NAME) {
      agentName = tmuxEnv.FLT_AGENT_NAME
      parentSession = parentSession ?? tmuxEnv.FLT_PARENT_SESSION
      parentName = parentName ?? tmuxEnv.FLT_PARENT_NAME
      depth = parseInt(tmuxEnv.FLT_DEPTH ?? '0', 10)
    }
  }

  if (agentName) {
    return {
      mode: 'agent',
      agentName,
      parentSession,
      parentName,
      depth,
    }
  }

  return { mode: 'human', depth: 0 }
}

function readTmuxSessionEnv(): Record<string, string> {
  if (!process.env.TMUX) return {}
  try {
    const { execFileSync } = require('child_process')
    const sessionName = execFileSync('tmux', ['display-message', '-p', '#{session_name}'], {
      encoding: 'utf-8', timeout: 2000,
    }).trim()
    if (!sessionName || !sessionName.startsWith('flt-')) return {}

    const raw = execFileSync('tmux', ['show-environment', '-t', sessionName], {
      encoding: 'utf-8', timeout: 2000,
    }).trim()

    const env: Record<string, string> = {}
    for (const line of raw.split('\n')) {
      const eq = line.indexOf('=')
      if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1)
    }
    return env
  } catch {
    return {}
  }
}

export function isAgentMode(): boolean {
  return !!process.env.FLT_AGENT_NAME
}
