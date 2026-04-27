import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs'

export interface WorktreeInfo {
  path: string
  branch: string
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', timeout: 15_000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

function gitNoThrowOutput(cwd: string, ...args: string[]): string | null {
  try {
    return git(cwd, ...args)
  } catch {
    return null
  }
}

function gitNoThrow(cwd: string, ...args: string[]): boolean {
  return gitNoThrowOutput(cwd, ...args) !== null
}

function parseCount(value: string | null): number {
  return Number(value ?? '0') || 0
}

export function createWorktree(repoDir: string, agentName: string, baseBranch?: string): WorktreeInfo {
  const branch = `flt/${agentName}`
  const wtPath = join(tmpdir(), `flt-wt-${agentName}`)
  let wtFreshlyCreated = false

  gitNoThrow(repoDir, 'fetch', 'origin', branch)

  const branchExists = gitNoThrowOutput(repoDir, 'rev-parse', '--verify', branch) !== null
  const remoteExists = gitNoThrowOutput(repoDir, 'rev-parse', '--verify', `origin/${branch}`) !== null

  if (branchExists && remoteExists) {
    const remoteAhead = parseCount(gitNoThrowOutput(repoDir, 'rev-list', '--count', `${branch}..origin/${branch}`))
    const localAheadOfRemote = parseCount(gitNoThrowOutput(repoDir, 'rev-list', '--count', `origin/${branch}..${branch}`))
    if (remoteAhead > 0 && localAheadOfRemote === 0) {
      gitNoThrow(repoDir, 'branch', '-f', branch, `origin/${branch}`)
    }
  }

  if (existsSync(wtPath)) {
    const worktreeBranch = gitNoThrowOutput(wtPath, 'rev-parse', '--abbrev-ref', 'HEAD')
    if (worktreeBranch === branch) {
      if (remoteExists) {
        gitNoThrow(wtPath, 'merge', '--ff-only', `origin/${branch}`)
      }
      ensureFltGitignore(repoDir)
      return { path: wtPath, branch }
    }
    gitNoThrow(repoDir, 'worktree', 'remove', '--force', wtPath)
    gitNoThrow(repoDir, 'worktree', 'prune')
    if (existsSync(wtPath)) {
      rmSync(wtPath, { recursive: true, force: true })
    }
  }

  if (baseBranch) {
    gitNoThrow(repoDir, 'branch', '-D', branch)
    gitNoThrow(repoDir, 'worktree', 'prune')
    git(repoDir, 'worktree', 'add', '-b', branch, wtPath, baseBranch)
    wtFreshlyCreated = true
  } else if (branchExists) {
    // Always preserve an existing branch — its tip may carry workflow auto-
    // commits we must not lose. The previous heuristic counted commits in
    // <branch> not in HEAD; that returns 0 when main has advanced past the
    // branch and wrongly looked like "no work", deleting real commits.
    git(repoDir, 'worktree', 'add', wtPath, branch)
    wtFreshlyCreated = true
    if (remoteExists) {
      gitNoThrow(wtPath, 'merge', '--ff-only', `origin/${branch}`)
    }
  } else {
    git(repoDir, 'worktree', 'add', '-b', branch, wtPath, 'HEAD')
    wtFreshlyCreated = true
  }

  if (wtFreshlyCreated) {
    runWorktreeSetup(repoDir, wtPath)
  }

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

function runWorktreeSetup(repoDir: string, wtPath: string): void {
  const hookPath = join(repoDir, '.flt', 'worktree-setup.sh')
  if (existsSync(hookPath)) {
    try {
      execFileSync(hookPath, [wtPath, repoDir], {
        stdio: 'inherit',
        timeout: 120_000,
      })
    } catch (error) {
      process.stderr.write(`flt: .flt/worktree-setup.sh failed: ${(error as Error).message}\n`)
    }
    return
  }

  symlinkGitignoredEntries(repoDir, wtPath)
}

function symlinkGitignoredEntries(repoDir: string, wtPath: string): void {
  let gitignoreBody: string
  try {
    gitignoreBody = readFileSync(join(repoDir, '.gitignore'), 'utf-8')
  } catch {
    return
  }

  const entries = gitignoreBody
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && !line.startsWith('!'))
    .filter(line => !line.includes('/') && !line.includes('*') && !line.includes('?'))
    .map(line => line.replace(/^\/+|\/+$/g, ''))

  const seen = new Set<string>()
  for (const entry of entries) {
    if (!entry || seen.has(entry)) continue
    seen.add(entry)

    const src = join(repoDir, entry)
    const dst = join(wtPath, entry)
    if (!existsSync(src)) continue
    if (existsSync(dst)) continue

    try {
      symlinkSync(src, dst)
    } catch (error) {
      process.stderr.write(`flt: failed to symlink ${entry}: ${(error as Error).message}\n`)
    }
  }
}

export function removeWorktree(repoDir: string, wtPath: string, branch: string): void {
  gitNoThrow(repoDir, 'worktree', 'remove', '--force', wtPath)
  gitNoThrow(repoDir, 'branch', '-D', branch)
  gitNoThrow(repoDir, 'worktree', 'prune')
}

export function isGitRepo(dir: string): boolean {
  return gitNoThrowOutput(dir, 'rev-parse', '--is-inside-work-tree') === 'true'
}
