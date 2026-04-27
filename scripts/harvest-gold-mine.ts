import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { basename, dirname, join, relative } from 'path'
import { homedir } from 'os'

export interface RepoInfo {
  name: string
  defaultBranch: string
  url: string
  description: string | null
  isArchived: boolean
  isFork: boolean
}

interface RepoListApiRow {
  name: string
  defaultBranchRef?: { name?: string | null } | null
  url: string
  description: string | null
  isArchived: boolean
  isFork: boolean
}

export interface CommitInfo {
  sha: string
  date: string
  authorName: string
  authorEmail: string
  message: string
}

export interface PrInfo {
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed' | 'merged'
  mergedAt: string | null
}

export interface MdFile {
  source: 'github' | 'local'
  repo: string
  originalPath: string
  content: string
  inHead: boolean
  lastCommit: CommitInfo | null
  commitDepth: number
  status: 'active' | 'archived'
  linkedPr: PrInfo | null
}

export interface FixtureMetadata {
  source: 'github' | 'local'
  repo: string
  original_path: string
  last_sha: string | null
  last_date: string | null
  status: 'active' | 'archived'
  linked_pr: number | null
  commit_depth: number
}

export interface RedactionFlag {
  kind: 'secret' | 'email' | 'long-token' | 'aws-key' | 'github-token'
  pattern: string
  excerpt: string
  line: number
  replaced: boolean
}

export interface RedactionResult {
  redacted: string
  flags: RedactionFlag[]
}

export interface SummaryStats {
  reposScanned: number
  reposSkippedFork: number
  filesMatched: number
  fixturesWritten: number
  duplicatesMerged: number
  localFilesScanned: number
  localFixturesWritten: number
  topByLength: Array<{ slug: string; bytes: number }>
  topByDepth: Array<{ slug: string; commits: number }>
  suspectedLeaks: Array<{ slug: string; flags: RedactionFlag[] }>
}

interface CliOptions {
  repo?: string
  skipGithub: boolean
  skipLocal: boolean
  dryRun: boolean
  limit: number
}

interface FixtureWrite {
  slug: string
  source: 'github' | 'local'
  taskMd: string
  redactedMd: string
  acceptanceMd: string | null
  metadata: FixtureMetadata
  flags: RedactionFlag[]
}

const TASK_SHAPE_RE = /(^|\/)(spec|plan|design|proposal|acceptance|requirements|todo|roadmap|tasks?)\.md$/i
const TODO_LINE_RE = /^\s*-\s*\[(?:\s|x|X)\]\s.*(?:\r?\n|$)/gm

function shell(cmd: string, args: string[], allowFail = false): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf-8', timeout: 120_000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch (err) {
    if (allowFail) return ''
    throw err
  }
}

function gh(args: string[], allowFail = false): string {
  return shell('gh', args, allowFail)
}

function parseJson<T>(raw: string, fallback: T): T {
  if (!raw.trim()) return fallback
  return JSON.parse(raw) as T
}

function parsePaginatedArray<T>(raw: string): T[] {
  if (!raw.trim()) return []
  const parsed = JSON.parse(raw) as unknown
  if (Array.isArray(parsed)) {
    if (parsed.length > 0 && Array.isArray(parsed[0])) {
      return (parsed as T[][]).flat()
    }
    return parsed as T[]
  }
  return []
}

function slugPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.md$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function matchesTaskShape(path: string): boolean {
  return TASK_SHAPE_RE.test(path)
}

export function stripTodos(md: string): string {
  return md.replace(TODO_LINE_RE, '')
}

function lineAt(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i += 1) {
    if (text[i] === '\n') line += 1
  }
  return line
}

function excerptFor(text: string, start: number, end: number): string {
  const left = Math.max(0, start - 40)
  const right = Math.min(text.length, end + 40)
  return `${text.slice(left, start)}<REDACTED>${text.slice(end, right)}`
}

function applyRule(
  input: string,
  regex: RegExp,
  handler: (match: RegExpExecArray) => { replace: boolean; value: string; kind: RedactionFlag['kind']; pattern: string },
): { output: string; flags: RedactionFlag[] } {
  const flags: RedactionFlag[] = []
  let out = ''
  let last = 0
  regex.lastIndex = 0
  while (true) {
    const m = regex.exec(input)
    if (!m) break
    const start = m.index
    const end = start + m[0].length
    const decision = handler(m)
    flags.push({
      kind: decision.kind,
      pattern: decision.pattern,
      excerpt: excerptFor(input, start, end),
      line: lineAt(input, start),
      replaced: decision.replace,
    })
    out += input.slice(last, start)
    out += decision.replace ? decision.value : m[0]
    last = end
    if (m[0].length === 0) regex.lastIndex += 1
  }
  out += input.slice(last)
  return { output: out, flags }
}

