import { canonicalModelName } from './model-resolution'

export type Period = 'today' | 'week' | 'month' | 'all'
export type GroupBy = 'model' | 'workflow' | 'agent'

export interface ArchiveEntry {
  name: string
  cli: string
  model: string
  dir: string
  spawnedAt: string
  killedAt: string
  cost_usd: number | null
  tokens_in: number | null
  tokens_out: number | null
  actualModel: string | null
}

export interface AggRow {
  label: string
  cost: number
  tokensIn: number
  tokensOut: number
  runs: number
  avgCost: number
}

export interface AggResult {
  rows: AggRow[]
  total: AggRow
  /** Cost-per-bucket array, length depends on period (24/28/30/60). */
  sparkline24h: number[]
  /** Human label for one bucket: '1h' / '6h' / '1d'. */
  sparklineUnit: string
}

export interface AggregateOpts {
  period: Period
  groupBy: GroupBy
  now?: number
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const MONTH_MS = 30 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

const STEP_RE = /-(spec|architect|coder|reviewer|verifier|gate|evaluator|tester|oracle|mutator|candidate|merge|done)(?:-[\w]+)?$/

function toNumber(value: number | null): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function parseMs(iso: string): number {
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : Number.NaN
}

function extractWorkflow(name: string): string {
  const match = name.match(STEP_RE)
  if (!match || typeof match.index !== 'number') return '(unknown)'

  let workflow = name.slice(0, match.index)
  workflow = workflow.replace(/-\d+$/, '')
  return workflow || '(unknown)'
}

function sameLocalDay(aMs: number, bMs: number): boolean {
  const a = new Date(aMs)
  const b = new Date(bMs)
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

function inPeriod(ms: number, now: number, period: Period): boolean {
  if (!Number.isFinite(ms)) return false
  if (period === 'all') return true
  if (period === 'today') return sameLocalDay(ms, now)

  const delta = now - ms
  if (delta < 0) return false
  if (period === 'week') return delta <= WEEK_MS
  return delta <= MONTH_MS
}

function aggregateBy(entries: ArchiveEntry[], groupBy: GroupBy): AggRow[] {
  const groups = new Map<string, AggRow>()

  for (const entry of entries) {
    let label: string
    if (groupBy === 'model') {
      const raw = entry.actualModel || entry.model || ''
      // claude-code injects "<synthetic>" when its session has system-only
      // turns (e.g., interrupted/autoresponder). Don't surface that as a
      // distinct model row — fold into '(unknown)'.
      if (!raw || raw === '<synthetic>') {
        label = '(unknown)'
      } else {
        label = canonicalModelName(raw)
      }
    } else if (groupBy === 'workflow') {
      label = extractWorkflow(entry.name)
    } else {
      label = entry.name
    }

    const existing = groups.get(label)
    if (existing) {
      existing.cost += toNumber(entry.cost_usd)
      existing.tokensIn += toNumber(entry.tokens_in)
      existing.tokensOut += toNumber(entry.tokens_out)
      existing.runs += 1
      continue
    }

    groups.set(label, {
      label,
      cost: toNumber(entry.cost_usd),
      tokensIn: toNumber(entry.tokens_in),
      tokensOut: toNumber(entry.tokens_out),
      runs: 1,
      avgCost: 0,
    })
  }

  const rows = Array.from(groups.values())
  for (const row of rows) {
    row.avgCost = row.runs > 0 ? row.cost / row.runs : 0
  }

  rows.sort((a, b) => {
    if (b.cost !== a.cost) return b.cost - a.cost
    return a.label.localeCompare(b.label)
  })

  return rows
}

function buildTotal(entries: ArchiveEntry[]): AggRow {
  const total = entries.reduce((acc, entry) => {
    acc.cost += toNumber(entry.cost_usd)
    acc.tokensIn += toNumber(entry.tokens_in)
    acc.tokensOut += toNumber(entry.tokens_out)
    acc.runs += 1
    return acc
  }, {
    label: 'TOTAL',
    cost: 0,
    tokensIn: 0,
    tokensOut: 0,
    runs: 0,
    avgCost: 0,
  })

  total.avgCost = total.runs > 0 ? total.cost / total.runs : 0
  return total
}

interface SparklineSpec {
  bucketCount: number
  bucketMs: number
  windowMs: number
  unitLabel: string
}

function sparklineSpecForPeriod(period: Period): SparklineSpec {
  if (period === 'week') {
    // 7 days × 4 buckets/day = 28 6-hour buckets
    return { bucketCount: 28, bucketMs: 6 * HOUR_MS, windowMs: 7 * DAY_MS, unitLabel: '6h' }
  }
  if (period === 'month') {
    return { bucketCount: 30, bucketMs: DAY_MS, windowMs: 30 * DAY_MS, unitLabel: '1d' }
  }
  if (period === 'all') {
    // Last 60 days, 1 day per bucket — gives long-tail trend without overflowing.
    return { bucketCount: 60, bucketMs: DAY_MS, windowMs: 60 * DAY_MS, unitLabel: '1d' }
  }
  // today
  return { bucketCount: 24, bucketMs: HOUR_MS, windowMs: DAY_MS, unitLabel: '1h' }
}

function buildSparkline(archives: ArchiveEntry[], now: number, period: Period): { values: number[]; unitLabel: string } {
  const spec = sparklineSpecForPeriod(period)
  const buckets = new Array<number>(spec.bucketCount).fill(0)
  const windowStart = now - spec.windowMs

  for (const entry of archives) {
    const ms = parseMs(entry.spawnedAt)
    if (!Number.isFinite(ms)) continue
    const bucket = Math.floor((ms - windowStart) / spec.bucketMs)
    if (bucket < 0 || bucket >= spec.bucketCount) continue
    buckets[bucket] += toNumber(entry.cost_usd)
  }

  return { values: buckets, unitLabel: spec.unitLabel }
}

export function aggregateRuns(archives: ArchiveEntry[], opts: AggregateOpts): AggResult {
  const now = opts.now ?? Date.now()
  const filtered = archives.filter((entry) => inPeriod(parseMs(entry.spawnedAt), now, opts.period))
  const spark = buildSparkline(archives, now, opts.period)

  return {
    rows: aggregateBy(filtered, opts.groupBy),
    total: buildTotal(filtered),
    sparkline24h: spark.values,
    sparklineUnit: spark.unitLabel,
  }
}
