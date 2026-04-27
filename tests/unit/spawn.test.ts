import { afterAll, describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// These mocks are hoisted by bun:test before static imports resolve.
const mockSetAgent = mock((_name: string, _state: unknown) => {})
const mockHasAgent = mock((_name: string) => false)
const mockLoadState = mock(() => ({
  agents: {},
  config: { maxDepth: 5 },
  orchestrator: { tmuxSession: 'flt-orch', tmuxWindow: 'main', type: 'human' as const, initAt: '' },
}))

mock.module('../../src/state', () => ({
  loadState: mockLoadState,
  setAgent: mockSetAgent,
  hasAgent: mockHasAgent,
}))

mock.module('../../src/worktree', () => ({
  isGitRepo: mock(() => true),
  createWorktree: mock((_baseDir: string, name: string) => ({
    path: `/tmp/wt-${name}`,
    branch: `flt/${name}`,
  })),
}))

mock.module('../../src/tmux', () => ({
  createSession: mock(() => {}),
  hasSession: mock(() => true),
  // "Claude Code" + prompt satisfies claude-code adapter's detectReady check
  capturePane: mock(() => 'Claude Code\n> '),
  sendKeys: mock(() => {}),
  pasteBuffer: mock(() => {}),
  sendLiteral: mock(() => {}),
}))

mock.module('../../src/instructions', () => ({
  projectInstructions: mock(() => {}),
}))

mock.module('../../src/skills', () => ({
  projectSkills: mock(() => {}),
}))

mock.module('../../src/activity', () => ({
  appendEvent: mock(() => {}),
}))


import { spawnDirect } from '../../src/commands/spawn'

describe('spawnDirect — preset auto-resolution', () => {
  let tempDir: string
  let originalHome: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'flt-test-spawn-'))
    originalHome = process.env.HOME
    process.env.HOME = tempDir
    mkdirSync(join(tempDir, '.flt'), { recursive: true })
    mockSetAgent.mockClear()
    mockHasAgent.mockClear()
    mockLoadState.mockClear()
  })

  afterEach(() => {
    process.env.HOME = originalHome
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('uses matching preset when spawning by name without --preset', async () => {
    writeFileSync(
      join(tempDir, '.flt', 'presets.json'),
      JSON.stringify({ cairn: { cli: 'claude-code', model: 'opus[1m]', persistent: true } }, null, 2) + '\n',
    )

    await spawnDirect({ name: 'cairn' })

    expect(mockSetAgent).toHaveBeenCalledTimes(1)
    const [registeredName, agentState] = mockSetAgent.mock.calls[0] as [string, Record<string, unknown>]
    expect(registeredName).toBe('cairn')
    expect(agentState.model).toBe('opus[1m]')
    expect(agentState.cli).toBe('claude-code')
    expect(agentState.persistent).toBe(true)
  })

  it('uses explicit --preset over name when both match', async () => {
    writeFileSync(
      join(tempDir, '.flt', 'presets.json'),
      JSON.stringify({
        cairn: { cli: 'claude-code', model: 'opus[1m]', persistent: true },
        other: { cli: 'claude-code', model: 'sonnet' },
      }, null, 2) + '\n',
    )

    await spawnDirect({ name: 'cairn', preset: 'other' })

    const [, agentState] = mockSetAgent.mock.calls[0] as [string, Record<string, unknown>]
    expect(agentState.model).toBe('sonnet')
  })

  it('uses default behavior when no preset matches name', async () => {
    writeFileSync(
      join(tempDir, '.flt', 'presets.json'),
      JSON.stringify({ default: { cli: 'claude-code', model: 'sonnet' } }, null, 2) + '\n',
    )

    await spawnDirect({ name: 'worker', cli: 'claude-code', model: 'haiku' })

    const [, agentState] = mockSetAgent.mock.calls[0] as [string, Record<string, unknown>]
    expect(agentState.model).toBe('haiku')
  })

  afterAll(() => { mock.restore() })
})