export function redact(content: string, opts: { allowEmails: ReadonlySet<string> }): RedactionResult {
  let redacted = content
  const flags: RedactionFlag[] = []

  const rules: Array<{
    regex: RegExp
    handler: (m: RegExpExecArray) => { replace: boolean; value: string; kind: RedactionFlag['kind']; pattern: string }
  }> = [
    {
      regex: /\bghp_[A-Za-z0-9]{20,}\b/g,
      handler: () => ({ replace: true, value: '<REDACTED:GITHUB_PAT>', kind: 'github-token', pattern: 'ghp_*' }),
    },
    {
      regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
      handler: () => ({ replace: true, value: '<REDACTED:GITHUB_PAT>', kind: 'github-token', pattern: 'github_pat_*' }),
    },
    {
      regex: /\bAKIA[A-Z0-9]{16}\b/g,
      handler: () => ({ replace: true, value: '<REDACTED:AWS_KEY>', kind: 'aws-key', pattern: 'AKIA*' }),
    },
    {
      regex: /\bsk-[A-Za-z0-9]{20,}\b/g,
      handler: () => ({ replace: true, value: '<REDACTED:SK_KEY>', kind: 'secret', pattern: 'sk-*' }),
    },
    {
      regex: /\bpk-[A-Za-z0-9]{20,}\b/g,
      handler: () => ({ replace: true, value: '<REDACTED:PK_KEY>', kind: 'secret', pattern: 'pk-*' }),
    },
    {
      regex: /\bBearer\s+[A-Za-z0-9._\-]{16,}\b/g,
      handler: () => ({ replace: true, value: 'Bearer <REDACTED>', kind: 'secret', pattern: 'Bearer *' }),
    },
    {
      regex: /(API_KEY|AUTH_TOKEN)\s*[=:]\s*['"]?[^'"\s]+/g,
      handler: (m) => ({ replace: true, value: `${m[1]}=<REDACTED>`, kind: 'secret', pattern: 'API_KEY|AUTH_TOKEN' }),
    },
    {
      regex: /\/key\/[A-Za-z0-9]{16,}\//g,
      handler: () => ({ replace: true, value: '/key/<REDACTED>/', kind: 'secret', pattern: '/key/<token>/' }),
    },
    {
      regex: /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g,
      handler: (m) => {
        const email = m[0].toLowerCase()
        if (opts.allowEmails.has(email)) {
          return { replace: false, value: m[0], kind: 'email', pattern: 'email' }
        }
        return { replace: true, value: '<REDACTED:EMAIL>', kind: 'email', pattern: 'email' }
      },
    },
    {
      regex: /\b[A-Za-z0-9_\-]{32,}\b/g,
      handler: (m) => {
        if (/^[a-f0-9]{40}$/i.test(m[0])) {
          return { replace: false, value: m[0], kind: 'long-token', pattern: 'long-token(sha-guard)' }
        }
        return { replace: true, value: '<REDACTED:TOKEN>', kind: 'long-token', pattern: 'long-token' }
      },
    },
  ]

  for (const rule of rules) {
    const res = applyRule(redacted, rule.regex, rule.handler)
    redacted = res.output
    flags.push(...res.flags)
  }

  return { redacted, flags }
}

export function ghSlug(repo: string, originalPath: string): string {
  return `${slugPart(repo)}--${slugPart(originalPath)}`
}

export function localSlug(absPath: string, home: string): string {
  const rel = relative(home, absPath) || absPath
  return slugPart(rel)
}

function contentKey(file: MdFile): string {
  const stripped = stripTodos(file.content).trim()
  const stem = basename(file.originalPath).replace(/\.md$/i, '').toLowerCase()
  const hash = createHash('sha256').update(stripped).digest('hex')
  return `${hash}::${stem}`
}

export function dedupe(files: MdFile[]): { kept: MdFile[]; mergedCount: number } {
  const map = new Map<string, MdFile>()
  let mergedCount = 0

  for (const file of files) {
    const key = contentKey(file)
    const cur = map.get(key)
    if (!cur) {
      map.set(key, file)
      continue
    }

    const curDepth = cur.commitDepth
    const nextDepth = file.commitDepth
    if (nextDepth > curDepth) {
      map.set(key, file)
      mergedCount += 1
      continue
    }
    if (nextDepth < curDepth) {
      mergedCount += 1
      continue
    }

    const curDate = cur.lastCommit?.date ?? ''
    const nextDate = file.lastCommit?.date ?? ''
    if (nextDate > curDate) {
      map.set(key, file)
    }
    mergedCount += 1
  }

  return { kept: Array.from(map.values()), mergedCount }
}

export function renderAcceptance(pr: PrInfo | null, finalCommits: CommitInfo[]): string {
  if (!pr && finalCommits.length === 0) {
    return '(no acceptance signal recovered)\n'
  }

  const lines: string[] = []
  if (pr) {
    lines.push(`# Acceptance — derived from PR #${pr.number}: ${pr.title}`)
    lines.push('')
    if (pr.body && pr.body.trim()) {
      lines.push(pr.body.trim())
      lines.push('')
    }
  } else {
    lines.push('# Acceptance — derived from final commits')
    lines.push('')
  }

  if (finalCommits.length > 0) {
    lines.push('## Final commits touching this file')
    for (const commit of finalCommits) {
      const subject = commit.message.split('\n')[0]
      lines.push(`- ${commit.sha.slice(0, 7)} ${commit.date} ${commit.authorName}: ${subject}`)
    }
  }

  lines.push('')
  return `${lines.join('\n')}\n`
}

export function renderSummary(stats: SummaryStats): string {
  const lines: string[] = [
    '# Gold-Mine Harvest Summary',
    '',
    `- Repos scanned: ${stats.reposScanned}`,
    `- Repos skipped (forks): ${stats.reposSkippedFork}`,
    `- GitHub files matched: ${stats.filesMatched}`,
    `- GitHub fixtures written: ${stats.fixturesWritten}`,
    `- Duplicates merged: ${stats.duplicatesMerged}`,
    `- Local files matched: ${stats.localFilesScanned}`,
    `- Local fixtures written: ${stats.localFixturesWritten}`,
    '',
    '## Top 20 by length',
  ]

  for (const row of stats.topByLength.slice(0, 20)) {
    lines.push(`- ${row.slug}: ${row.bytes} bytes`)
  }

  lines.push('')
  lines.push('## Top 20 by depth')
  for (const row of stats.topByDepth.slice(0, 20)) {
    lines.push(`- ${row.slug}: ${row.commits} commits`)
  }

  lines.push('')
  lines.push('## Suspected leaks for human review')
  if (stats.suspectedLeaks.length === 0) {
    lines.push('- none')
  } else {
    for (const leak of stats.suspectedLeaks) {
      lines.push(`- ${leak.slug}`)
      for (const flag of leak.flags.slice(0, 10)) {
        lines.push(`  - line ${flag.line} [${flag.kind}] ${flag.pattern}`)
      }
    }
  }

  lines.push('')
  return `${lines.join('\n')}\n`
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = { skipGithub: false, skipLocal: false, dryRun: false, limit: 200 }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--repo') out.repo = argv[++i]
    else if (arg === '--skip-github') out.skipGithub = true
    else if (arg === '--skip-local') out.skipLocal = true
    else if (arg === '--dry-run') out.dryRun = true
    else if (arg === '--limit') out.limit = Math.max(1, Math.min(1000, Number(argv[++i] ?? '200') || 200))
  }
  return out
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true })
}

