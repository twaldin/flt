import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { detectCaller, isAgentMode } from '../../src/detect'

describe('detect', () => {
  let savedEnv: Record<string, string | undefined>

  beforeEach(() => {
    savedEnv = {
      FLT_AGENT_NAME: process.env.FLT_AGENT_NAME,
      FLT_PARENT_SESSION: process.env.FLT_PARENT_SESSION,
      FLT_PARENT_NAME: process.env.FLT_PARENT_NAME,
      FLT_DEPTH: process.env.FLT_DEPTH,
      TMUX: process.env.TMUX,
    }
    delete process.env.FLT_AGENT_NAME
    delete process.env.FLT_PARENT_SESSION
    delete process.env.FLT_PARENT_NAME
    delete process.env.FLT_DEPTH
    delete process.env.TMUX
  })

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  it('detects human mode when no env vars set', () => {
    const ctx = detectCaller()
    expect(ctx.mode).toBe('human')
    expect(ctx.depth).toBe(0)
    expect(ctx.agentName).toBeUndefined()
  })

  it('detects agent mode when FLT_AGENT_NAME is set', () => {
    process.env.FLT_AGENT_NAME = 'coder-1'
    process.env.FLT_PARENT_SESSION = 'flt-orchestrator'
    process.env.FLT_PARENT_NAME = 'orchestrator'
    process.env.FLT_DEPTH = '1'

    const ctx = detectCaller()
    expect(ctx.mode).toBe('agent')
    expect(ctx.agentName).toBe('coder-1')
    expect(ctx.parentSession).toBe('flt-orchestrator')
    expect(ctx.parentName).toBe('orchestrator')
    expect(ctx.depth).toBe(1)
  })

  it('isAgentMode returns false for human', () => {
    expect(isAgentMode()).toBe(false)
  })

  it('isAgentMode returns true for agent', () => {
    process.env.FLT_AGENT_NAME = 'test'
    expect(isAgentMode()).toBe(true)
  })

  it('defaults depth to 0 when not set', () => {
    process.env.FLT_AGENT_NAME = 'test'
    const ctx = detectCaller()
    expect(ctx.depth).toBe(0)
  })
})
