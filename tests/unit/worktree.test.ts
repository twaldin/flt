import { afterEach, describe, expect, it } from 'bun:test'
import { execFileSync } from 'child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'fs'
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

  it('preserves branch when main has advanced past it (branch is ancestor of HEAD)', () => {
    const repoDir = initRepo()
    cleanupPaths.add(repoDir)

    const agentName = uniqueAgentName('main-advanced')
    const first = createWorktree(repoDir, agentName)
    cleanupPaths.add(first.path)

    writeFileSync(join(first.path, 'feature.txt'), 'work\n')
    git(first.path, 'add', 'feature.txt')
    git(first.path, 'commit', '-m', 'agent work')
    const branchTip = git(repoDir, 'rev-parse', first.branch)

    // Advance main so the branch becomes an ancestor of HEAD: ff-merge the
    // branch into main, then add a follow-on commit on main. This is the
    // shape that previously triggered branchHasWork=false → branch deletion.
    git(repoDir, 'merge', '--ff-only', first.branch)
    writeFileSync(join(repoDir, 'main-followon.txt'), 'after\n')
    git(repoDir, 'add', 'main-followon.txt')
    git(repoDir, 'commit', '-m', 'main followon')

    expect(git(repoDir, 'rev-list', '--count', `${first.branch}`, '--not', 'HEAD')).toBe('0')
    expect(git(repoDir, 'merge-base', '--is-ancestor', first.branch, 'HEAD').length).toBe(0)

    // Remove the worktree so createWorktree must recreate it.
    git(repoDir, 'worktree', 'remove', '--force', first.path)

    const second = createWorktree(repoDir, agentName)
    cleanupPaths.add(second.path)

    expect(second.branch).toBe(first.branch)
    expect(git(repoDir, 'rev-parse', second.branch)).toBe(branchTip)
    expect(git(second.path, 'rev-parse', 'HEAD')).toBe(branchTip)
    expect(existsSync(join(second.path, 'feature.txt'))).toBe(true)
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

  it('runs .flt/worktree-setup.sh when present and passes wtPath/repoDir args', () => {
    const repoDir = initRepo()
    cleanupPaths.add(repoDir)

    mkdirSync(join(repoDir, '.flt'), { recursive: true })
    const markerPath = join(repoDir, '.hook-args')
    const scriptPath = join(repoDir, '.flt', 'worktree-setup.sh')
    writeFileSync(scriptPath, `#!/bin/sh\nprintf "%s\\n%s\\n" "$1" "$2" > "${markerPath}"\n`)
    chmodSync(scriptPath, 0o755)

    const agentName = uniqueAgentName('hook-runs')
    const wt = createWorktree(repoDir, agentName)
    cleanupPaths.add(wt.path)

    expect(existsSync(markerPath)).toBe(true)
    const [arg1, arg2] = readFileSync(markerPath, 'utf-8').trim().split('\n')
    expect(arg1).toBe(wt.path)
    expect(arg2).toBe(repoDir)
  })

  it('does not block worktree creation when .flt/worktree-setup.sh fails', () => {
    const repoDir = initRepo()
    cleanupPaths.add(repoDir)

    mkdirSync(join(repoDir, '.flt'), { recursive: true })
    const scriptPath = join(repoDir, '.flt', 'worktree-setup.sh')
    writeFileSync(scriptPath, '#!/bin/sh\nexit 1\n')
    chmodSync(scriptPath, 0o755)

    const agentName = uniqueAgentName('hook-fails')
    const wt = createWorktree(repoDir, agentName)
    cleanupPaths.add(wt.path)

    expect(existsSync(wt.path)).toBe(true)
    expect(git(wt.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(wt.branch)
  })

  it('symlinks top-level gitignored entries when no hook exists', () => {
    const repoDir = initRepo()
    cleanupPaths.add(repoDir)

    writeFileSync(join(repoDir, '.gitignore'), 'node_modules\n.env\n')
    mkdirSync(join(repoDir, 'node_modules'), { recursive: true })
    writeFileSync(join(repoDir, 'node_modules', 'pkg.txt'), 'pkg\n')
    writeFileSync(join(repoDir, '.env'), 'SECRET=1\n')

    const agentName = uniqueAgentName('symlink-top-level')
    const wt = createWorktree(repoDir, agentName)
    cleanupPaths.add(wt.path)

    const wtNodeModules = join(wt.path, 'node_modules')
    const wtEnv = join(wt.path, '.env')

    expect(lstatSync(wtNodeModules).isSymbolicLink()).toBe(true)
    expect(lstatSync(wtEnv).isSymbolicLink()).toBe(true)
    expect(readlinkSync(wtNodeModules)).toBe(join(repoDir, 'node_modules'))
    expect(readlinkSync(wtEnv)).toBe(join(repoDir, '.env'))
  })

  it('does not symlink nested or glob gitignore patterns', () => {
    const repoDir = initRepo()
    cleanupPaths.add(repoDir)

    writeFileSync(join(repoDir, '.gitignore'), 'foo/bar\n*.log\n')
    mkdirSync(join(repoDir, 'foo'), { recursive: true })
    writeFileSync(join(repoDir, 'foo', 'bar'), 'nested\n')
    writeFileSync(join(repoDir, 'test.log'), 'log\n')

    const agentName = uniqueAgentName('symlink-skip-patterns')
    const wt = createWorktree(repoDir, agentName)
    cleanupPaths.add(wt.path)

    expect(existsSync(join(wt.path, 'foo', 'bar'))).toBe(false)
    expect(existsSync(join(wt.path, 'test.log'))).toBe(false)
  })
})