function cleanDir(path: string): void {
  rmSync(path, { recursive: true, force: true })
  ensureDir(path)
}

function preflight(skipGithub: boolean): void {
  ensureDir(join('tests', 'eval'))
  ensureDir(join('tests', 'eval', 'gold-mine'))
  ensureDir(join('tests', 'eval', 'gold-mine-local'))
  if (!skipGithub) {
    shell('gh', ['auth', 'status'])
  }
}

function enumerateRepos(limit: number): RepoInfo[] {
  const raw = gh(['repo', 'list', 'twaldin', '--limit', String(limit), '--json', 'name,defaultBranchRef,url,description,isArchived,isFork'])
  const rows = parseJson<RepoListApiRow[]>(raw, [])
  return rows.map((row) => ({
    name: row.name,
    defaultBranch: row.defaultBranchRef?.name ?? 'HEAD',
    url: row.url,
    description: row.description,
    isArchived: row.isArchived,
    isFork: row.isFork,
  }))
}

function listHeadTaskFiles(repo: string): string[] {
  const raw = gh(['api', `repos/twaldin/${repo}/git/trees/HEAD?recursive=1`], true)
  const parsed = parseJson<{ tree?: Array<{ path: string; type: string }> }>(raw, {})
  const tree = parsed.tree ?? []
  return tree.filter((entry) => entry.type === 'blob' && matchesTaskShape(entry.path)).map((entry) => entry.path)
}

