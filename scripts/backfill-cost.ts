#!/usr/bin/env bun
/**
 * Backfill cost_usd / tokens_in / tokens_out / actualModel on archive files
 * in ~/.flt/runs/<name>-<ts>.json that were written before flt routed
 * non-claude-code adapters through harness-ts's parseSessionLog.
 *
 * Reads each archive, finds the matching harness adapter's session log via
 * adapter.sessionLogPath(workdir), parses it, and writes back the missing
 * telemetry. Skips archives that already have cost data.
 *
 * Usage: bun run scripts/backfill-cost.ts [--dry-run]
 */
import { readFileSync, writeFileSync, readdirSync, statSync, realpathSync } from 'fs'
import { dirname, join } from 'path'
import { homedir } from 'os'
import { getAdapter as getHarnessAdapter } from '@twaldin/harness-ts'

const DRY_RUN = process.argv.includes('--dry-run')

interface Archive {
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

function home(): string { return process.env.HOME ?? homedir() }

function listArchives(): string[] {
  const dir = join(home(), '.flt', 'runs')
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    out.push(join(dir, entry.name))
  }
  return out
}

let scanned = 0, alreadyHasCost = 0, noAdapter = 0, noSessionLog = 0
let updated = 0, parseFailed = 0
const updates: Array<{ path: string; before: Partial<Archive>; after: Partial<Archive> }> = []

for (const path of listArchives()) {
  scanned += 1
  let archive: Archive
  try {
    archive = JSON.parse(readFileSync(path, 'utf-8')) as Archive
  } catch { continue }

  if (archive.cost_usd != null && archive.tokens_in != null) {
    alreadyHasCost += 1
    continue
  }

  const adapter = getHarnessAdapter(archive.cli) as unknown as {
    sessionLogPath?: (workdir: string) => string | null
    parseSessionLog?: (p: string) => { tokensIn: number | null; tokensOut: number | null; costUsd: number | null; model: string | null }
  } | null
  if (!adapter?.sessionLogPath || !adapter?.parseSessionLog) {
    noAdapter += 1
    continue
  }

  // adapter.sessionLogPath returns the MOST RECENT log; for backfill we want
  // the log that overlaps THIS archive's [spawnedAt, killedAt] window. Scan
  // the parent dir and pick the best match.
  const recentLog = adapter.sessionLogPath(archive.dir)
  let logPath: string | null = null
  const start = Date.parse(archive.spawnedAt)
  const end = Date.parse(archive.killedAt)
  if (recentLog) {
    try {
      const dir = dirname(recentLog)
      const candidates = readdirSync(dir)
        .filter(n => n.endsWith('.jsonl') || n.endsWith('.json') || n.endsWith('.traj.json'))
        .map(n => ({ path: join(dir, n), mt: statSync(join(dir, n)).mtimeMs }))
      // log mtime within [spawnedAt - 1s, killedAt + 60s]
      const matches = candidates.filter(c =>
        Number.isFinite(start) && Number.isFinite(end)
          ? (c.mt >= start - 1000 && c.mt <= end + 60_000)
          : false
      )
      if (matches.length > 0) {
        // Pick the latest within the window — overlaps the kill best.
        matches.sort((a, b) => b.mt - a.mt)
        logPath = matches[0].path
      }
    } catch {}
  }
  if (!logPath) {
    noSessionLog += 1
    continue
  }

  let parsed
  try {
    parsed = adapter.parseSessionLog(logPath)
  } catch {
    parseFailed += 1
    continue
  }

  if (parsed.costUsd == null && parsed.tokensIn == null) {
    parseFailed += 1
    continue
  }

  const before = {
    cost_usd: archive.cost_usd,
    tokens_in: archive.tokens_in,
    tokens_out: archive.tokens_out,
    actualModel: archive.actualModel,
  }
  archive.cost_usd = parsed.costUsd ?? archive.cost_usd
  archive.tokens_in = parsed.tokensIn ?? archive.tokens_in
  archive.tokens_out = parsed.tokensOut ?? archive.tokens_out
  archive.actualModel = parsed.model ?? archive.actualModel

  if (!DRY_RUN) {
    writeFileSync(path, JSON.stringify(archive, null, 2) + '\n', 'utf-8')
  }
  updated += 1
  updates.push({
    path,
    before,
    after: { cost_usd: archive.cost_usd, tokens_in: archive.tokens_in, tokens_out: archive.tokens_out, actualModel: archive.actualModel },
  })
}

console.log(`Scanned: ${scanned}`)
console.log(`Already had cost: ${alreadyHasCost}`)
console.log(`No adapter / parser: ${noAdapter}`)
console.log(`No matching session log: ${noSessionLog}`)
console.log(`Parse returned no telemetry: ${parseFailed}`)
console.log(`Updated: ${updated} ${DRY_RUN ? '(DRY RUN — nothing written)' : ''}`)

if (updates.length) {
  console.log('\nFirst 10 updates:')
  for (const u of updates.slice(0, 10)) {
    const name = u.path.split('/').pop()
    console.log(`  ${name}`)
    console.log(`    before: cost=${u.before.cost_usd} in=${u.before.tokens_in} out=${u.before.tokens_out} model=${u.before.actualModel}`)
    console.log(`    after:  cost=${u.after.cost_usd} in=${u.after.tokens_in} out=${u.after.tokens_out} model=${u.after.actualModel}`)
  }
}
