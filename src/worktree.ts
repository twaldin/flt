import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync } from 'fs'

export interface WorktreeInfo {
  path: string
  branch: string
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', timeout: 15_000 }).trim()
}

function gitNoThrow(cwd: string, ...args: string[]): string | null {
  try {
    return git(cwd, ...args)
  } catch {
    return null
  }
}

export function createWorktree(repoDir: string, agentName: string): WorktreeInfo {
  const branch = `flt/${agentName}`
  const wtPath = join(tmpdir(), `flt-wt-${agentName}`)

  // Remove stale worktree at same path if it exists
  if (existsSync(wtPath)) {
    gitNoThrow(repoDir, 'worktree', 'remove', '--force', wtPath)
  }

  // Delete stale branch if it exists
  gitNoThrow(repoDir, 'branch', '-D', branch)

  // Prune stale worktree entries
  gitNoThrow(repoDir, 'worktree', 'prune')

  // Create new worktree on new branch from HEAD
  git(repoDir, 'worktree', 'add', '-b', branch, wtPath, 'HEAD')

  return { path: wtPath, branch }
}

export function removeWorktree(repoDir: string, wtPath: string, branch: string): void {
  gitNoThrow(repoDir, 'worktree', 'remove', '--force', wtPath)
  gitNoThrow(repoDir, 'branch', '-D', branch)
  gitNoThrow(repoDir, 'worktree', 'prune')
}

export function isGitRepo(dir: string): boolean {
  return gitNoThrow(dir, 'rev-parse', '--is-inside-work-tree') === 'true'
}