function listHistoryTaskFiles(repo: string, headPaths: Set<string>): Array<{ path: string; sha: string }> {
  const commitsRaw = gh(['api', '--paginate', '--slurp', `repos/twaldin/${repo}/commits?per_page=100`], true)
  const commits = parsePaginatedArray<Array<{ sha: string }>>(commitsRaw).flat() as Array<{ sha: string }>
  const out = new Map<string, string>()

  for (const commit of commits.slice(0, 200)) {
    const detailRaw = gh(['api', `repos/twaldin/${repo}/commits/${commit.sha}`], true)
    if (!detailRaw.trim()) continue
    const detail = parseJson<{ files?: Array<{ filename: string; previous_filename?: string }> }>(detailRaw, {})
    for (const file of detail.files ?? []) {
      const candidates = [file.filename, file.previous_filename].filter(Boolean) as string[]
      for (const candidate of candidates) {
        if (!matchesTaskShape(candidate)) continue
        if (headPaths.has(candidate)) continue
        if (!out.has(candidate)) out.set(candidate, commit.sha)
      }
    }
  }

  return Array.from(out.entries()).map(([path, sha]) => ({ path, sha }))
}

function fetchCommitList(repo: string, path: string): CommitInfo[] {
  const encoded = encodeURIComponent(path)
  const raw = gh(['api', '--paginate', '--slurp', `repos/twaldin/${repo}/commits?path=${encoded}&per_page=100`], true)
  const pages = parsePaginatedArray<Array<{ sha: string; commit: { author: { name: string; email: string; date: string }; message: string } }>>(raw)
  const commits = pages.flat() as Array<{ sha: string; commit: { author: { name: string; email: string; date: string }; message: string } }>
  return commits.map((entry) => ({
    sha: entry.sha,
    date: entry.commit.author.date,
    authorName: entry.commit.author.name,
    authorEmail: entry.commit.author.email,
    message: entry.commit.message,
  }))
}

function fetchLinkedPr(repo: string, sha: string): PrInfo | null {
  const raw = gh(['api', `repos/twaldin/${repo}/commits/${sha}/pulls`], true)
  const prs = parseJson<Array<{ number: number; title: string; body: string | null; state: 'open' | 'closed'; merged_at: string | null }>>(raw, [])
  if (prs.length === 0) return null
  const pr = prs.find((candidate) => candidate.merged_at) ?? prs[0]
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body,
    state: pr.merged_at ? 'merged' : pr.state,
    mergedAt: pr.merged_at,
  }
}

function fetchFileContent(repo: string, path: string, ref: string): string | null {
  const encodedPath = path.split('/').map((part) => encodeURIComponent(part)).join('/')
  const raw = gh(['api', `repos/twaldin/${repo}/contents/${encodedPath}?ref=${ref}`], true)
  if (!raw.trim()) return null
  const parsed = parseJson<{ content?: string; encoding?: string }>(raw, {})
  if (parsed.encoding === 'base64' && parsed.content) {
    return Buffer.from(parsed.content.replace(/\n/g, ''), 'base64').toString('utf-8')
  }
  return null
}

function safeRead(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return null
  }
}

function walkLocal(root: string, maxDepth: number, skip: ReadonlySet<string>, out: string[], depth = 0): void {
  if (depth > maxDepth || !existsSync(root)) return
  let dirents
  try {
    dirents = readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }

  for (const dirent of dirents) {
    const path = join(root, dirent.name)
    if (dirent.isDirectory()) {
      if (skip.has(dirent.name)) continue
      walkLocal(path, maxDepth, skip, out, depth + 1)
      continue
    }
    if (dirent.isFile() && matchesTaskShape(path)) out.push(path)
  }
}

