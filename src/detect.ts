export interface CallerContext {
  mode: 'human' | 'agent'
  agentName?: string
  parentSession?: string
  parentName?: string
  depth: number
}

export function detectCaller(): CallerContext {
  const agentName = process.env.FLT_AGENT_NAME
  const parentSession = process.env.FLT_PARENT_SESSION
  const parentName = process.env.FLT_PARENT_NAME
  const depth = parseInt(process.env.FLT_DEPTH ?? '0', 10)

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

export function isAgentMode(): boolean {
  return !!process.env.FLT_AGENT_NAME
}
