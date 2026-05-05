import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  addRemote,
  getRemote,
  getRemotesPath,
  loadRemotes,
  removeRemote,
  resolveRemote,
  saveRemotes,
} from '../../src/remotes'

describe('remotes', () => {
  let tempDir: string
  let originalHome: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'flt-test-remotes-'))
    originalHome = process.env.HOME
    process.env.HOME = tempDir
  })

  afterEach(() => {
    process.env.HOME = originalHome
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns empty map when remotes file is missing', () => {
    expect(loadRemotes()).toEqual({})
  })

  it('adds, gets, lists and removes remotes', () => {
    addRemote('prod', { host: 'prod.example.com', user: 'deploy', port: 2222 })

    expect(getRemote('prod')).toEqual({
      host: 'prod.example.com',
      user: 'deploy',
      port: 2222,
      identityFile: undefined,
    })

    expect(loadRemotes()).toEqual({
      prod: { host: 'prod.example.com', user: 'deploy', port: 2222, identityFile: undefined },
    })

    expect(removeRemote('prod')).toBe(true)
    expect(removeRemote('prod')).toBe(false)
    expect(getRemote('prod')).toBeUndefined()
  })

  it('resolves alias hit from remotes file', () => {
    saveRemotes({
      box: { host: '10.1.2.3', user: 'root', identityFile: '~/.ssh/id_ed25519' },
    })

    expect(resolveRemote('box')).toEqual({
      host: '10.1.2.3',
      user: 'root',
      port: undefined,
      identityFile: '~/.ssh/id_ed25519',
    })
  })

  it('resolves alias miss as raw host fallback', () => {
    expect(resolveRemote('raw.example.com')).toEqual({
      host: 'raw.example.com',
      user: undefined,
      port: undefined,
      identityFile: undefined,
    })
  })

  it('persists map as pretty JSON with trailing newline and round-trips', () => {
    saveRemotes({
      a: { host: 'a.example.com' },
      z: { host: 'z.example.com', user: 'ubuntu', port: 2200 },
    })

    expect(loadRemotes()).toEqual({
      a: { host: 'a.example.com', user: undefined, port: undefined, identityFile: undefined },
      z: { host: 'z.example.com', user: 'ubuntu', port: 2200, identityFile: undefined },
    })

    const persisted = readFileSync(getRemotesPath(), 'utf-8')
    expect(persisted.endsWith('\n')).toBe(true)
    expect(persisted).toContain('"a"')
    expect(persisted).toContain('"z"')
  })

  it('rejects invalid aliases and empty hosts', () => {
    expect(() => addRemote('bad alias', { host: 'ok.example.com' })).toThrow('Remote alias must')
    expect(() => addRemote('ok', { host: '   ' })).toThrow('"host" must be a non-empty string')
    expect(() => resolveRemote('   ')).toThrow('Remote alias/host must be non-empty')
  })

  it('rejects host with shell metacharacters', () => {
    expect(() => addRemote('bad', { host: 'host;rm -rf /' })).toThrow('"host" must be alphanumeric')
    expect(() => addRemote('bad2', { host: 'host$(evil)' })).toThrow('"host" must be alphanumeric')
  })

  it('rejects user with shell metacharacters', () => {
    expect(() => addRemote('ok', { host: 'safe.example.com', user: 'user;evil' })).toThrow('"user" must be alphanumeric')
    expect(() => addRemote('ok2', { host: 'safe.example.com', user: 'user name' })).toThrow('"user" must be alphanumeric')
  })
})
