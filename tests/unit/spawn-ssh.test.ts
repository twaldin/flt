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
  getAgent: mock((_name: string) => undefined),
  removeAgent: mock((_name: string) => {}),
  saveState: mock(() => {}),
  setOrchestrator: mock(() => {}),
  getOrchestrator: mock(() => undefined),
  allAgents: mock(() => ({})),
  getLocation: mock((agent: { location?: { type: string } }) => agent.location ?? { type: 'local' as const }),
}))

const mockGetRemote = mock((_alias: string) => undefined as import('../../src/remotes').RemoteEntry | undefined)
const mockResolveRemote = mock((host: string) => ({ host } as import('../../src/remotes').RemoteEntry))

mock.module('../../src/remotes', () => ({
  getRemote: mockGetRemote,
  resolveRemote: mockResolveRemote,
}))

const mockSshExec = mock(() => ({ stdout: '', stderr: '', status: 0 }))
const mockShellEscapeSingle = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

mock.module('../../src/ssh', () => ({
  sshExec: mockSshExec,
  shellEscapeSingle: mockShellEscapeSingle,
}))

const mockCreateSession = mock(() => {})

mock.module('../../src/tmux', () => ({
  createSession: mockCreateSession,
  hasSession: mock(() => false),
  capturePane: mock(() => ''),
  sendKeys: mock(() => {}),
  pasteBuffer: mock(() => {}),
  sendLiteral: mock(() => {}),
  resizeWindow: mock(() => {}),
}))

mock.module('../../src/activity', () => ({
  appendEvent: mock(() => {}),
}))

mock.module('../../src/worktree', () => ({
  isGitRepo: mock(() => true),
  createWorktree: mock((_baseDir: string, name: string) => ({
    path: `/tmp/wt-${name}`,
    branch: `flt/${name}`,
  })),
  removeWorktree: mock(() => {}),
}))

mock.module('../../src/instructions', () => ({
  projectInstructions: mock(() => {}),
}))

mock.module('../../src/skills', () => ({
  projectSkills: mock(() => ({ names: [], warnings: [] })),
}))

describe('spawnDirect — ssh branch', () => {
  let tempDir: string
  let originalHome: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'flt-test-spawn-ssh-'))
    originalHome = process.env.HOME
    process.env.HOME = tempDir
    mkdirSync(join(tempDir, '.flt'), { recursive: true })
    writeFileSync(join(tempDir, '.flt', 'presets.json'), JSON.stringify({}))

    mockSetAgent.mockClear()
    mockHasAgent.mockClear()
    mockLoadState.mockClear()
    mockGetRemote.mockClear()
    mockResolveRemote.mockClear()
    mockSshExec.mockClear()
    mockCreateSession.mockClear()
  })

  afterEach(() => {
    process.env.HOME = originalHome
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('skips local tmux and calls sshExec with tmux new-session', async () => {
    mockGetRemote.mockReturnValue({ host: 'box.example.com', user: 'ubuntu' })
    mockSshExec.mockReturnValue({ stdout: '', stderr: '', status: 0 })

    const { spawnDirect } = await import('../../src/commands/spawn')
    await spawnDirect({ name: 'worker', cli: 'claude-code', ssh: 'mybox' })

    expect(mockCreateSession).not.toHaveBeenCalled()
    expect(mockSshExec).toHaveBeenCalledTimes(1)
    const [, cmd] = mockSshExec.mock.calls[0] as [unknown, string]
    expect(cmd).toContain('tmux new-session')
    expect(cmd).toContain('flt-worker')
    expect(cmd).toContain('claude')
  })

  it('records location as { type: ssh, host: alias } in agent state', async () => {
    mockGetRemote.mockReturnValue({ host: 'box.example.com' })
    mockSshExec.mockReturnValue({ stdout: '', stderr: '', status: 0 })

    const { spawnDirect } = await import('../../src/commands/spawn')
    await spawnDirect({ name: 'worker', cli: 'claude-code', ssh: 'mybox' })

    expect(mockSetAgent).toHaveBeenCalledTimes(1)
    const [registeredName, agentState] = mockSetAgent.mock.calls[0] as [string, { location: { type: string; host: string } }]
    expect(registeredName).toBe('worker')
    expect(agentState.location).toEqual({ type: 'ssh', host: 'mybox' })
  })

  it('throws clearly when remote alias is not registered', async () => {
    mockGetRemote.mockReturnValue(undefined)

    const { spawnDirect } = await import('../../src/commands/spawn')
    await expect(
      spawnDirect({ name: 'worker', cli: 'claude-code', ssh: 'unknown-remote' }),
    ).rejects.toThrow('Unknown SSH remote')
  })

  it('throws when remote tmux spawn fails', async () => {
    mockGetRemote.mockReturnValue({ host: 'box.example.com' })
    mockSshExec.mockReturnValue({ stdout: '', stderr: 'connection refused', status: 1 })

    const { spawnDirect } = await import('../../src/commands/spawn')
    await expect(
      spawnDirect({ name: 'worker', cli: 'claude-code', ssh: 'mybox' }),
    ).rejects.toThrow('connection refused')
  })

  it('delivers bootstrap to remote agent via ssh after spawn', async () => {
    mockGetRemote.mockReturnValue({ host: 'box.example.com' })
    mockResolveRemote.mockReturnValue({ host: 'box.example.com' })
    mockSshExec.mockReturnValue({ stdout: '', stderr: '', status: 0 })

    const { spawnDirect } = await import('../../src/commands/spawn')
    await spawnDirect({ name: 'worker', cli: 'claude-code', ssh: 'mybox', bootstrap: 'do the thing' })

    // First call is tmux new-session; subsequent calls are deliver + deliverKeys
    expect(mockSshExec.mock.calls.length).toBeGreaterThan(1)
    const deliverCall = (mockSshExec.mock.calls as [unknown, string][]).find(
      ([, cmd]) => cmd.includes('send-keys') && cmd.includes('do the thing'),
    )
    expect(deliverCall).toBeDefined()
  })

  it('uses explicit --dir as remote working directory in tmux command', async () => {
    mockGetRemote.mockReturnValue({ host: 'box.example.com' })
    mockSshExec.mockReturnValue({ stdout: '', stderr: '', status: 0 })

    const { spawnDirect } = await import('../../src/commands/spawn')
    await spawnDirect({ name: 'worker', cli: 'claude-code', ssh: 'mybox', dir: '/home/ubuntu/project' })

    const [, cmd] = mockSshExec.mock.calls[0] as [unknown, string]
    expect(cmd).toContain('/home/ubuntu/project')
  })

  it('defaults to $HOME as remote working directory when --dir is omitted', async () => {
    mockGetRemote.mockReturnValue({ host: 'box.example.com' })
    mockSshExec.mockReturnValue({ stdout: '', stderr: '', status: 0 })

    const { spawnDirect } = await import('../../src/commands/spawn')
    await spawnDirect({ name: 'worker', cli: 'claude-code', ssh: 'mybox' })

    const [, cmd] = mockSshExec.mock.calls[0] as [unknown, string]
    expect(cmd).toContain('$HOME')
  })

  afterAll(() => { mock.restore() })
})