function leakScan(redactedMd: string): RedactionFlag[] {
  const result = redact(redactedMd, { allowEmails: new Set<string>() })
  return result.flags.filter((flag) => flag.replaced)
}

function writeFixture(baseDir: string, fixture: FixtureWrite, dryRun: boolean): void {
  const dir = join(baseDir, fixture.slug)
  if (dryRun) return
  ensureDir(dir)
  writeFileSync(join(dir, 'task.md'), fixture.taskMd)
  writeFileSync(join(dir, 'redacted.md'), fixture.redactedMd)
  writeFileSync(join(dir, 'metadata.json'), `${JSON.stringify(fixture.metadata, null, 2)}\n`)
  if (fixture.acceptanceMd !== null) {
    writeFileSync(join(dir, 'acceptance.md'), fixture.acceptanceMd)
  }
}

function harvestGithub(options: CliOptions): { files: MdFile[]; reposScanned: number; reposSkippedFork: number } {
  if (options.skipGithub) {
    return { files: [], reposScanned: 0, reposSkippedFork: 0 }
  }

  const repos = enumerateRepos(options.limit)
  const files: MdFile[] = []
  let reposScanned = 0
  let reposSkippedFork = 0

  for (const repo of repos) {
    if (repo.isFork) {
      reposSkippedFork += 1
      continue
    }
    if (options.repo && repo.name !== options.repo) continue

    reposScanned += 1

    const headPaths = listHeadTaskFiles(repo.name)
    const headSet = new Set(headPaths)
    const historyOnly = listHistoryTaskFiles(repo.name, headSet)

    const candidates = [
      ...headPaths.map((path) => ({ path, inHead: true, ref: 'HEAD' })),
      ...historyOnly.map((entry) => ({ path: entry.path, inHead: false, ref: entry.sha })),
    ]

    for (const candidate of candidates) {
      const content = fetchFileContent(repo.name, candidate.path, candidate.ref)
      if (content === null) continue

      const commits = fetchCommitList(repo.name, candidate.path)
      const lastCommit = commits[0] ?? null
      const linkedPr = lastCommit ? fetchLinkedPr(repo.name, lastCommit.sha) : null

      files.push({
        source: 'github',
        repo: repo.name,
        originalPath: candidate.path,
        content,
        inHead: candidate.inHead,
        lastCommit,
        commitDepth: commits.length,
        status: repo.isArchived ? 'archived' : 'active',
        linkedPr,
      })
    }
  }

  return { files, reposScanned, reposSkippedFork }
}

function harvestLocal(options: CliOptions): MdFile[] {
  if (options.skipLocal) return []

  const home = process.env.HOME || homedir()
  const roots = [join(home, 'code'), join(home, 'projects'), join(home, 'src')]
  const skip = new Set(['node_modules', '.git', 'target', 'dist', '.next', 'build', '.venv', 'venv'])
  const files: MdFile[] = []

  for (const root of roots) {
    const found: string[] = []
    walkLocal(root, 6, skip, found)
    for (const absPath of found) {
      let body: string | null = null
      try {
        if (statSync(absPath).size > 1024 * 1024) continue
      } catch {
        continue
      }
      body = safeRead(absPath)
      if (body === null) continue
      files.push({
        source: 'local',
        repo: localSlug(dirname(absPath), home),
        originalPath: relative(home, absPath),
        content: body,
        inHead: true,
        lastCommit: null,
        commitDepth: 0,
        status: 'active',
        linkedPr: null,
      })
    }
  }

  return files
}

