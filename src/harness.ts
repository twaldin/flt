/**
 * Post-exit cost/token extraction for flt agents.
 *
 * Parallel to harness (the Python library) but runs in-process in TS
 * because harness doesn't yet ship an `extract` subcommand — its
 * cost-parsing logic is inlined in each adapter's `run()`. Tracked as
 * a followup to port this into `harness extract`.
 *
 * Only `claude-code` is supported in this first pass.
 */
import { readFileSync, readdirSync, existsSync, statSync, mkdirSync, writeFileSync, realpathSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { getAdapter as getHarnessAdapter } from '@twaldin/harness-ts'

function home(): string {
  return process.env.HOME ?? homedir()
}

export interface HarnessExtractResult {
  cost_usd: number | null
  tokens_in: number | null
  tokens_out: number | null
  model: string | null
}

// USD per 1M tokens: [input, output, cache_creation, cache_read].
// Public claude API pricing as of 2026-04. Unknown model → cost=null.
const CLAUDE_PRICING: Record<string, [number, number, number, number]> = {
  'claude-opus-4-7':   [15,   75, 18.75, 1.5],
  'claude-opus-4-6':   [15,   75, 18.75, 1.5],
  'claude-opus-4-5':   [15,   75, 18.75, 1.5],
  'claude-sonnet-4-7': [3,    15, 3.75,  0.30],
  'claude-sonnet-4-6': [3,    15, 3.75,  0.30],
  'claude-sonnet-4-5': [3,    15, 3.75,  0.30],
  'claude-haiku-4-5':  [0.80,  4, 1.00,  0.08],
}

function claudeProjectSlug(workdir: string): string {
  // claude-code projects dir names use the REALPATH of workdir
  // (symlink-resolved, e.g. /var → /private/var on macOS), with
  // /, _, . all replaced by -.
  let resolved = workdir
  try {
    resolved = realpathSync(workdir)
  } catch {
    // Fall back to the raw path if realpath fails (e.g. worktree already gone)
  }
  return resolved.replace(/[\/_.]/g, '-')
}

function priceKeyFromModelId(modelId: string): string | null {
  for (const key of Object.keys(CLAUDE_PRICING)) {
    if (modelId.startsWith(key)) return key
  }
  return null
}

function findSessionFile(projectDir: string, spawnedAtMs: number): string | null {
  let names: string[]
  try {
    names = readdirSync(projectDir).filter(f => f.endsWith('.jsonl'))
  } catch {
    return null
  }
  if (names.length === 0) return null

  // Pick the newest .jsonl whose mtime is >= (spawnedAt - 5s tolerance)
  let target: string | null = null
  let targetMtime = 0
  for (const n of names) {
    const p = join(projectDir, n)
    try {
      const mt = statSync(p).mtimeMs
      if (mt >= spawnedAtMs - 5000 && mt > targetMtime) {
        target = p
        targetMtime = mt
      }
    } catch {}
  }
  return target
}

function extractClaudeCode(workdir: string, spawnedAt: string): HarnessExtractResult | null {
  const slug = claudeProjectSlug(workdir)
  const projectDir = join(home(), '.claude', 'projects', slug)
  if (!existsSync(projectDir)) return null

  const sinceMs = new Date(spawnedAt).getTime()
  const file = findSessionFile(projectDir, sinceMs)
  if (!file) return null

  let content: string
  try {
    content = readFileSync(file, 'utf-8')
  } catch {
    return null
  }

  const lines = content.split('\n').filter(l => l.length > 0)

  let tokensIn = 0
  let tokensOut = 0
  let cacheCreate = 0
  let cacheRead = 0
  let model: string | null = null
  let sawAssistantUsage = false

  for (let i = 0; i < lines.length; i++) {
    let entry: any
    try {
      entry = JSON.parse(lines[i])
    } catch {
      // Tolerate truncated last line (SIGHUP may cut claude mid-flush)
      // or any single malformed line — keep parsing what we have.
      continue
    }
    if (entry?.type !== 'assistant') continue
    const usage = entry?.message?.usage
    if (!usage) continue
    sawAssistantUsage = true
    tokensIn     += usage.input_tokens                ?? 0
    tokensOut    += usage.output_tokens               ?? 0
    cacheCreate  += usage.cache_creation_input_tokens ?? 0
    cacheRead    += usage.cache_read_input_tokens     ?? 0
    if (typeof entry.message.model === 'string') {
      model = entry.message.model
    }
  }

  if (!sawAssistantUsage) return null

  let cost: number | null = null
  const key = model ? priceKeyFromModelId(model) : null
  if (key) {
    const [pIn, pOut, pCC, pCR] = CLAUDE_PRICING[key]
    cost =
      (tokensIn * pIn + tokensOut * pOut + cacheCreate * pCC + cacheRead * pCR) /
      1_000_000
  }

  return {
    cost_usd: cost,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    model,
  }
}

export interface ExtractOpts {
  cli: string
  workdir: string
  spawnedAt: string
}

export function harnessExtract(opts: ExtractOpts): HarnessExtractResult | null {
  // claude-code: keep flt's inline extractor (uses local CLAUDE_PRICING + spawn-time
  // gating). All other CLIs: delegate to harness-ts's per-adapter parseSessionLog
  // (covers pi/codex/gemini/opencode/swe-agent/openclaude/qwen/continue-cli/crush/
  // factory-droid/kilo via Track C session-telemetry plumbing).
  if (opts.cli === 'claude-code') {
    return extractClaudeCode(opts.workdir, opts.spawnedAt)
  }
  return extractViaHarness(opts)
}

function extractViaHarness(opts: ExtractOpts): HarnessExtractResult | null {
  try {
    const adapter = getHarnessAdapter(opts.cli) as unknown as {
      sessionLogPath?: (workdir: string) => string | null
      parseSessionLog?: (path: string) => {
        tokensIn: number | null
        tokensOut: number | null
        costUsd: number | null
        model: string | null
      }
    } | null
    if (!adapter?.sessionLogPath || !adapter?.parseSessionLog) return null
    const path = adapter.sessionLogPath(opts.workdir)
    if (!path) return null
    const t = adapter.parseSessionLog(path)
    if (t.tokensIn == null && t.tokensOut == null && t.costUsd == null) return null
    return {
      cost_usd: t.costUsd,
      tokens_in: t.tokensIn,
      tokens_out: t.tokensOut,
      model: t.model,
    }
  } catch {
    return null
  }
}

export interface ArchiveOpts {
  name: string
  cli: string
  model: string
  dir: string
  spawnedAt: string
}

export function archiveRun(opts: ArchiveOpts, result: HarnessExtractResult | null): string | null {
  try {
    const runsDir = join(home(), '.flt', 'runs')
    mkdirSync(runsDir, { recursive: true })
    const stamp = opts.spawnedAt.replace(/[:.]/g, '-')
    const path = join(runsDir, `${opts.name}-${stamp}.json`)
    const payload = {
      name: opts.name,
      cli: opts.cli,
      model: opts.model,
      dir: opts.dir,
      spawnedAt: opts.spawnedAt,
      killedAt: new Date().toISOString(),
      cost_usd: result?.cost_usd ?? null,
      tokens_in: result?.tokens_in ?? null,
      tokens_out: result?.tokens_out ?? null,
      actualModel: result?.model ?? null,
    }
    writeFileSync(path, JSON.stringify(payload, null, 2) + '\n', 'utf-8')
    return path
  } catch {
    return null
  }
}
