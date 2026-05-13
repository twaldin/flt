import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test'

const mockGetAgent = mock((_name: string): unknown => undefined)
const mockRemoveAgent = mock(() => {})
const mockAppendEvent = mock(() => {})
const mockResolveRemote = mock((host: string) => ({ host }))
const mockSshExec = mock(() => ({ stdout: '', stderr: '', status: 0 }))
const mockKillSession = mock(() => {})
const mockGetPanePid = mock(() => null)
const mockHarnessExtract = mock(() => null)
const mockArchiveRun = mock(() => {})
const mockAppendInbox = mock(() => {})

import { _depsForTest, killDirect } from '../../src/commands/kill'

describe('killDirect ssh branch', () => {
  const originalDeps = { ..._depsForTest }

  beforeEach(() => {
    mockGetAgent.mockReset()
    mockRemoveAgent.mockReset()
    mockAppendEvent.mockReset()
    mockResolveRemote.mockReset()
    mockResolveRemote.mockImplementation((host: string) => ({ host }))
    mockSshExec.mockReset()
    mockSshExec.mockReturnValue({ stdout: '', stderr: '', status: 0 })
    mockKillSession.mockReset()
    mockGetPanePid.mockReset()
    mockHarnessExtract.mockReset()
    mockArchiveRun.mockReset()
    mockAppendInbox.mockReset()

    _depsForTest.getAgent = mockGetAgent as typeof _depsForTest.getAgent
    _depsForTest.removeAgent = mockRemoveAgent
    _depsForTest.appendEvent = mockAppendEvent
    _depsForTest.resolveRemote = mockResolveRemote
    _depsForTest.sshExec = mockSshExec
    _depsForTest.shellEscapeSingle = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
    _depsForTest.killSession = mockKillSession
    _depsForTest.getPanePid = mockGetPanePid
    _depsForTest.harnessExtract = mockHarnessExtract
    _depsForTest.archiveRun = mockArchiveRun
    _depsForTest.appendInbox = mockAppendInbox
  })

  it('kills ssh tmux session remotely and removes agent without local tmux kill', () => {
    mockGetAgent.mockReturnValue({
      cli: 'pi',
      model: 'gpt-5',
      tmuxSession: 'flt-worker',
      parentName: 'human',
      dir: '/repo/worktree',
      spawnedAt: new Date().toISOString(),
      location: { type: 'ssh', host: 'prod-vps' },
      worktreePath: '/repo/.git/worktrees/worker',
      worktreeBranch: 'flt/worker',
    })

    killDirect({ name: 'worker' })

    expect(mockSshExec).toHaveBeenCalledWith(
      { host: 'prod-vps' },
      'tmux kill-session -t flt-worker',
    )
    expect(mockSshExec).toHaveBeenCalledWith(
      { host: 'prod-vps' },
      "cd '/repo/worktree' && git worktree remove --force '/repo/.git/worktrees/worker' && git branch -D 'flt/worker'",
    )
    expect(mockKillSession).not.toHaveBeenCalled()
    expect(mockRemoveAgent).toHaveBeenCalledWith('worker')
  })

  it('throws when remote tmux kill fails and keeps agent state', () => {
    mockGetAgent.mockReturnValue({
      cli: 'pi',
      model: 'gpt-5',
      tmuxSession: 'flt-worker',
      parentName: 'human',
      dir: '/repo/worktree',
      spawnedAt: new Date().toISOString(),
      location: { type: 'ssh', host: 'prod-vps' },
    })
    mockSshExec.mockReturnValue({ stdout: '', stderr: 'No session', status: 1 })

    expect(() => killDirect({ name: 'worker' })).toThrow('No session')
    expect(mockRemoveAgent).not.toHaveBeenCalled()
    expect(mockKillSession).not.toHaveBeenCalled()
  })

  it('skips remote worktree cleanup when preserveWorktree is true', () => {
    mockGetAgent.mockReturnValue({
      cli: 'pi',
      model: 'gpt-5',
      tmuxSession: 'flt-worker',
      parentName: 'human',
      dir: '/repo/worktree',
      spawnedAt: new Date().toISOString(),
      location: { type: 'ssh', host: 'prod-vps' },
      worktreePath: '/repo/.git/worktrees/worker',
      worktreeBranch: 'flt/worker',
    })

    killDirect({ name: 'worker', preserveWorktree: true })

    expect(mockSshExec).toHaveBeenCalledTimes(1)
    expect(mockSshExec).toHaveBeenCalledWith(
      { host: 'prod-vps' },
      'tmux kill-session -t flt-worker',
    )
  })

  afterAll(() => {
    Object.assign(_depsForTest, originalDeps)
    mock.restore()
  })
})
