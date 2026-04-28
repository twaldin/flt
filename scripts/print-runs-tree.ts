#!/usr/bin/env bun
/**
 * Stdout debug rig for the metrics-modal runs tree.
 *
 * Loads the exact same data the modal does (archives + runs + parents), runs
 * `buildRunsTree` and `flattenRunsTree`, then prints what the modal would
 * render in plain text. Useful for diffing tree output against expected
 * shape without launching the TUI.
 *
 * Usage:
 *   bun run scripts/print-runs-tree.ts
 *   bun run scripts/print-runs-tree.ts --no-smoke    # filter _smoke* workflows
 *   bun run scripts/print-runs-tree.ts --orchestrator <name>
 */
import { existsSync, readdirSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { buildRunsTree } from '../src/tui/metrics-modal'
import type { ArchiveEntry } from '../src/metrics'
import { getOrchestrator } from '../src/state'

interface RunJson {
  id?: string
  workflow?: string
  parentName?: string
  history?: Array<{ agent?: string; step?: string }>
}

const args = process.argv.slice(2)
const noSmoke = args.includes('--no-smoke')
const orchIdx = args.indexOf('--orchestrator')
const orchOverride = orchIdx >= 0 ? args[orchIdx + 1] : null

function readJson<T>(path: string): T | null {
  try { return JSON.parse(readFileSync(path, 'utf-8')) as T } catch { return null }
}

const runsDir = join(process.env.HOME || homedir(), '.flt', 'runs')
const archives: ArchiveEntry[] = []
const runs: RunJson[] = []

if (existsSync(runsDir)) {
  for (const name of readdirSync(runsDir)) {
    const path = join(runsDir, name)
    if (name.endsWith('.json')) {
      const a = readJson<ArchiveEntry>(path)
      if (a) archives.push(a)
      continue
    }
    const runJsonPath = join(path, 'run.json')
    if (!existsSync(runJsonPath)) continue
    const r = readJson<RunJson>(runJsonPath)
    if (r) runs.push(r)
  }
}

const stateJson = readJson<{ agents?: Record<string, { parentName?: string }> }>(
  join(process.env.HOME || homedir(), '.flt', 'state.json'),
) ?? { agents: {} }
const parents: Record<string, string> = {}
for (const [name, agent] of Object.entries(stateJson.agents ?? {})) {
  if (agent?.parentName) parents[name] = agent.parentName
}

let filteredRuns = runs
let filteredArchives = archives
if (noSmoke) {
  const smokeRunIds = new Set(runs.filter(r => (r.workflow ?? '').startsWith('_')).map(r => r.id ?? ''))
  filteredRuns = runs.filter(r => !(r.workflow ?? '').startsWith('_'))
  filteredArchives = archives.filter(a => {
    const runId = String((a as unknown as { runId?: string }).runId ?? '')
    if (smokeRunIds.has(runId)) return false
    if (a.name.startsWith('_smoke') || a.name.includes('-smoke-')) return false
    return true
  })
}

const orch = getOrchestrator()
const orchName = orchOverride ?? (
  parents['orchestrator'] !== undefined || (stateJson.agents ?? {})['orchestrator']
    ? 'orchestrator'
    : (orch ? (orch.type === 'human' ? 'human' : 'orchestrator') : 'human')
)

console.log(`runsDir: ${runsDir}`)
console.log(`archives: ${archives.length} (${filteredArchives.length} after filter)`)
console.log(`runs: ${runs.length} (${filteredRuns.length} after filter)`)
console.log(`parents: ${Object.keys(parents).length}`)
console.log(`orchestrator: ${orchName}`)
console.log()

const rows = buildRunsTree(filteredArchives, filteredRuns, parents, orchName)

console.log('--- runs tree (flat) ---')
for (const row of rows) {
  const cont = row.continuation ?? ''
  const conn = row.connector ?? ''
  const label = row.label
  console.log(`${cont}${conn}${label}`)
}
console.log()
console.log(`total rows: ${rows.length}`)
