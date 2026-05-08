import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test'

const mockSshExecCheck = mock((_remote: unknown, _cmd: string) => true as true | { error: string })
const mockSshExec = mock((_remote: unknown, _cmd: string) => ({ stdout: '', stderr: '', status: 0 }))
const mockRsyncTo = mock((_remote: unknown, _local: string, _remotePath: string, _opts?: unknown) => {})

const mockAddRemote = mock((_alias: string, _entry: unknown) => {})
const mockLoadRemotes = mock(() => ({}))
const mockRemoveRemote = mock((_alias: string) => true)

const mockExistsSync = mock((_path: string) => true)
const mockMkdtempSync = mock((_prefix: string) => '/tmp/flt-remote-test')
const mockTmpdir = mock(() => '/tmp')
const mockFetch = mock(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
const mockBunWrite = mock(async () => 3)

mock.module('../../src/ssh', () => ({
  sshExecCheck: mockSshExecCheck,
  sshExec: mockSshExec,
  rsyncTo: mockRsyncTo,
}))

mock.module('../../src/remotes', () => ({
  addRemote: mockAddRemote,
  loadRemotes: mockLoadRemotes,
  removeRemote: mockRemoveRemote,
}))

import { _setRemoteCommandDepsForTest, addRemote, listRemotes, removeRemote } from '../../src/commands/remote'

describe('remote commands', () => {
  const logSpy = mock((..._args: unknown[]) => {})
  const warnSpy = mock((..._args: unknown[]) => {})

  beforeEach(() => {
    process.env.HOME = '/tmp/home-remote-tests'

    mockSshExecCheck.mockReset()
    mockSshExecCheck.mockImplementation(() => true)

    mockSshExec.mockReset()
    mockSshExec.mockImplementation((_remote, cmd) => {
      if (cmd === 'uname -m && uname -s') {
        return { stdout: 'x86_64\nLinux\n', stderr: '', status: 0 }
      }
      return { stdout: '', stderr: '', status: 0 }
    })

    mockRsyncTo.mockReset()
    mockAddRemote.mockReset()
    mockLoadRemotes.mockReset()
    mockLoadRemotes.mockImplementation(() => ({}))
    mockRemoveRemote.mockReset()
    mockRemoveRemote.mockImplementation(() => true)
    mockExistsSync.mockReset()
    mockExistsSync.mockImplementation(() => true)
    mockMkdtempSync.mockReset()
    mockMkdtempSync.mockImplementation(() => '/tmp/flt-remote-test')
    mockTmpdir.mockReset()
    mockTmpdir.mockImplementation(() => '/tmp')

    mockFetch.mockReset()
    mockFetch.mockImplementation(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
    mockBunWrite.mockReset()
    mockBunWrite.mockImplementation(async () => 3)
    _setRemoteCommandDepsForTest({
      existsSync: mockExistsSync as typeof import('fs').existsSync,
      mkdtempSync: mockMkdtempSync as typeof import('fs').mkdtempSync,
      tmpdir: mockTmpdir as typeof import('os').tmpdir,
      fetch: mockFetch as typeof fetch,
      bunWrite: mockBunWrite as typeof Bun.write,
    })

    console.log = logSpy as typeof console.log
    console.warn = warnSpy as typeof console.warn
    logSpy.mockReset()
    warnSpy.mockReset()
  })

  it('addRemote happy path persists and syncs', async () => {
    await addRemote({ alias: 'prod', host: 'example.com', user: 'alice', port: 2200, identityFile: '/tmp/key' })

    expect(mockSshExecCheck).toHaveBeenCalledWith(
      { host: 'example.com', user: 'alice', port: 2200, identityFile: '/tmp/key' },
      'true',
    )
    expect(mockFetch).toHaveBeenCalled()
    expect(mockBunWrite).toHaveBeenCalledWith('/tmp/flt-remote-test/flt', expect.any(Uint8Array))
    expect(mockSshExec).toHaveBeenCalledWith(
      { host: 'example.com', user: 'alice', port: 2200, identityFile: '/tmp/key' },
      'mkdir -p ~/.flt/bin',
    )
    expect(mockRsyncTo).toHaveBeenNthCalledWith(
      1,
      { host: 'example.com', user: 'alice', port: 2200, identityFile: '/tmp/key' },
      '/tmp/flt-remote-test/flt',
      '~/.flt/bin/flt',
      { isDirectory: false },
    )
    expect(mockRsyncTo).toHaveBeenNthCalledWith(
      2,
      { host: 'example.com', user: 'alice', port: 2200, identityFile: '/tmp/key' },
      '/tmp/home-remote-tests/.flt/skills',
      '~/.flt/skills/',
      { isDirectory: true },
    )
    expect(mockAddRemote).toHaveBeenCalledWith('prod', {
      host: 'example.com',
      user: 'alice',
      port: 2200,
      identityFile: '/tmp/key',
    })
  })

  it('addRemote rejects on auth probe failure and does not persist', async () => {
    mockSshExecCheck.mockImplementation(() => ({ error: 'SSH authentication failed for example.com: Permission denied (publickey).' }))

    await expect(addRemote({ alias: 'prod', host: 'example.com' })).rejects.toThrow('SSH authentication probe failed')
    expect(mockAddRemote).not.toHaveBeenCalled()
  })

  it('addRemote rejects on unknown arch', async () => {
    mockSshExec.mockImplementation((_remote, cmd) => {
      if (cmd === 'uname -m && uname -s') return { stdout: 'riscv64\nLinux\n', stderr: '', status: 0 }
      return { stdout: '', stderr: '', status: 0 }
    })

    await expect(addRemote({ alias: 'prod', host: 'example.com' })).rejects.toThrow('Unsupported remote architecture')
    expect(mockAddRemote).not.toHaveBeenCalled()
  })

  it('listRemotes prints empty state', () => {
    mockLoadRemotes.mockImplementation(() => ({}))
    listRemotes()
    expect(logSpy).toHaveBeenCalledWith('No remotes configured. Use "flt add remote <alias> <host>" to add one.')
  })

  it('listRemotes prints table rows', () => {
    mockLoadRemotes.mockImplementation(() => ({
      prod: { host: 'example.com', user: 'alice', port: 2222, identityFile: '/tmp/key' },
    }))

    listRemotes()
    expect(logSpy).toHaveBeenCalledTimes(3)
  })

  it('removeRemote handles existing and missing aliases', () => {
    mockRemoveRemote.mockImplementationOnce(() => true).mockImplementationOnce(() => false)

    removeRemote('prod')
    removeRemote('missing')

    expect(logSpy).toHaveBeenNthCalledWith(1, 'Removed remote "prod".')
    expect(logSpy).toHaveBeenNthCalledWith(2, 'No such remote: "missing".')
  })

  afterAll(() => {
    _setRemoteCommandDepsForTest(null)
    mock.restore()
  })
})
