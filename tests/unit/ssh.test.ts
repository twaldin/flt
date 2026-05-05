import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test'
import type { RemoteEntry } from '../../src/remotes'

const mockExecFileSync = mock((_file: string, _args: string[], _opts?: Record<string, unknown>) => 'ok')

mock.module('child_process', () => ({
  execFileSync: mockExecFileSync,
}))

import { buildSshArgs, rsyncTo, shellEscapeSingle, sshExec, sshExecCheck } from '../../src/ssh'

describe('ssh helpers', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset()
    mockExecFileSync.mockImplementation(() => 'ok')
  })

  it('buildSshArgs supports host-only', () => {
    expect(buildSshArgs({ host: 'example.com' })).toEqual([
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=5',
      'example.com',
    ])
  })

  it('buildSshArgs supports host+user', () => {
    expect(buildSshArgs({ host: 'example.com', user: 'alice' })).toEqual([
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=5',
      'alice@example.com',
    ])
  })

  it('buildSshArgs supports host+user+port+identityFile', () => {
    expect(buildSshArgs({ host: 'example.com', user: 'alice', port: 2200, identityFile: '~/.ssh/id' })).toEqual([
      '-p', '2200',
      '-i', '~/.ssh/id',
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=5',
      'alice@example.com',
    ])
  })

  it('buildSshArgs supports raw-host shape', () => {
    const rawHostRemote = { host: 'raw.example.com' } satisfies RemoteEntry
    expect(buildSshArgs(rawHostRemote, ['uname -a'])).toEqual([
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=5',
      'raw.example.com',
      'uname -a',
    ])
  })

  it('sshExec passes argv and returns structured result', () => {
    mockExecFileSync.mockImplementation(() => 'hello')
    const result = sshExec({ host: 'example.com', user: 'alice' }, 'echo hello', { input: 'stdin-body' })

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', 'alice@example.com', 'echo hello'],
      { encoding: 'utf-8', input: 'stdin-body', stdio: ['pipe', 'pipe', 'pipe'] },
    )
    expect(result).toEqual({ stdout: 'hello', stderr: '', status: 0 })
  })

  it('sshExecCheck returns true on success', () => {
    mockExecFileSync.mockImplementation(() => '')
    expect(sshExecCheck({ host: 'example.com' }, 'true')).toBe(true)
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', 'example.com', 'true'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
  })

  it('sshExecCheck surfaces auth/host-key failures clearly', () => {
    mockExecFileSync.mockImplementation(() => {
      const err = new Error('ssh failed') as NodeJS.ErrnoException & { status?: number; stderr?: string }
      err.status = 255
      err.stderr = 'Permission denied (publickey).\n'
      throw err
    })

    const result = sshExecCheck({ host: 'example.com' }, 'true')
    expect(result).toEqual({
      error: 'SSH authentication failed for example.com: Permission denied (publickey).',
    })
  })

  it('rsyncTo builds rsync argv for directory and file paths', () => {
    rsyncTo({ host: 'example.com', user: 'alice', port: 2200 }, '/tmp/local-dir', '/remote/path')
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      1,
      'rsync',
      ['-az', '-e', 'ssh -p 2200 -o BatchMode=yes -o ConnectTimeout=5', '/tmp/local-dir/', 'alice@example.com:/remote/path/'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    )

    rsyncTo({ host: 'example.com' }, '/tmp/file.txt', '/remote/file.txt')
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      2,
      'rsync',
      ['-az', '-e', 'ssh -o BatchMode=yes -o ConnectTimeout=5', '/tmp/file.txt', 'example.com:/remote/file.txt'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
  })

  it('shellEscapeSingle escapes embedded single quotes', () => {
    expect(shellEscapeSingle("a'b'c")).toBe("'a'\\''b'\\''c'")
  })

  afterAll(() => {
    mock.restore()
  })
})