function writeReadmeIfMissing(): void {
  const path = join('tests', 'eval', 'README.md')
  if (existsSync(path)) return
  const body = [
    '# Eval fixtures',
    '',
    'This directory stores harvested task fixtures used by the eval suite.',
    '',
    '- `gold-mine/`: GitHub-derived fixtures from `twaldin/*`.',
    '- `gold-mine-local/`: local task fixtures harvested from `~/code`, `~/projects`, and `~/src`.',
    '',
    'Each fixture contains:',
    '',
    '- `task.md`: source task/spec content with TODO checkboxes removed.',
    '- `redacted.md`: redacted variant safe for eval ingestion.',
    '- `metadata.json`: provenance metadata.',
    '- `acceptance.md`: GitHub-only acceptance signal derived from linked PRs and final commits.',
    '',
    'Downstream usage:',
    '',
    '1. Daily mutator samples fixture `redacted.md` files as mutation seeds.',
    '2. FLT eval suite replays fixtures as realistic historical tasks.',
    '3. `tests/eval/gold-mine/SUMMARY.md` is used as a quick audit for dataset freshness and leak checks.',
    '',
    'Regenerate with:',
    '',
    '```bash',
    'bun run scripts/harvest-gold-mine.ts',
    '```',
    '',
  ].join('\n')
  writeFileSync(path, body)
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  preflight(options.skipGithub)

  const github = harvestGithub(options)
  const locals = harvestLocal(options)
  const { kept, mergedCount } = dedupe([...github.files, ...locals])

  const ghOut = join('tests', 'eval', 'gold-mine')
  const localOut = join('tests', 'eval', 'gold-mine-local')
  if (!options.dryRun) {
    cleanDir(ghOut)
    cleanDir(localOut)
  }

  const fixtures: FixtureWrite[] = []

  for (const file of kept) {
    const taskMd = stripTodos(file.content)
    const allowEmails = new Set<string>()
    if (file.lastCommit?.authorEmail) allowEmails.add(file.lastCommit.authorEmail.toLowerCase())
    const gitEmail = shell('git', ['config', 'user.email'], true).toLowerCase()
    if (gitEmail && gitEmail !== 'noreply@github.com') allowEmails.add(gitEmail)

    const redaction = redact(taskMd, { allowEmails })
    const prBody = file.linkedPr?.body ? redact(file.linkedPr.body, { allowEmails }).redacted : null
    const pr: PrInfo | null = file.linkedPr ? { ...file.linkedPr, body: prBody } : null
    const acceptanceMd = file.source === 'github'
      ? renderAcceptance(pr, file.lastCommit ? [file.lastCommit] : [])
      : null

    const slug = file.source === 'github'
      ? ghSlug(file.repo, file.originalPath)
      : localSlug(file.originalPath, '.')

    fixtures.push({
      slug,
      source: file.source,
      taskMd,
      redactedMd: redaction.redacted,
      acceptanceMd,
      metadata: {
        source: file.source,
        repo: file.repo,
        original_path: file.originalPath,
        last_sha: file.lastCommit?.sha ?? null,
        last_date: file.lastCommit?.date ?? null,
        status: file.status,
        linked_pr: file.linkedPr?.number ?? null,
        commit_depth: file.commitDepth,
      },
      flags: redaction.flags,
    })
  }

  const byLength = fixtures
    .map((fixture) => ({ slug: fixture.slug, bytes: Buffer.byteLength(fixture.taskMd, 'utf-8') }))
    .sort((a, b) => b.bytes - a.bytes)
  const byDepth = fixtures
    .map((fixture) => ({ slug: fixture.slug, commits: fixture.metadata.commit_depth }))
    .sort((a, b) => b.commits - a.commits)

  const suspectedLeaks: Array<{ slug: string; flags: RedactionFlag[] }> = []

  for (const fixture of fixtures) {
    const targetRoot = fixture.source === 'github' ? ghOut : localOut
    writeFixture(targetRoot, fixture, options.dryRun)
    const leaks = leakScan(fixture.redactedMd)
    if (leaks.length > 0) suspectedLeaks.push({ slug: fixture.slug, flags: leaks })
  }

  const summary = renderSummary({
    reposScanned: github.reposScanned,
    reposSkippedFork: github.reposSkippedFork,
    filesMatched: github.files.length,
    fixturesWritten: fixtures.filter((fixture) => fixture.source === 'github').length,
    duplicatesMerged: mergedCount,
    localFilesScanned: locals.length,
    localFixturesWritten: fixtures.filter((fixture) => fixture.source === 'local').length,
    topByLength: byLength,
    topByDepth: byDepth,
    suspectedLeaks,
  })

  if (!options.dryRun) {
    writeFileSync(join(ghOut, 'SUMMARY.md'), summary)
    writeReadmeIfMissing()
  } else {
    process.stdout.write(summary)
  }

  if (suspectedLeaks.length > 0) {
    throw new Error(`redaction self-check failed: ${suspectedLeaks.length} fixture(s) still flagged`)
  }
}

if (import.meta.main) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`${message}\n`)
    process.exit(1)
  })
}
