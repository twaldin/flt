import { afterAll, describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

mock.module('@twaldin/harness-ts', () => ({
  projectInstructions: mock(() => ({})),
  restoreProjectedInstructions: mock(() => {}),
  getAdapter: mock((_name: string) => ({
    instructionsFilename: 'AGENTS.md',
    submitKeys: ['Enter'],
    detectReady: (_pane: string) => 'ready',
    handleDialog: (_pane: string) => null,
    detectStatus: (_pane: string) => 'idle',
  })),
}))

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
  getLocation: mock((_agent: { location?: { type: 'local' } }) => _agent.location ?? { type: 'local' as const }),
}))

mock.module('../../src/worktree', () => ({
  isGitRepo: mock(() => true),
  createWorktree: mock((_baseDir: string, name: string) => ({
    path: `/tmp/wt-${name}`,
    branch: `flt/${name}`,
  })),
  removeWorktree: mock(() => {}),
}))

const mockCreateSession = mock(() => {})
const mockHasSession = mock((_name: string) => true)
const mockKillSession = mock((_name: string) => {})

mock.module('../../src/tmux', () => ({
  createSession: mockCreateSession,
  hasSession: mockHasSession,
  // "Claude Code" + prompt satisfies claude-code adapter's detectReady check
  capturePane: mock(() => 'Claude Code\n> '),
  sendKeys: mock(() => {}),
  pasteBuffer: mock(() => {}),
  sendLiteral: mock(() => {}),
  resizeWindow: mock(() => {}),
  killSession: mockKillSession,
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
    mockCreateSession.mockClear()
    mockHasSession.mockClear()
    mockHasSession.mockImplementation((name: string) => name === 'flt-orch' || mockCreateSession.mock.calls.some(call => call[0] === name))
    mockKillSession.mockClear()
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

    const { spawnDirect } = await import('../../src/commands/spawn')
    await spawnDirect({ name: 'cairn' })

    expect(mockSetAgent).toHaveBeenCalledTimes(2)
    const [registeredName, agentState] = mockSetAgent.mock.calls[1] as [string, Record<string, unknown>]
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

    const { spawnDirect } = await import('../../src/commands/spawn')
    await spawnDirect({ name: 'cairn', preset: 'other' })

    const [, agentState] = mockSetAgent.mock.calls[0] as [string, Record<string, unknown>]
    expect(agentState.model).toBe('sonnet')
  })

  it('uses default behavior when no preset matches name', async () => {
    writeFileSync(
      join(tempDir, '.flt', 'presets.json'),
      JSON.stringify({ default: { cli: 'claude-code', model: 'sonnet' } }, null, 2) + '\n',
    )

    const { spawnDirect } = await import('../../src/commands/spawn')
    await spawnDirect({ name: 'worker', cli: 'claude-code', model: 'haiku' })

    const [, agentState] = mockSetAgent.mock.calls[0] as [string, Record<string, unknown>]
    expect(agentState.model).toBe('haiku')
  })

  it('registers state immediately after tmux creation before readiness completes', async () => {
    mockHasSession.mockImplementation((name: string) => name === 'flt-orch' || mockCreateSession.mock.calls.some(call => call[0] === name))

    const { spawnDirect } = await import('../../src/commands/spawn')
    await spawnDirect({ name: 'worker', cli: 'claude-code', model: 'haiku' })

    expect(mockCreateSession).toHaveBeenCalledTimes(1)
    expect(mockSetAgent).toHaveBeenCalledTimes(2)
    const [, firstState] = mockSetAgent.mock.calls[0] as [string, Record<string, unknown>]
    expect(firstState.status).toBe('spawning')
    const [, finalState] = mockSetAgent.mock.calls[1] as [string, Record<string, unknown>]
    expect(finalState.status).toBeUndefined()
  })

  it('refuses to spawn when tmux already has the agent session but state does not', async () => {
    mockHasSession.mockImplementation((name: string) => name === 'flt-worker' || name === 'flt-orch')

    const { spawnDirect } = await import('../../src/commands/spawn')
    await expect(spawnDirect({ name: 'worker', cli: 'claude-code', model: 'haiku' }))
      .rejects.toThrow('already exists but agent "worker" is not in state')

    expect(mockCreateSession).not.toHaveBeenCalled()
  })

  afterAll(() => { mock.restore() })
})
