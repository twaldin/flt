import { afterAll, describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { RemoteEntry } from '../../src/remotes'


function makeAdapter(name: string) {
  return {
    name,
    cliCommand: name === 'claude-code' ? 'claude' : name,
    instructionFile: 'AGENTS.md',
    submitKeys: ['Enter'],
    spawnArgs: ({ model }: { model?: string }) => model ? ['claude', '--model', model] : ['claude'],
    detectReady: (_pane: string) => 'ready' as const,
    handleDialog: (_pane: string) => null,
    detectStatus: (_pane: string) => 'idle' as const,
  }
}

const mockSetAgent = mock((_name: string, _state: unknown) => {})
const mockHasAgent = mock((_name: string) => false)
const mockLoadState = mock(() => ({
  agents: {},
  config: { maxDepth: 5 },
  orchestrator: { tmuxSession: 'flt-orch', tmuxWindow: 'main', type: 'human' as const, initAt: '' },
}))
const mockGetRemote = mock((_alias: string): RemoteEntry | undefined => undefined)
const mockSshExec = mock((_remote: RemoteEntry, _cmd: string) => ({ stdout: '', stderr: '', status: 0 }))
const mockCreateSession = mock(() => {})
const mockDeliver = mock((_agent: unknown, _text: string) => {})
const mockDeliverKeys = mock((_agent: unknown, _keys: string[]) => {})
const mockShellEscapeSingle = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

const fakeTmux = {
  createSession: mockCreateSession,
  hasSession: mock(() => false),
  capturePane: mock(() => ''),
  sendKeys: mock(() => {}),
  pasteBuffer: mock(() => {}),
  sendLiteral: mock(() => {}),
  resizeWindow: mock(() => {}),
}

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
    mockSshExec.mockClear()
    mockCreateSession.mockClear()
    mockDeliver.mockClear()
    mockDeliverKeys.mockClear()
  })

  async function loadSpawnDirect() {
    const mod = await import('../../src/commands/spawn')
    mod._adapterForTest.resolveAdapter = makeAdapter
    mod._depsForTest.loadState = mockLoadState
    mod._depsForTest.setAgent = mockSetAgent
    mod._depsForTest.hasAgent = mockHasAgent
    mod._depsForTest.isGitRepo = mock(() => true)
    mod._depsForTest.createWorktree = mock((_baseDir: string, name: string) => ({ path: `/tmp/wt-${name}`, branch: `flt/${name}` }))
    mod._depsForTest.projectInstructions = mock(() => undefined)
    mod._depsForTest.projectSkills = mock(() => ({ names: [], warnings: [] }))
    mod._depsForTest.appendEvent = mock(() => undefined)
    mod._depsForTest.tmux = fakeTmux as unknown as typeof mod._depsForTest.tmux
    mod._depsForTest.getRemote = mockGetRemote
    mod._depsForTest.sshExec = mockSshExec
    mod._depsForTest.shellEscapeSingle = mockShellEscapeSingle
    mod._depsForTest.deliver = mockDeliver
    mod._depsForTest.deliverKeys = mockDeliverKeys
    return mod.spawnDirect
  }

  afterEach(() => {
    process.env.HOME = originalHome
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('skips local tmux and calls sshExec with tmux new-session', async () => {
    mockGetRemote.mockReturnValue({ host: 'box.example.com', user: 'ubuntu' })
    mockSshExec.mockReturnValue({ stdout: '', stderr: '', status: 0 })

    const spawnDirect = await loadSpawnDirect()
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

    const spawnDirect = await loadSpawnDirect()
    await spawnDirect({ name: 'worker', cli: 'claude-code', ssh: 'mybox' })

    expect(mockSetAgent).toHaveBeenCalledTimes(1)
    const [registeredName, agentState] = mockSetAgent.mock.calls[0] as [string, { location: { type: string; host: string } }]
    expect(registeredName).toBe('worker')
    expect(agentState.location).toEqual({ type: 'ssh', host: 'mybox' })
  })

  it('throws clearly when remote alias is not registered', async () => {
    mockGetRemote.mockReturnValue(undefined)

    const spawnDirect = await loadSpawnDirect()
    await expect(
      spawnDirect({ name: 'worker', cli: 'claude-code', ssh: 'unknown-remote' }),
    ).rejects.toThrow('Unknown SSH remote')
  })

  it('throws when remote tmux spawn fails', async () => {
    mockGetRemote.mockReturnValue({ host: 'box.example.com' })
    mockSshExec.mockReturnValue({ stdout: '', stderr: 'connection refused', status: 1 })

    const spawnDirect = await loadSpawnDirect()
    await expect(
      spawnDirect({ name: 'worker', cli: 'claude-code', ssh: 'mybox' }),
    ).rejects.toThrow('connection refused')
  })

  it('delivers bootstrap to remote agent via ssh after spawn', async () => {
    mockGetRemote.mockReturnValue({ host: 'box.example.com' })
    mockSshExec.mockReturnValue({ stdout: '', stderr: '', status: 0 })

    const spawnDirect = await loadSpawnDirect()
    await spawnDirect({ name: 'worker', cli: 'claude-code', ssh: 'mybox', bootstrap: 'do the thing' })

    expect(mockDeliver).toHaveBeenCalledWith(
      expect.objectContaining({ location: { type: 'ssh', host: 'mybox' } }),
      'do the thing',
    )
    expect(mockDeliverKeys).toHaveBeenCalledWith(
      expect.objectContaining({ location: { type: 'ssh', host: 'mybox' } }),
      ['Enter'],
    )
  })

  it('uses explicit --dir as remote working directory in tmux command', async () => {
    mockGetRemote.mockReturnValue({ host: 'box.example.com' })
    mockSshExec.mockReturnValue({ stdout: '', stderr: '', status: 0 })

    const spawnDirect = await loadSpawnDirect()
    await spawnDirect({ name: 'worker', cli: 'claude-code', ssh: 'mybox', dir: '/home/ubuntu/project' })

    const [, cmd] = mockSshExec.mock.calls[0] as [unknown, string]
    expect(cmd).toContain('/home/ubuntu/project')
  })

  it('defaults to $HOME as remote working directory when --dir is omitted', async () => {
    mockGetRemote.mockReturnValue({ host: 'box.example.com' })
    mockSshExec.mockReturnValue({ stdout: '', stderr: '', status: 0 })

    const spawnDirect = await loadSpawnDirect()
    await spawnDirect({ name: 'worker', cli: 'claude-code', ssh: 'mybox' })

    const [, cmd] = mockSshExec.mock.calls[0] as [unknown, string]
    expect(cmd).toContain('$HOME')
  })

  afterAll(() => { mock.restore() })
})
