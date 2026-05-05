import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test'

const mockGetAgent = mock(() => undefined)
const mockRemoveAgent = mock(() => {})
const mockAppendEvent = mock(() => {})
const mockResolveRemote = mock((host: string) => ({ host }))
const mockSshExec = mock(() => ({ stdout: '', stderr: '', status: 0 }))
const mockKillSession = mock(() => {})
const mockGetPanePid = mock(() => null)

mock.module('../../src/state', () => ({
  getAgent: mockGetAgent,
  removeAgent: mockRemoveAgent,
  loadState: mock(() => ({ agents: {}, config: { maxDepth: 3 } })),
}))
mock.module('../../src/activity', () => ({ appendEvent: mockAppendEvent }))
mock.module('../../src/remotes', () => ({ resolveRemote: mockResolveRemote }))
mock.module('../../src/ssh', () => ({
  sshExec: mockSshExec,
  shellEscapeSingle: (s: string) => `'${s.replace(/'/g, `'\\''`)}'`,
}))
mock.module('../../src/tmux', () => ({
  killSession: mockKillSession,
  getPanePid: mockGetPanePid,
}))
mock.module('../../src/worktree', () => ({ removeWorktree: mock(() => {}) }))
mock.module('../../src/instructions', () => ({ restoreInstructions: mock(() => {}) }))
mock.module('../../src/skills', () => ({ cleanupSkills: mock(() => {}) }))
mock.module('../../src/adapters/registry', () => ({ resolveAdapter: mock(() => ({})) }))
mock.module('../../src/harness', () => ({ harnessExtract: mock(() => null), archiveRun: mock(() => {}) }))
mock.module('../../src/harness.ts', () => ({ harnessExtract: mock(() => null), archiveRun: mock(() => {}) }))
mock.module('../../src/commands/init', () => ({ appendInbox: mock(() => {}) }))
mock.module('@twaldin/harness-ts', () => ({ getAdapter: mock(() => null) }))

import { killDirect } from '../../src/commands/kill'

describe('killDirect ssh branch', () => {
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
    mock.restore()
  })
})
