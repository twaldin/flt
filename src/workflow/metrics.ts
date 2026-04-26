import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { listEvents } from '../activity'
import type { WorkflowRun } from './types'

type ScoreKey = 'tests' | 'e2e' | 'lint' | 'typecheck' | 'reviewer'
type ScoreVerdict = 'pass' | 'fail'

export interface RunMetrics {
  outcome: 'completed' | 'failed' | 'cancelled'
  scores: Partial<Record<ScoreKey, ScoreVerdict>>
  cost: { usd: number; tokensIn: number; tokensOut: number }
  time: { wallSeconds: number }
  patch: { filesChanged: number; linesAdded: number; linesDeleted: number }
  blockers: string[]
}

const SCORE_KEYS = new Set<ScoreKey>(['tests', 'e2e', 'lint', 'typecheck', 'reviewer'])

export function buildMetrics(run: WorkflowRun, cwd: string): RunMetrics {
  const outcome: RunMetrics['outcome'] = run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled'
    ? run.status
    : 'failed'

  return {
    outcome,
    scores: scanScoresFromResults(run.runDir),
    cost: sumCostFromActivityLog(run),
    time: { wallSeconds: wallSeconds(run.startedAt, run.completedAt) },
    patch: parseShortstat(safeGitDiff(run.startBranch, cwd)),
    blockers: scanBlockersFromResults(run.runDir),
  }
}

export function writeMetricsForRun(run: WorkflowRun, cwd: string): void {
  if (!run.runDir || !existsSync(run.runDir)) return

  let metrics: RunMetrics
  try {
    metrics = buildMetrics(run, cwd)
  } catch {
    metrics = {
      outcome: run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled' ? run.status : 'failed',
      scores: {},
      cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
      time: { wallSeconds: wallSeconds(run.startedAt, run.completedAt) },
      patch: { filesChanged: 0, linesAdded: 0, linesDeleted: 0 },
      blockers: [],
    }
  }

  const path = join(run.runDir, 'metrics.json')
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(metrics, null, 2) + '\n')
  renameSync(tmp, path)
}

function scanScoresFromResults(runDir?: string): Partial<Record<ScoreKey, ScoreVerdict>> {
  const scores: Partial<Record<ScoreKey, ScoreVerdict>> = {}
  if (!runDir) return scores

  const resultsDir = join(runDir, 'results')
  if (!existsSync(resultsDir)) return scores

  for (const file of readdirSync(resultsDir)) {
    const match = file.match(/^(tests|e2e|lint|typecheck|reviewer)-[^/]+\.json$/)
    if (!match) continue
    const key = match[1] as ScoreKey
    if (!SCORE_KEYS.has(key)) continue

    let verdict: unknown
    try {
      const parsed = JSON.parse(readFileSync(join(resultsDir, file), 'utf-8')) as { verdict?: unknown }
      verdict = parsed.verdict
    } catch {
      continue
    }

    if (verdict !== 'pass' && verdict !== 'fail') continue
    if (verdict === 'fail') {
      scores[key] = 'fail'
      continue
    }
    if (!scores[key]) {
      scores[key] = 'pass'
    }
  }

  return scores
}

function scanBlockersFromResults(runDir?: string): string[] {
  if (!runDir) return []

  const resultsDir = join(runDir, 'results')
  if (!existsSync(resultsDir)) return []

  const blockers: string[] = []
  const files = readdirSync(resultsDir).filter(f => f.endsWith('.json')).sort((a, b) => a.localeCompare(b))
  for (const file of files) {
    try {
      const parsed = JSON.parse(readFileSync(join(resultsDir, file), 'utf-8')) as {
        verdict?: unknown
        failReason?: unknown
      }
      if (parsed.verdict !== 'fail') continue
      if (typeof parsed.failReason === 'string' && parsed.failReason.trim().length > 0) {
        blockers.push(parsed.failReason)
      }
    } catch {}
  }

  return blockers
}

function sumCostFromActivityLog(run: WorkflowRun): { usd: number; tokensIn: number; tokensOut: number } {
  const startedAtMs = Date.parse(run.startedAt)
  const completedAtMs = Date.parse(run.completedAt ?? '')
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(completedAtMs)) {
    return { usd: 0, tokensIn: 0, tokensOut: 0 }
  }

  const events = listEvents({ since: run.startedAt, limit: 100_000, type: 'kill' })

  let usd = 0
  let tokensIn = 0
  let tokensOut = 0

  for (const event of events) {
    if (event.type !== 'kill') continue
    if (!event.agent) continue
    if (!(event.agent === run.id || event.agent.startsWith(`${run.id}-`))) continue

    const atMs = Date.parse(event.at)
    if (!Number.isFinite(atMs) || atMs < startedAtMs || atMs > completedAtMs) continue

    usd += event.cost_usd ?? 0
    tokensIn += event.tokens_in ?? 0
    tokensOut += event.tokens_out ?? 0
  }

  return { usd, tokensIn, tokensOut }
}

function wallSeconds(startedAt: string, completedAt?: string): number {
  const startedMs = Date.parse(startedAt)
  const completedMs = Date.parse(completedAt ?? '')
  if (!Number.isFinite(startedMs) || !Number.isFinite(completedMs)) return 0
  return Math.round((completedMs - startedMs) / 1000)
}

function safeGitDiff(startBranch: string | undefined, cwd: string): string {
  if (!startBranch) return ''
  try {
    return execFileSync('git', ['diff', '--shortstat', startBranch], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim()
  } catch {
    return ''
  }
}

function parseShortstat(line: string): { filesChanged: number; linesAdded: number; linesDeleted: number } {
  const files = line.match(/(\d+) files? changed/)
  const insertions = line.match(/(\d+) insertions?\(\+\)/)
  const deletions = line.match(/(\d+) deletions?\(-\)/)

  return {
    filesChanged: files ? parseInt(files[1], 10) : 0,
    linesAdded: insertions ? parseInt(insertions[1], 10) : 0,
    linesDeleted: deletions ? parseInt(deletions[1], 10) : 0,
  }
}
