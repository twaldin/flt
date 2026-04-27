import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { execSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { redactSecrets } from '../../src/redact'

describe('redactSecrets', () => {
  let prevCwd = ''
  let repoDir = ''

  beforeEach(() => {
    prevCwd = process.cwd()
    repoDir = mkdtempSync(join(tmpdir(), 'flt-redact-'))
    execSync('git init', { cwd: repoDir, stdio: 'ignore' })
    execSync('git config user.email "me@example.com"', { cwd: repoDir, stdio: 'ignore' })
    process.chdir(repoDir)
  })

  afterEach(() => {
    process.chdir(prevCwd)
    rmSync(repoDir, { recursive: true, force: true })
  })

  it('redacts every supported secret kind', () => {
    const input = [
      'API_KEY=abc123',
      'AUTH_TOKEN: xyz789',
      'Bearer tokenvalue12345',
      'sk-abcdefghijklmnop1234567890',
      'pk-abcdefghijklmnop1234567890',
      'ghp_abcdefghijklmnop1234567890',
      'github_pat_abcdefghijklmnop_1234567890',
      'AKIAABCDEFGHIJKLMNOP',
      'abcd1234abcd1234abcd1234abcd1234',
      'other@example.com',
    ].join('\n')

    const out = redactSecrets(input)
    expect(out).toContain('<REDACTED:API_KEY>')
    expect(out).toContain('<REDACTED:AUTH_TOKEN>')
    expect(out).toContain('<REDACTED:BEARER>')
    expect(out).toContain('<REDACTED:SK>')
    expect(out).toContain('<REDACTED:PK>')
    expect(out).toContain('<REDACTED:GHP>')
    expect(out).toContain('<REDACTED:GITHUB_PAT>')
    expect(out).toContain('<REDACTED:AWS_KEY>')
    expect(out).toContain('<REDACTED:RANDOM>')
    expect(out).toContain('<REDACTED:EMAIL>')
  })

  it('keeps git committer email and redacts other emails', () => {
    const out = redactSecrets('me@example.com\nother@example.com\n')
    expect(out).toContain('me@example.com')
    expect(out).toContain('<REDACTED:EMAIL>')
  })
})
