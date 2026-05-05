import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test'

const mockGetAgent = mock(() => undefined)
const mockHasSession = mock(() => true)
const mockCapturePane = mock(() => 'local-output')
const mockResolveRemote = mock((host: string) => ({ host }))
const mockSshExec = mock(() => ({ stdout: 'remote-output', stderr: '', status: 0 }))

mock.module('../../src/state', () => ({ getAgent: mockGetAgent }))
mock.module('../../src/tmux', () => ({
  hasSession: mockHasSession,
  capturePane: mockCapturePane,
}))
mock.module('../../src/remotes', () => ({ resolveRemote: mockResolveRemote }))
mock.module('../../src/ssh', () => ({ sshExec: mockSshExec, shellEscapeSingle: (s: string) => `'${s.replace(/'/g, `'\\''`)}'` }))

import { logs } from '../../src/commands/logs'

describe('logs command ssh dispatch', () => {
  const originalLog = console.log
  const printed: string[] = []

  beforeEach(() => {
    printed.length = 0
    console.log = (...args: unknown[]) => {
      printed.push(args.map(String).join(' '))
    }
    mockGetAgent.mockReset()
    mockHasSession.mockReset()
    mockCapturePane.mockReset()
    mockResolveRemote.mockReset()
    mockSshExec.mockReset()
  })

  it('uses sshExec for ssh-located agents', () => {
    mockGetAgent.mockReturnValue({
      cli: 'pi',
      model: 'gpt-5',
      tmuxSession: 'flt-worker',
      parentName: 'human',
      dir: '/tmp/w',
      spawnedAt: new Date().toISOString(),
      location: { type: 'ssh', host: 'prod-vps' },
    })
    mockResolveRemote.mockImplementation((host: string) => ({ host }))
    mockSshExec.mockReturnValue({ stdout: 'remote-log', stderr: '', status: 0 })

    logs({ name: 'worker', lines: 123 })

    expect(mockResolveRemote).toHaveBeenCalledWith('prod-vps')
    expect(mockSshExec).toHaveBeenCalledWith(
      { host: 'prod-vps' },
      "tmux capture-pane -t 'flt-worker:^' -p -e -N -S -123",
    )
    expect(mockCapturePane).not.toHaveBeenCalled()
    expect(printed[0]).toBe('remote-log')
  })

  it('throws on ssh capture failure with stderr', () => {
    mockGetAgent.mockReturnValue({
      cli: 'pi',
      model: 'gpt-5',
      tmuxSession: 'flt-worker',
      parentName: 'human',
      dir: '/tmp/w',
      spawnedAt: new Date().toISOString(),
      location: { type: 'ssh', host: 'prod-vps' },
    })
    mockResolveRemote.mockImplementation((host: string) => ({ host }))
    mockSshExec.mockReturnValue({ stdout: '', stderr: 'Permission denied', status: 255 })

    expect(() => logs({ name: 'worker' })).toThrow('Permission denied')
  })

  it('keeps local capturePane path for local agents', () => {
    mockGetAgent.mockReturnValue({
      cli: 'pi',
      model: 'gpt-5',
      tmuxSession: 'flt-local',
      parentName: 'human',
      dir: '/tmp/w',
      spawnedAt: new Date().toISOString(),
    })
    mockHasSession.mockReturnValue(true)
    mockCapturePane.mockReturnValue('local-log')

    logs({ name: 'local' })

    expect(mockHasSession).toHaveBeenCalledWith('flt-local')
    expect(mockCapturePane).toHaveBeenCalledWith('flt-local', 100)
    expect(mockSshExec).not.toHaveBeenCalled()
    expect(printed[0]).toBe('local-log')
  })

  afterAll(() => {
    console.log = originalLog
    mock.restore()
  })
})
