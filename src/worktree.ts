import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'

export interface WorktreeInfo {
  path: string
  branch: string
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', timeout: 15_000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
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

  // Auto-add flt agent scratch dirs to project's .gitignore so per-spawn
  // bootstrap.md / handoffs/ never leak into committed history. Only adds the
  // entries that are actually missing.
  ensureFltGitignore(repoDir)

  return { path: wtPath, branch }
}

/**
 * Ensures `.flt/` and `handoffs/` are present in the repo's root .gitignore.
 * Idempotent. Safe on missing .gitignore (creates it). No commit — just edits
 * the working tree; users opt in to staging the change.
 */
export function ensureFltGitignore(repoDir: string): void {
  const path = join(repoDir, '.gitignore')
  let body = ''
  try { body = existsSync(path) ? readFileSync(path, 'utf-8') : '' } catch { return }
  const lines = body.split('\n')
  const has = (entry: string) => lines.some(l => l.trim() === entry)
  const additions: string[] = []
  if (!has('.flt/')) additions.push('.flt/')
  if (!has('handoffs/')) additions.push('handoffs/')
  if (additions.length === 0) return
  const sep = body.length > 0 && !body.endsWith('\n') ? '\n' : ''
  const block = `${sep}\n# flt agent fleet artifacts (per-spawn scratch + handoff docs)\n${additions.join('\n')}\n`
  try { writeFileSync(path, body + block) } catch { /* best-effort */ }
}

export function removeWorktree(repoDir: string, wtPath: string, branch: string): void {
  gitNoThrow(repoDir, 'worktree', 'remove', '--force', wtPath)
  gitNoThrow(repoDir, 'branch', '-D', branch)
  gitNoThrow(repoDir, 'worktree', 'prune')
}

export function isGitRepo(dir: string): boolean {
  return gitNoThrow(dir, 'rev-parse', '--is-inside-work-tree') === 'true'
}
