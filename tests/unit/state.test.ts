import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// We need to override the state path for tests.
// We'll test the logic by importing and calling directly with a temp dir.
import {
  loadState,
  saveState,
  setAgent,
  getAgent,
  removeAgent,
  hasAgent,
  setOrchestrator,
  getOrchestrator,
  allAgents,
} from '../../src/state'

let origHome: string | undefined

describe('state', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'flt-test-state-'))
    origHome = process.env.HOME
    process.env.HOME = tempDir
  })

  afterEach(() => {
    process.env.HOME = origHome
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns default state when no file exists', () => {
    const state = loadState()
    expect(state.agents).toEqual({})
    expect(state.config.maxDepth).toBe(3)
    expect(state.orchestrator).toBeUndefined()
  })

  it('saves and loads state', () => {
    const state = loadState()
    state.agents['test'] = {
      cli: 'claude-code',
      model: 'opus-4-6',
      tmuxSession: 'flt-test',
      parentName: 'orchestrator',
      dir: '/tmp/test',
      spawnedAt: '2026-04-11T00:00:00Z',
    }
    saveState(state)

    const loaded = loadState()
    expect(loaded.agents['test']).toBeDefined()
    expect(loaded.agents['test'].cli).toBe('claude-code')
  })

  it('sets and gets an agent', () => {
    setAgent('coder-1', {
      cli: 'codex',
      model: 'o3',
      tmuxSession: 'flt-coder-1',
      parentName: 'orchestrator',
      dir: '/tmp/proj',
      spawnedAt: '2026-04-11T00:00:00Z',
    })

    const agent = getAgent('coder-1')
    expect(agent).toBeDefined()
    expect(agent!.cli).toBe('codex')
    expect(agent!.model).toBe('o3')
  })

  it('removes an agent', () => {
    setAgent('to-remove', {
      cli: 'aider',
      model: 'sonnet',
      tmuxSession: 'flt-to-remove',
      parentName: 'orchestrator',
      dir: '/tmp/proj',
      spawnedAt: '2026-04-11T00:00:00Z',
    })
    expect(hasAgent('to-remove')).toBe(true)

    removeAgent('to-remove')
    expect(hasAgent('to-remove')).toBe(false)
    expect(getAgent('to-remove')).toBeUndefined()
  })

  it('sets and gets orchestrator', () => {
    setOrchestrator({
      tmuxSession: 'flt',
      tmuxWindow: '0',
      type: 'human',
      initAt: '2026-04-11T00:00:00Z',
    })

    const orch = getOrchestrator()
    expect(orch).toBeDefined()
    expect(orch!.type).toBe('human')
  })

  it('lists all agents', () => {
    setAgent('a', {
      cli: 'claude-code', model: 'opus', tmuxSession: 'flt-a',
      parentName: 'orchestrator', dir: '/tmp', spawnedAt: '2026-04-11T00:00:00Z',
    })
    setAgent('b', {
      cli: 'codex', model: 'o3', tmuxSession: 'flt-b',
      parentName: 'orchestrator', dir: '/tmp', spawnedAt: '2026-04-11T00:00:00Z',
    })

    const agents = allAgents()
    expect(Object.keys(agents)).toEqual(['a', 'b'])
  })

  it('hasAgent returns false for nonexistent', () => {
    expect(hasAgent('nope')).toBe(false)
  })
})
