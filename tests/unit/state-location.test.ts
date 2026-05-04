import { describe, expect, test } from 'bun:test'
import { getLocation } from '../../src/state'
import type { AgentState, Location } from '../../src/state'

describe('getLocation', () => {
  const baseAgent: AgentState = {
    cli: 'claude-code',
    model: 'sonnet',
    tmuxSession: 'test',
    parentName: 'root',
    dir: '/tmp',
    spawnedAt: '2026-01-01T00:00:00Z',
  }

  test('returns {type:"local"} when location is undefined (legacy shape)', () => {
    expect(getLocation(baseAgent)).toEqual({ type: 'local' })
  })

  test('returns exact location when set to {type:"local"}', () => {
    const agent: AgentState = { ...baseAgent, location: { type: 'local' } }
    expect(getLocation(agent)).toEqual({ type: 'local' })
  })

  test('returns exact location when set to {type:"ssh"}', () => {
    const loc: Location = { type: 'ssh', host: 'h' }
    const agent: AgentState = { ...baseAgent, location: loc }
    expect(getLocation(agent)).toEqual(loc)
  })

  test('returns exact location when set to {type:"sandbox"}', () => {
    const loc: Location = { type: 'sandbox', runtime: 'docker', container: 'c' }
    const agent: AgentState = { ...baseAgent, location: loc }
    expect(getLocation(agent)).toEqual(loc)
  })

  test('returns exact location when set to {type:"ssh+sandbox"}', () => {
    const loc: Location = { type: 'ssh+sandbox', host: 'h', runtime: 'docker', container: 'c' }
    const agent: AgentState = { ...baseAgent, location: loc }
    expect(getLocation(agent)).toEqual(loc)
  })

  test('AgentState without location satisfies the type (location must be optional)', () => {
    // If location were required this const declaration would not typecheck
    const agent: AgentState = {
      cli: 'claude-code',
      model: 'sonnet',
      tmuxSession: 's',
      parentName: 'p',
      dir: '/d',
      spawnedAt: '2026-01-01T00:00:00Z',
    }
    expect(agent.location).toBeUndefined()
  })
})
