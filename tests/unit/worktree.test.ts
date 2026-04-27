import { afterEach, describe, expect, it } from 'bun:test'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createWorktree } from '../../src/worktree'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim()
}

function initRepo(): string {
  const repoDir = mkdtempSync(join(tmpdir(), 'flt-worktree-test-repo-'))
  git(repoDir, 'init')
  git(repoDir, 'config', 'user.email', 'test@example.com')
  git(repoDir, 'config', 'user.name', 'Test User')
  git(repoDir, 'checkout', '-b', 'main')
  writeFileSync(join(repoDir, 'README.md'), 'base\n')
  git(repoDir, 'add', 'README.md')
  git(repoDir, 'commit', '-m', 'base')
  return repoDir
}

function uniqueAgentName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
}

const cleanupPaths = new Set<string>()

afterEach(() => {
  for (const path of cleanupPaths) {
    rmSync(path, { recursive: true, force: true })
  }
  cleanupPaths.clear()
})

describe('createWorktree', () => {
  it('fresh spawn: branch does not exist and worktree is created from HEAD', () => {
    const repoDir = initRepo()
    cleanupPaths.add(repoDir)

    const agentName = uniqueAgentName('fresh')
    const wt = createWorktree(repoDir, agentName)
    cleanupPaths.add(wt.path)

    expect(git(repoDir, 'rev-parse', wt.branch)).toBe(git(repoDir, 'rev-parse', 'HEAD'))
    expect(git(wt.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(wt.branch)
  })

  it('retry with prior commits: preserves existing branch tip and commits', () => {
    const repoDir = initRepo()
    cleanupPaths.add(repoDir)

    const agentName = uniqueAgentName('preserve')
    const first = createWorktree(repoDir, agentName)
    cleanupPaths.add(first.path)

    writeFileSync(join(first.path, 'feature.txt'), 'hello\n')
    git(first.path, 'add', 'feature.txt')
    git(first.path, 'commit', '-m', 'feature work')

    const beforeRetryTip = git(repoDir, 'rev-parse', first.branch)
    expect(beforeRetryTip).not.toBe(git(repoDir, 'rev-parse', 'HEAD'))

    const second = createWorktree(repoDir, agentName)
    cleanupPaths.add(second.path)

    expect(second.path).toBe(first.path)
    expect(git(repoDir, 'rev-parse', second.branch)).toBe(beforeRetryTip)
    expect(git(second.path, 'rev-parse', 'HEAD')).toBe(beforeRetryTip)
  })

  it('stale recreation: branch at HEAD with no unique work can be safely recreated', () => {
    const repoDir = initRepo()
    cleanupPaths.add(repoDir)

    const agentName = uniqueAgentName('stale')
    const first = createWorktree(repoDir, agentName)
    cleanupPaths.add(first.path)

    expect(git(repoDir, 'rev-list', '--count', `${first.branch}`, '--not', 'HEAD')).toBe('0')

    git(repoDir, 'worktree', 'remove', '--force', first.path)

    const second = createWorktree(repoDir, agentName)
    cleanupPaths.add(second.path)

    expect(git(repoDir, 'rev-list', '--count', `${second.branch}`, '--not', 'HEAD')).toBe('0')
    expect(git(second.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(second.branch)
    expect(git(repoDir, 'rev-parse', second.branch)).toBe(git(repoDir, 'rev-parse', 'HEAD'))
  })
})
