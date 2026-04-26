import { execSync } from 'child_process'
import { existsSync, readdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { readManifest } from './manifest'

export interface GcOpts {
  now?: Date
}

export type Tier = 'hot' | 'warm' | 'cold'

const DAY_MS = 24 * 60 * 60 * 1000
const HOT_DAYS = 7
const WARM_DAYS = 45
const PERMANENT_FILES = new Set(['manifest.json', 'run_summary.md', 'final.diff', 'blocker_report.json'])

export function classifyTier(startedAt: string, now: Date = new Date()): Tier {
  const ageDays = (now.getTime() - new Date(startedAt).getTime()) / DAY_MS
  if (ageDays < HOT_DAYS) return 'hot'
  if (ageDays < WARM_DAYS) return 'warm'
  return 'cold'
}

export function gcRun(runDir: string, opts?: GcOpts): { tier: Tier, actions: string[] } {
  const runJsonPath = join(runDir, 'run.json')
  if (!existsSync(runJsonPath)) throw new Error(`Missing run.json in ${runDir}`)
  const run = JSON.parse(readFileSync(runJsonPath, 'utf-8')) as { id?: string; startedAt?: string }
  if (typeof run.startedAt !== 'string') throw new Error(`Invalid run.json in ${runDir}: missing startedAt`)

  const tier = classifyTier(run.startedAt, opts?.now)
  const actions: string[] = []

  if (tier === 'hot') return { tier, actions }

  const manifest = readManifest(runDir)

  if (tier === 'warm') {
    const archiveTargets: string[] = []

    if (existsSync(join(runDir, 'logs'))) archiveTargets.push('logs')
    for (const artifact of manifest.artifacts) {
      if (artifact.type !== 'diff') continue
      if (!existsSync(join(runDir, artifact.path))) continue
      archiveTargets.push(artifact.path)
    }

    if (archiveTargets.length > 0) {
      const archivePath = join(runDir, 'run-archive.tar.gz')
      tarCreate(runDir, archivePath, unique(archiveTargets))
      actions.push(`tarballed ${unique(archiveTargets).join(', ')}`)
    }

    const logsDir = join(runDir, 'logs')
    if (existsSync(logsDir)) {
      rmSync(logsDir, { recursive: true, force: true })
      actions.push('deleted logs/')
    }

    for (const artifact of manifest.artifacts) {
      if (artifact.type !== 'scratch') continue
      if (artifact.status === 'durable') continue
      if (artifact.keep) continue
      const abs = join(runDir, artifact.path)
      if (!existsSync(abs)) continue
      rmSync(abs, { recursive: true, force: true })
      actions.push(`deleted ${artifact.path}`)
    }

    return { tier, actions }
  }

  const runId = run.id ?? runDir.split('/').at(-1) ?? 'run'
  const archivePath = join(runDir, '..', `${runId}-archive.tar.gz`)
  tarCreate(runDir, archivePath, ['.'])
  actions.push(`tarballed runDir to ${archivePath}`)

  const keepPaths = new Set<string>()
  for (const file of PERMANENT_FILES) {
    if (existsSync(join(runDir, file))) keepPaths.add(file)
  }
  for (const artifact of manifest.artifacts) {
    if (!artifact.keep) continue
    if (existsSync(join(runDir, artifact.path))) keepPaths.add(normalizeRel(artifact.path))
  }

  pruneToKeepSet(runDir, keepPaths, actions)

  return { tier, actions }
}

export function gcAllRuns(opts?: GcOpts & { olderThan?: string }): Array<{ runId: string, tier: Tier, actions: string[] }> {
  const runsDir = join(process.env.HOME ?? require('os').homedir(), '.flt', 'runs')
  if (!existsSync(runsDir)) return []

  const minAgeDays = parseOlderThanDays(opts?.olderThan)
  const now = opts?.now ?? new Date()
  const results: Array<{ runId: string, tier: Tier, actions: string[] }> = []

  for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const runDir = join(runsDir, entry.name)
    const runJsonPath = join(runDir, 'run.json')
    if (!existsSync(runJsonPath)) continue
    const run = JSON.parse(readFileSync(runJsonPath, 'utf-8')) as { startedAt?: string }
    if (typeof run.startedAt !== 'string') continue

    if (minAgeDays !== null) {
      const ageDays = (now.getTime() - new Date(run.startedAt).getTime()) / DAY_MS
      if (ageDays < minAgeDays) continue
    }

    const result = gcRun(runDir, opts)
    results.push({ runId: entry.name, tier: result.tier, actions: result.actions })
  }

  return results
}

function parseOlderThanDays(input?: string): number | null {
  if (!input) return null
  const match = input.match(/^(\d+)d$/)
  if (!match) throw new Error(`Invalid olderThan value: ${input}`)
  return parseInt(match[1]!, 10)
}

function tarCreate(baseDir: string, outputPath: string, paths: string[]): void {
  const args = paths.map(shQuote).join(' ')
  execSync(`tar -czf ${shQuote(outputPath)} -C ${shQuote(baseDir)} ${args}`, { stdio: 'ignore' })
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function normalizeRel(relPath: string): string {
  return relPath.replace(/^\.\//, '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '')
}

function pruneToKeepSet(runDir: string, keepPaths: Set<string>, actions: string[]): void {
  pruneDir(runDir, '', keepPaths, actions)
}

function pruneDir(runDir: string, relDir: string, keepPaths: Set<string>, actions: string[]): void {
  const absDir = relDir ? join(runDir, relDir) : runDir
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name
    const absPath = join(runDir, relPath)

    if (entry.isDirectory()) {
      if (isKeptOrAncestor(relPath, keepPaths)) {
        pruneDir(runDir, relPath, keepPaths, actions)
        if (!isKeptOrAncestor(relPath, keepPaths) && readdirSync(absPath).length === 0) {
          rmSync(absPath, { recursive: true, force: true })
          actions.push(`deleted ${relPath}/`)
        }
      } else {
        rmSync(absPath, { recursive: true, force: true })
        actions.push(`deleted ${relPath}/`)
      }
      continue
    }

    if (keepPaths.has(relPath)) continue
    rmSync(absPath, { force: true })
    actions.push(`deleted ${relPath}`)
  }
}

function isKeptOrAncestor(relPath: string, keepPaths: Set<string>): boolean {
  if (keepPaths.has(relPath)) return true
  for (const keepPath of keepPaths) {
    if (keepPath.startsWith(`${relPath}/`)) return true
  }
  return false
}
