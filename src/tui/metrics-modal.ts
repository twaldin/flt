import { existsSync, readdirSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { aggregateRuns, type ArchiveEntry, type Period } from '../metrics'
import { ATTR_BOLD, ATTR_DIM, type Screen } from './screen'
import { getTheme } from './theme'
import type { MetricsModalState } from './types'

interface RunJsonHistory {
  agent?: string
}

interface RunJson {
  workflow?: string
  history?: RunJsonHistory[]
}

interface CacheData {
  archives: ArchiveEntry[]
  runs: RunJson[]
  parents: Record<string, string>
  at: number
}

interface TreeNode {
  id: string
  label: string
  cost: number
  tokensIn: number
  tokensOut: number
  runs: number
  isWorkflow: boolean
  children: TreeNode[]
}

const HOURS_24_MS = 24 * 60 * 60 * 1000
const BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
const CACHE_TTL_MS = 2000

let cache: CacheData | null = null

function widthOf(text: string): number {
  return Array.from(text).length
}

function truncate(text: string, max: number): string {
  if (max <= 0) return ''
  const chars = Array.from(text)
  if (chars.length <= max) return text
  return chars.slice(0, max).join('')
}

function padRight(text: string, width: number): string {
  const clipped = truncate(text, width)
  return `${clipped}${' '.repeat(Math.max(0, width - widthOf(clipped)))}`
}

function putLine(screen: Screen, row: number, col: number, width: number, text: string, fg = '', attrs = 0): void {
  if (row < 0 || row >= screen.rows || width <= 0) return
  screen.put(row, col, padRight(text, width), fg, '', attrs)
}

function num(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function parseMs(iso: string): number {
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : Number.NaN
}

function sameLocalDay(aMs: number, bMs: number): boolean {
  const a = new Date(aMs)
  const b = new Date(bMs)
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function inPeriod(ms: number, period: Period, now: number): boolean {
  if (!Number.isFinite(ms)) return false
  if (period === 'all') return true
  if (period === 'today') return sameLocalDay(ms, now)
  const delta = now - ms
  if (delta < 0) return false
  if (period === 'week') return delta <= 7 * HOURS_24_MS
  return delta <= 30 * HOURS_24_MS
}

function fmtCost(value: number): string {
  return value < 10 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`
}

function fmtTokens(value: number): string {
  if (value < 1000) return `${Math.round(value)}`
  const k = value / 1000
  return k < 10 ? `${k.toFixed(1)}k` : `${Math.round(k)}k`
}

function bar(value: number, max: number, width: number): string {
  if (width <= 0 || max <= 0 || value <= 0) return ' '.repeat(Math.max(0, width))
  const ratio = Math.max(0, Math.min(1, value / max))
  const cells = ratio * width
  const full = Math.floor(cells)
  const rem = cells - full
  let out = BARS[BARS.length - 1].repeat(full)
  if (rem > 0 && out.length < width) {
    const idx = Math.max(0, Math.min(BARS.length - 1, Math.floor(rem * BARS.length)))
    out += BARS[idx]
  }
  return padRight(out, width)
}

function sparkline(values: number[]): string {
  const max = Math.max(0, ...values)
  if (max <= 0) return BARS[0].repeat(values.length)
  return values.map(v => {
    const idx = Math.min(BARS.length - 1, Math.max(0, Math.ceil((v / max) * (BARS.length - 1))))
    return BARS[idx]
  }).join('')
}

function readArchiveFile(path: string): ArchiveEntry | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ArchiveEntry>
    if (typeof parsed.name !== 'string' || typeof parsed.spawnedAt !== 'string') return null
    return {
      name: parsed.name,
      cli: typeof parsed.cli === 'string' ? parsed.cli : '',
      model: typeof parsed.model === 'string' ? parsed.model : '',
      dir: typeof parsed.dir === 'string' ? parsed.dir : '',
      spawnedAt: parsed.spawnedAt,
      killedAt: typeof parsed.killedAt === 'string' ? parsed.killedAt : '',
      cost_usd: typeof parsed.cost_usd === 'number' ? parsed.cost_usd : null,
      tokens_in: typeof parsed.tokens_in === 'number' ? parsed.tokens_in : null,
      tokens_out: typeof parsed.tokens_out === 'number' ? parsed.tokens_out : null,
      actualModel: typeof parsed.actualModel === 'string' ? parsed.actualModel : null,
    }
  } catch {
    return null
  }
}

function readRunJson(path: string): RunJson | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as RunJson
    return parsed
  } catch {
    return null
  }
}

function readParents(path: string): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { agents?: Record<string, { parentName?: string }> }
    const parents: Record<string, string> = {}
    for (const [name, agent] of Object.entries(parsed.agents ?? {})) {
      if (typeof agent.parentName === 'string' && agent.parentName) parents[name] = agent.parentName
    }
    return parents
  } catch {
    return {}
  }
}

function loadAll(force = false): CacheData {
  const now = Date.now()
  if (!force && cache && now - cache.at < CACHE_TTL_MS) return cache

  const runsDir = join(process.env.HOME || homedir(), '.flt', 'runs')
  const archives: ArchiveEntry[] = []
  const runs: RunJson[] = []

  if (existsSync(runsDir)) {
    for (const name of readdirSync(runsDir)) {
      const path = join(runsDir, name)
      if (name.endsWith('.json')) {
        const archive = readArchiveFile(path)
        if (archive) archives.push(archive)
        continue
      }

      const runJsonPath = join(path, 'run.json')
      if (!existsSync(runJsonPath)) continue
      const run = readRunJson(runJsonPath)
      if (run) runs.push(run)
    }
  }

  const parents = readParents(join(process.env.HOME || homedir(), '.flt', 'state.json'))
  cache = { archives, runs, parents, at: now }
  return cache
}

function flattenTree(nodes: TreeNode[]): Array<{ label: string; cost: number; tokensIn: number; tokensOut: number; runs: number }> {
  const lines: Array<{ label: string; cost: number; tokensIn: number; tokensOut: number; runs: number }> = []

  function walk(node: TreeNode, prefix: string, isLast: boolean, isRoot: boolean): void {
    const connector = isRoot ? '' : (isLast ? '└─ ' : '├─ ')
    lines.push({
      label: `${prefix}${connector}${node.label}`,
      cost: node.cost,
      tokensIn: node.tokensIn,
      tokensOut: node.tokensOut,
      runs: node.runs,
    })

    const nextPrefix = isRoot
      ? ''
      : `${prefix}${isLast ? '   ' : '│  '}`

    node.children.forEach((child, idx) => walk(child, nextPrefix, idx === node.children.length - 1, false))
  }

  nodes.forEach((node, idx) => walk(node, '', idx === nodes.length - 1, true))
  return lines
}

function buildAgentTree(archives: ArchiveEntry[], period: Period, runs: RunJson[], parents: Record<string, string>, now: number): Array<{ label: string; cost: number; tokensIn: number; tokensOut: number; runs: number }> {
  const agg = aggregateRuns(archives, { period, groupBy: 'agent', now }).rows
  const byAgent = new Map(agg.map(row => [row.label, row]))
  const agentNodes = new Map<string, TreeNode>()

  for (const row of agg) {
    agentNodes.set(row.label, {
      id: row.label,
      label: row.label,
      cost: row.cost,
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
      runs: row.runs,
      isWorkflow: false,
      children: [],
    })
  }

  const workflowRoots = new Map<string, TreeNode>()
  const parentByAgent = new Map<string, string>()

  for (const run of runs) {
    const workflow = typeof run.workflow === 'string' && run.workflow ? run.workflow : '(unknown)'
    const agents = (run.history ?? [])
      .map(h => h.agent)
      .filter((name): name is string => typeof name === 'string' && agentNodes.has(name))

    if (agents.length === 0) continue

    let root = workflowRoots.get(workflow)
    if (!root) {
      root = {
        id: `wf:${workflow}`,
        label: `${workflow} (workflow)`,
        cost: 0,
        tokensIn: 0,
        tokensOut: 0,
        runs: 0,
        isWorkflow: true,
        children: [],
      }
      workflowRoots.set(workflow, root)
    }

    for (const agentName of agents) {
      if (parentByAgent.has(agentName)) continue
      const node = agentNodes.get(agentName)
      if (!node) continue
      root.children.push(node)
      parentByAgent.set(agentName, root.id)
    }
  }

  for (const [agentName, parentName] of Object.entries(parents)) {
    if (!agentNodes.has(agentName) || !agentNodes.has(parentName)) continue

    let cursor: string | undefined = parentName
    let cycle = false
    while (cursor) {
      if (cursor === agentName) {
        cycle = true
        break
      }
      cursor = parentByAgent.get(cursor)
    }
    if (cycle) continue

    const child = agentNodes.get(agentName)
    const parent = agentNodes.get(parentName)
    if (!child || !parent) continue

    const currentParent = parentByAgent.get(agentName)
    if (currentParent?.startsWith('wf:')) {
      for (const root of workflowRoots.values()) {
        root.children = root.children.filter(c => c.id !== agentName)
      }
    } else if (currentParent) {
      const currentNode = agentNodes.get(currentParent)
      if (currentNode) currentNode.children = currentNode.children.filter(c => c.id !== agentName)
    }

    parent.children.push(child)
    parentByAgent.set(agentName, parentName)
  }

  const roots: TreeNode[] = Array.from(workflowRoots.values())

  for (const [name, node] of agentNodes.entries()) {
    if (!parentByAgent.has(name)) roots.push(node)
  }

  function rollup(node: TreeNode): void {
    node.children.forEach(rollup)
    if (node.isWorkflow) {
      node.cost = 0
      node.tokensIn = 0
      node.tokensOut = 0
      node.runs = 0
    } else {
      const own = byAgent.get(node.id)
      node.cost = own?.cost ?? 0
      node.tokensIn = own?.tokensIn ?? 0
      node.tokensOut = own?.tokensOut ?? 0
      node.runs = own?.runs ?? 0
    }

    for (const child of node.children) {
      node.cost += child.cost
      node.tokensIn += child.tokensIn
      node.tokensOut += child.tokensOut
      node.runs += child.runs
    }
  }

  roots.forEach(rollup)
  roots.sort((a, b) => b.cost - a.cost || a.label.localeCompare(b.label))
  return flattenTree(roots)
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return '--:--'
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function filteredArchives(archives: ArchiveEntry[], period: Period, now: number): ArchiveEntry[] {
  return archives.filter(a => inPeriod(parseMs(a.spawnedAt), period, now))
}

export function invalidateMetricsModalCache(): void {
  cache = null
}

export function renderMetricsModal(screen: Screen, state: MetricsModalState, term: { width: number; height: number }): void {
  const t = getTheme()
  const width = term.width
  const height = term.height

  // Fill the modal area with blank cells so the underlying sidebar/log view
  // can't bleed through. Matches the pattern in modal-workflows.ts.
  for (let r = 0; r < height; r += 1) {
    screen.put(r, 0, ' '.repeat(width), t.sidebarText, '')
  }

  screen.box(0, 0, width, height, 'single', t.sidebarBorder)

  const topTitle = ' flt metrics '
  screen.put(0, 2, topTitle, t.sidebarBorder, '', ATTR_BOLD)
  const controls = '[m] group | [t] time | [r] runs'
  const controlsCol = Math.max(2, width - controls.length - 3)
  screen.put(0, controlsCol, controls, t.sidebarMuted, '', ATTR_DIM)

  const innerLeft = 1
  const innerTop = 1
  const innerWidth = Math.max(1, width - 2)
  const innerHeight = Math.max(1, height - 2)

  const now = Date.now()
  const data = loadAll(false)
  const filtered = filteredArchives(data.archives, state.period, now)
  const grouped = aggregateRuns(data.archives, { period: state.period, groupBy: state.groupBy, now })
  const rows = state.groupBy === 'agent'
    ? buildAgentTree(data.archives, state.period, data.runs, data.parents, now)
    : grouped.rows

  const availableRows = Math.max(4, innerHeight - 12)
  const maxDataRows = Math.max(1, Math.floor(availableRows * 0.5))

  let row = innerTop
  putLine(screen, row, innerLeft, innerWidth, `Period: ${state.period}   Group: ${state.groupBy}`, t.sidebarTitle, ATTR_BOLD)
  row += 2

  putLine(screen, row, innerLeft, innerWidth, padRight(`by ${state.groupBy}`, 24) + padRight('cost', 10) + padRight('tokens in/out', 18) + padRight('runs', 6) + 'avg cost', t.sidebarMuted, ATTR_BOLD)
  row += 1
  putLine(screen, row, innerLeft, innerWidth, '─'.repeat(Math.max(0, innerWidth)), t.sidebarMuted)
  row += 1

  const shown = rows.slice(0, maxDataRows)
  const hidden = Math.max(0, rows.length - shown.length)
  const maxCost = Math.max(0, ...shown.map(r => r.cost))
  const barWidth = Math.max(8, Math.floor(innerWidth * 0.5))

  for (const item of shown) {
    const left = padRight(item.label, 24)
    const line = `${left}${padRight(fmtCost(item.cost), 10)}${padRight(`${fmtTokens(item.tokensIn)}/${fmtTokens(item.tokensOut)}`, 18)}${padRight(String(item.runs), 6)}${fmtCost(item.runs > 0 ? item.cost / item.runs : 0)}`
    putLine(screen, row, innerLeft, innerWidth, line, t.sidebarText)
    row += 1
    putLine(screen, row, innerLeft + 2, Math.max(1, innerWidth - 2), bar(item.cost, maxCost, Math.min(barWidth, innerWidth - 2)), t.commandPrefix)
    row += 1
    if (row >= innerTop + innerHeight - 8) break
  }

  if (hidden > 0 && row < innerTop + innerHeight - 8) {
    putLine(screen, row, innerLeft, innerWidth, `+${hidden} more`, t.sidebarMuted, ATTR_DIM)
    row += 1
  }

  row += 1
  if (row < innerTop + innerHeight - 5) {
    putLine(screen, row, innerLeft, innerWidth, 'cost over last 24h (1 bar = 1h)', t.sidebarMuted)
    row += 1
    putLine(screen, row, innerLeft, innerWidth, sparkline(grouped.sparkline24h), t.commandPrefix, ATTR_BOLD)
    row += 2
  }

  if (row < innerTop + innerHeight - 3) {
    putLine(screen, row, innerLeft, innerWidth, 'recent runs (by cost desc)', t.sidebarMuted)
    row += 1
    putLine(screen, row, innerLeft, innerWidth, padRight('ts', 7) + padRight('agent', 28) + padRight('model', 20) + padRight('cost', 10) + 'tokens', t.sidebarMuted, ATTR_BOLD)
    row += 1

    const runs = [...filtered].sort((a, b) => num(b.cost_usd) - num(a.cost_usd))
    const maxRunRows = Math.max(0, innerTop + innerHeight - 2 - row)
    const offset = Math.max(0, Math.min(state.runsScrollOffset, Math.max(0, runs.length - maxRunRows)))
    const visible = runs.slice(offset, offset + maxRunRows)

    for (const run of visible) {
      const model = run.actualModel || run.model || '(unknown)'
      const line = `${padRight(formatTime(run.spawnedAt), 7)}${padRight(run.name, 28)}${padRight(model, 20)}${padRight(fmtCost(num(run.cost_usd)), 10)}${fmtTokens(num(run.tokens_in))}/${fmtTokens(num(run.tokens_out))}`
      putLine(screen, row, innerLeft, innerWidth, line, t.sidebarText)
      row += 1
    }
  }

  const footer = state.runsListFocused
    ? 'm group │ t period │ r runs* │ j/k scroll │ Esc close'
    : 'm group │ t period │ r runs │ Esc close'
  putLine(screen, height - 2, 2, Math.max(1, width - 4), footer, t.sidebarMuted, ATTR_DIM)
}
