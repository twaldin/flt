import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'fs'
import { basename, dirname, extname, isAbsolute, join } from 'path'
import { parse } from 'yaml'

export interface PromoteArgs {
  candidate: string
  evidenceRunIds: string[]
}

interface ScoreDelta {
  before: number | null
  after: number
}

export interface PromoteResult {
  stablePath: string
  archivePath: string | null
  changelogPath: string
  metricsPath: string
  scoreDeltas: Record<string, ScoreDelta>
  firstPromotion: boolean
}

interface CandidateFrontmatter {
  stablePath: string
  mutationType: string
  body: string
}

interface SidecarMetrics {
  promotedAt?: string
  runIds?: string[]
  scores?: Record<string, unknown>
}

function homeDir(): string {
  return process.env.HOME ?? require('os').homedir()
}

function parseCandidateFrontmatter(raw: string): CandidateFrontmatter {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!match) {
    throw new Error('front-matter missing or malformed: stable_path required')
  }

  const front = parse(match[1]) as Record<string, unknown> | null
  const stablePath = typeof front?.stable_path === 'string' ? front.stable_path.trim() : ''
  if (!stablePath) {
    throw new Error('front-matter missing or malformed: stable_path required')
  }

  return {
    stablePath,
    mutationType: typeof front?.mutation_type === 'string' ? front.mutation_type : 'prompt_edit',
    body: match[2] ?? '',
  }
}

function readMetricsScores(path: string, notFoundMessage: string): Record<string, number> {
  if (!existsSync(path)) {
    throw new Error(notFoundMessage)
  }

  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { scores?: Record<string, unknown> }
  const scores: Record<string, number> = {}
  for (const [key, value] of Object.entries(parsed.scores ?? {})) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      scores[key] = value
    }
  }
  return scores
}

function computeBestScores(allScores: Record<string, number>[]): Record<string, number> {
  const best: Record<string, number> = {}
  for (const scores of allScores) {
    for (const [key, value] of Object.entries(scores)) {
      if (best[key] === undefined || value > best[key]) {
        best[key] = value
      }
    }
  }
  return best
}

function atomicWrite(path: string, content: string): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, content)
  renameSync(tmp, path)
}

export function promote(args: PromoteArgs): PromoteResult {
  const evidenceRunIds = args.evidenceRunIds.map(id => id.trim()).filter(Boolean)
  if (evidenceRunIds.length === 0) {
    throw new Error('--evidence requires at least one run id')
  }

  const candidateRaw = readFileSync(args.candidate, 'utf-8')
  const parsedCandidate = parseCandidateFrontmatter(candidateRaw)
  if (!isAbsolute(parsedCandidate.stablePath)) {
    throw new Error('stable_path must be absolute')
  }

  const evidenceScores = evidenceRunIds.map(runId => {
    const metricsPath = join(homeDir(), '.flt', 'runs', runId, 'metrics.json')
    return readMetricsScores(metricsPath, `evidence run "${runId}": metrics.json not found`)
  })

  const bestScores = computeBestScores(evidenceScores)
  const metricsPath = `${parsedCandidate.stablePath}.metrics.json`
  const changelogPath = `${parsedCandidate.stablePath}.changelog.md`

  let previousScores: Record<string, number> = {}
  let firstPromotion = false
  if (existsSync(metricsPath)) {
    previousScores = readMetricsScores(metricsPath, `${metricsPath} not found`)
  } else {
    firstPromotion = true
    console.warn(`first promotion of ${basename(parsedCandidate.stablePath)} — evidence improvement check skipped`)
  }

  if (!firstPromotion) {
    let improved = false
    for (const [field, after] of Object.entries(bestScores)) {
      const before = previousScores[field]
      if (before !== undefined && after > before) {
        improved = true
        break
      }
    }
    if (!improved) {
      throw new Error(`no score improvement vs ${metricsPath} — refusing to promote`)
    }
  }

  const stableDir = dirname(parsedCandidate.stablePath)
  const stableStem = basename(parsedCandidate.stablePath, extname(parsedCandidate.stablePath))
  const archiveDir = join(stableDir, 'archive')
  mkdirSync(archiveDir, { recursive: true })

  let archivePath: string | null = null
  if (existsSync(parsedCandidate.stablePath)) {
    const archiveCount = readdirSync(archiveDir)
      .filter(name => name.startsWith(`${stableStem}.v`) && name.endsWith('.md'))
      .length
    archivePath = join(archiveDir, `${stableStem}.v${archiveCount + 1}.md`)
    copyFileSync(parsedCandidate.stablePath, archivePath)
  }

  atomicWrite(parsedCandidate.stablePath, parsedCandidate.body)

  const now = new Date().toISOString()
  const scoreDeltas: Record<string, ScoreDelta> = {}
  for (const [field, after] of Object.entries(bestScores)) {
    scoreDeltas[field] = {
      before: previousScores[field] ?? null,
      after,
    }
  }

  const deltaLine = Object.entries(scoreDeltas)
    .map(([field, delta]) => `${field}: ${delta.before === null ? 'n/a' : delta.before} → ${delta.after}`)
    .join(', ')

  const changelogEntry = [
    `## ${now.slice(0, 10)} — run-ids: ${evidenceRunIds.join(',')}`,
    `mutation_type: ${parsedCandidate.mutationType}`,
    `Score deltas: ${deltaLine || 'none'}`,
    '',
  ].join('\n')
  appendFileSync(changelogPath, changelogEntry)

  const sidecar = {
    promotedAt: now,
    runIds: evidenceRunIds,
    scores: bestScores,
  }
  atomicWrite(metricsPath, JSON.stringify(sidecar, null, 2) + '\n')

  return {
    stablePath: parsedCandidate.stablePath,
    archivePath,
    changelogPath,
    metricsPath,
    scoreDeltas,
    firstPromotion,
  }
}
