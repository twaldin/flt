import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test'
import { join } from 'path'

import { _depsForTest, _fsForTest, addRemote, listRemotes, removeRemote } from '../../src/commands/remote'

// Collaborators are swapped via the _depsForTest/_fsForTest seams instead of
// mock.module('../../src/ssh' | '../../src/remotes'): bun module mocks are
// process-global and leak into later test files (remotes.test.ts fails when
// file order puts this file first — observed on linux CI).
const mockSshExecCheck = mock((_remote: unknown, _cmd: string) => true as true | { error: string })
const mockSshExec = mock((_remote: unknown, _cmd: string) => ({ stdout: '', stderr: '', status: 0 }))
const mockRsyncTo = mock((_remote: unknown, _local: string, _remotePath: string, _opts?: unknown) => {})

const mockAddRemote = mock((_alias: string, _entry: unknown) => {})
const mockLoadRemotes = mock(() => ({}))
const mockRemoveRemote = mock((_alias: string) => true)

const mockExistsSync = mock((_path: string) => true)
const mockMkdtempSync = mock((_prefix: string) => '/tmp/flt-remote-test')

describe('remote commands', () => {
  const originalFetch = globalThis.fetch
  const originalWrite = Bun.write
  const originalConsoleLog = console.log
  const originalConsoleWarn = console.warn
  const originalHome = process.env.HOME
  const originalExistsSync = _fsForTest.existsSync
  const originalMkdtempSync = _fsForTest.mkdtempSync
  const originalDeps = { ..._depsForTest }
  const logSpy = mock((..._args: unknown[]) => {})
  const warnSpy = mock((..._args: unknown[]) => {})
  let downloadDir: string

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
    downloadDir = `/tmp/flt-remote-test-${crypto.randomUUID()}`
    mockMkdtempSync.mockImplementation(() => downloadDir)
    _fsForTest.existsSync = mockExistsSync
    _fsForTest.mkdtempSync = mockMkdtempSync

    _depsForTest.sshExecCheck = mockSshExecCheck
    _depsForTest.sshExec = mockSshExec
    _depsForTest.rsyncTo = mockRsyncTo
    _depsForTest.addRemoteEntry = mockAddRemote
    _depsForTest.loadRemotes = mockLoadRemotes
    _depsForTest.removeRemoteEntry = mockRemoveRemote

    globalThis.fetch = mock(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })) as unknown as typeof fetch
    Bun.write = mock(async () => 3) as typeof Bun.write

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
    expect(globalThis.fetch).toHaveBeenCalled()
    expect(Bun.write).toHaveBeenCalledWith(join(downloadDir, 'flt'), expect.any(Uint8Array))
    expect(mockSshExec).toHaveBeenCalledWith(
      { host: 'example.com', user: 'alice', port: 2200, identityFile: '/tmp/key' },
      'mkdir -p ~/.flt/bin',
    )
    expect(mockRsyncTo).toHaveBeenNthCalledWith(
      1,
      { host: 'example.com', user: 'alice', port: 2200, identityFile: '/tmp/key' },
      join(downloadDir, 'flt'),
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
    globalThis.fetch = originalFetch
    Bun.write = originalWrite
    console.log = originalConsoleLog
    console.warn = originalConsoleWarn
    process.env.HOME = originalHome
    _fsForTest.existsSync = originalExistsSync
    _fsForTest.mkdtempSync = originalMkdtempSync
    Object.assign(_depsForTest, originalDeps)
    mock.restore()
  })
})
