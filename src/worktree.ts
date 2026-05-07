import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs'

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

export function createWorktree(repoDir: string, agentName: string, baseBranch?: string, branchPrefix?: string): WorktreeInfo {
  const prefix = (branchPrefix ?? 'flt').replace(/\/$/, '')
  const branch = `${prefix}/${agentName}`
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
      ensureWorktreeExclude(wtPath)
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

  // Per-worktree exclude (.git/info/exclude — never committed). Keeps flt's
  // agent scratch dirs (.flt/, handoffs/, .harness-backup-*) out of `git
  // status` / `git add -A` for THIS worktree only without dirtying the
  // committed .gitignore.
  ensureWorktreeExclude(wtPath)

  return { path: wtPath, branch }
}

/**
 * Per-worktree git exclude (.git/info/exclude). For linked worktrees the
 * info dir lives at .git/worktrees/<name>/info/exclude; we resolve it via
 * `git rev-parse --git-path info/exclude` so it works for both linked and
 * the main worktree.
 */
function ensureWorktreeExclude(wtPath: string): void {
  let excludePath: string
  try {
    excludePath = gitNoThrowOutput(wtPath, 'rev-parse', '--git-path', 'info/exclude') ?? ''
    if (!excludePath) return
    if (!excludePath.startsWith('/')) excludePath = join(wtPath, excludePath)
  } catch { return }
  let body = ''
  try { body = existsSync(excludePath) ? readFileSync(excludePath, 'utf-8') : '' } catch { return }
  const lines = body.split('\n')
  const has = (entry: string) => lines.some(l => l.trim() === entry)
  const additions: string[] = []
  if (!has('.flt/')) additions.push('.flt/')
  if (!has('handoffs/')) additions.push('handoffs/')
  if (!has('.harness-backup-*')) additions.push('.harness-backup-*')
  if (additions.length === 0) return
  try {
    mkdirSync(dirname(excludePath), { recursive: true })
    const sep = body.length > 0 && !body.endsWith('\n') ? '\n' : ''
    const block = `${sep}\n# flt agent fleet (per-worktree, not committed)\n${additions.join('\n')}\n`
    writeFileSync(excludePath, body + block)
  } catch { /* best-effort */ }
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

/**
 * Best-effort cleanup of git state left behind by a prior aborted spawn so a
 * fresh `createWorktree` call has a clean slate (issue #92).
 *
 * Steps:
 *   1. `git worktree prune` — drops registrations whose target dir is gone.
 *      Without this, `git worktree add` can fail with "branch already
 *      checked out at <deleted-path>".
 *   2. If the target branch exists but no live worktree references it,
 *      delete the branch. This forces a fresh `worktree add -b ... HEAD`
 *      below rather than reusing an unknown branch tip from a prior
 *      attempt that may have been left in a bad state.
 *
 * Returns the action taken so callers can log it. Never throws —
 * createWorktree's branch-handling is the source of truth and will surface
 * any genuine git failures.
 */
export function reconcileStaleBranchForFreshSpawn(
  repoDir: string,
  agentName: string,
  branchPrefix?: string,
): { action: 'none' | 'pruned' | 'deleted-stale-branch' } {
  const prefix = (branchPrefix ?? 'flt').replace(/\/$/, '')
  const branch = `${prefix}/${agentName}`

  gitNoThrow(repoDir, 'worktree', 'prune')

  const branchExists = gitNoThrowOutput(repoDir, 'rev-parse', '--verify', branch) !== null
  if (!branchExists) return { action: 'pruned' }

  const list = gitNoThrowOutput(repoDir, 'worktree', 'list', '--porcelain') ?? ''
  const branchRef = `refs/heads/${branch}`
  const branchHasWorktree = list.split('\n').some(line => line === `branch ${branchRef}`)
  if (branchHasWorktree) return { action: 'pruned' }

  // Orphan branch (no live worktree) — delete so createWorktree can fall
  // through to the fresh-branch path.
  gitNoThrow(repoDir, 'branch', '-D', branch)
  return { action: 'deleted-stale-branch' }
}

export function isGitRepo(dir: string): boolean {
  return gitNoThrowOutput(dir, 'rev-parse', '--is-inside-work-tree') === 'true'
}
