import { existsSync, readdirSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { getOrchestrator } from '../state'
import { aggregateRuns, type ArchiveEntry, type Period } from '../metrics'
import { computeColumnWidths, formatTokenPair, truncateEllipsis } from './columns'
import { ATTR_BOLD, ATTR_DIM, type Screen } from './screen'
import { getTheme } from './theme'
import type { MetricsModalState } from './types'

interface RunJsonHistory {
  agent?: string
}

export interface RunJson {
  id?: string
  workflow?: string
  parentName?: string
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

export interface RunsTreeRow {
  depth: number
  connector: '' | '├─ ' | '└─ '
  continuation: string
  label: string
  archive: ArchiveEntry | null
  isWorkflowNode: boolean
}

interface RunTreeNode {
  id: string
  label: string
  archive: ArchiveEntry | null
  isWorkflowNode: boolean
  children: RunTreeNode[]
  cost: number
  spawnedMs: number
}

const HOURS_24_MS = 24 * 60 * 60 * 1000
const BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
const CACHE_TTL_MS = 2000

let cache: CacheData | null = null

function widthOf(text: string): number {
  return Array.from(text).length
}

function padRight(text: string, width: number): string {
  if (width <= 0) return ''
  const clipped = truncateEllipsis(text, width)
  return `${clipped}${' '.repeat(Math.max(0, width - widthOf(clipped)))}`
}

function putLine(screen: Screen, row: number, col: number, width: number, text: string, fg = '', attrs = 0): void {
  if (row < 0 || row >= screen.rows || width <= 0) return
  screen.put(row, col, padRight(text, width), fg, '', attrs)
}

function putSeparatedRow(
  screen: Screen,
  row: number,
  col: number,
  widths: readonly number[],
  cells: readonly string[],
  fg: string,
  separatorFg: string,
  attrs = 0,
): void {
  if (row < 0 || row >= screen.rows) return
  let x = col
  for (let i = 0; i < widths.length; i += 1) {
    screen.put(row, x, padRight(cells[i] ?? '', widths[i]), fg, '', attrs)
    x += widths[i]
    if (i < widths.length - 1) {
      screen.put(row, x, '│', separatorFg)
      x += 1
    }
  }
}

/**
 * Horizontal rule that uses ┼ at the column-separator positions, so the
 * underline visually connects to the vertical separators instead of cutting
 * through them with a flat ─.
 */
function putHorizontalRule(
  screen: Screen,
  row: number,
  col: number,
  widths: readonly number[],
  fg: string,
): void {
  if (row < 0 || row >= screen.rows) return
  let x = col
  for (let i = 0; i < widths.length; i += 1) {
    screen.put(row, x, '─'.repeat(widths[i]), fg)
    x += widths[i]
    if (i < widths.length - 1) {
      screen.put(row, x, '┼', fg)
      x += 1
    }
  }
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
  const delta = now - ms
  if (delta < 0) return false
  if (period === 'today') return delta <= HOURS_24_MS
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

function sortAgentsBySpawnedDesc(names: string[], byArchive: Map<string, ArchiveEntry>): string[] {
  return [...names].sort((a, b) => {
    const aMs = parseMs(byArchive.get(a)?.spawnedAt ?? '')
    const bMs = parseMs(byArchive.get(b)?.spawnedAt ?? '')
    if (Number.isFinite(aMs) || Number.isFinite(bMs)) {
      const safeA = Number.isFinite(aMs) ? aMs : -Infinity
      const safeB = Number.isFinite(bMs) ? bMs : -Infinity
      if (safeB !== safeA) return safeB - safeA
    }
    return a.localeCompare(b)
  })
}

function flattenRunsTree(roots: RunTreeNode[]): RunsTreeRow[] {
  const out: RunsTreeRow[] = []

  function walk(node: RunTreeNode, depth: number, ancestryContinues: boolean[], isLast: boolean): void {
    const continuation = ancestryContinues.map(v => (v ? '│  ' : '   ')).join('')
    const connector: '' | '├─ ' | '└─ ' = depth === 0 ? '' : (isLast ? '└─ ' : '├─ ')
    out.push({
      depth,
      connector,
      continuation,
      label: node.label,
      archive: node.archive,
      isWorkflowNode: node.isWorkflowNode,
    })

    node.children.forEach((child, idx) => {
      walk(child, depth + 1, [...ancestryContinues, idx < node.children.length - 1], idx === node.children.length - 1)
    })
  }

  roots.forEach((root, idx) => walk(root, 0, [], idx === roots.length - 1))
  return out
}

export function buildRunsTree(
  archives: ArchiveEntry[],
  runs: RunJson[],
  parents: Record<string, string>,
  orchestratorName: string | null,
): RunsTreeRow[] {
  const archiveByName = new Map(archives.map(a => [a.name, a]))
  const childrenByParent = new Map<string, Set<string>>()
  const allKnown = new Set<string>(archives.map(a => a.name))

  for (const [child, parent] of Object.entries(parents)) {
    allKnown.add(child)
    allKnown.add(parent)
    const bucket = childrenByParent.get(parent) ?? new Set<string>()
    bucket.add(child)
    childrenByParent.set(parent, bucket)
  }

  for (const run of runs) {
    for (const step of run.history ?? []) {
      if (typeof step.agent === 'string' && step.agent) allKnown.add(step.agent)
    }
  }

  const placed = new Set<string>()

  const buildAgentNode = (name: string, stack: Set<string>): RunTreeNode | null => {
    if (stack.has(name) || placed.has(name)) return null
    stack.add(name)

    const childNames = sortAgentsBySpawnedDesc(Array.from(childrenByParent.get(name) ?? []), archiveByName)
    const children: RunTreeNode[] = []
    for (const child of childNames) {
      const node = buildAgentNode(child, new Set(stack))
      if (node) children.push(node)
    }

    const archive = archiveByName.get(name) ?? null
    if (!archive && children.length === 0) return null

    placed.add(name)
    const ownCost = archive ? num(archive.cost_usd) : 0
    const cost = ownCost + children.reduce((s, c) => s + c.cost, 0)
    const spawnedMs = archive ? parseMs(archive.spawnedAt) : Math.max(Number.NaN, ...children.map(c => c.spawnedMs))

    return {
      id: name,
      label: name,
      archive,
      isWorkflowNode: false,
      children,
      cost,
      spawnedMs,
    }
  }

  const roots: RunTreeNode[] = []

  if (orchestratorName) {
    const workflowNodes: RunTreeNode[] = []
    for (const run of runs.filter(r => r.parentName === orchestratorName)) {
      const historyAgents = Array.from(new Set((run.history ?? [])
        .map(h => h.agent)
        .filter((name): name is string => typeof name === 'string' && name)))
      const inWorkflow = new Set(historyAgents)
      const directRoots = historyAgents.filter(name => {
        const parent = parents[name]
        return !parent || !inWorkflow.has(parent)
      })

      const children: RunTreeNode[] = []
      for (const rootName of sortAgentsBySpawnedDesc(directRoots, archiveByName)) {
        const node = buildAgentNode(rootName, new Set())
        if (node) children.push(node)
      }

      const cost = children.reduce((s, c) => s + c.cost, 0)
      const spawnedMs = Math.max(Number.NaN, ...children.map(c => c.spawnedMs))
      workflowNodes.push({
        id: run.id ?? `${run.workflow ?? 'workflow'}:${workflowNodes.length}`,
        label: run.workflow ?? run.id ?? '(workflow)',
        archive: null,
        isWorkflowNode: true,
        children,
        cost,
        spawnedMs,
      })
    }

    workflowNodes.sort((a, b) => b.cost - a.cost || b.spawnedMs - a.spawnedMs || a.label.localeCompare(b.label))

    const orchestratorArchive = archiveByName.get(orchestratorName) ?? null
    if (orchestratorArchive) placed.add(orchestratorName)
    roots.push({
      id: orchestratorName,
      label: orchestratorName,
      archive: orchestratorArchive,
      isWorkflowNode: true,
      children: workflowNodes,
      cost: (orchestratorArchive ? num(orchestratorArchive.cost_usd) : 0) + workflowNodes.reduce((s, c) => s + c.cost, 0),
      spawnedMs: orchestratorArchive ? parseMs(orchestratorArchive.spawnedAt) : Math.max(Number.NaN, ...workflowNodes.map(c => c.spawnedMs)),
    })
  }

  const unplacedArchives = archives.filter(a => !placed.has(a.name)).map(a => a.name)
  const rootCandidates = new Set<string>()

  for (const name of unplacedArchives) {
    let root = name
    const seen = new Set<string>([name])
    let parent = parents[root]
    while (parent && !seen.has(parent) && !placed.has(parent)) {
      seen.add(parent)
      if (!allKnown.has(parent)) break
      root = parent
      parent = parents[root]
    }
    rootCandidates.add(root)
  }

  const floatingRoots: RunTreeNode[] = []
  for (const rootName of rootCandidates) {
    const node = buildAgentNode(rootName, new Set())
    if (node) floatingRoots.push(node)
  }

  floatingRoots.sort((a, b) => b.cost - a.cost || b.spawnedMs - a.spawnedMs || a.label.localeCompare(b.label))
  roots.push(...floatingRoots)

  for (const archive of archives) {
    if (placed.has(archive.name)) continue
    placed.add(archive.name)
    roots.push({
      id: archive.name,
      label: archive.name,
      archive,
      isWorkflowNode: false,
      children: [],
      cost: num(archive.cost_usd),
      spawnedMs: parseMs(archive.spawnedAt),
    })
  }

  return flattenRunsTree(roots)
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
  // Always render with the live terminal size passed by caller.
  const width = term.width
  const height = term.height

  for (let r = 0; r < height; r += 1) {
    screen.put(r, 0, ' '.repeat(width), t.sidebarText, '')
  }
  screen.box(0, 0, width, height, 'single', t.sidebarBorder)

  const topTitle = ' flt metrics '
  screen.put(0, 2, topTitle, t.sidebarBorder, '', ATTR_BOLD)
  const controls = '[m] group | [t] period | j/k scroll'
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
  const totalCost = filtered.reduce((s, r) => s + num(r.cost_usd), 0)

  let row = innerTop
  putLine(screen, row, innerLeft, innerWidth, `Period: ${state.period}    Group: ${state.groupBy}    Total: ${fmtCost(totalCost)}    Runs: ${filtered.length}`, t.sidebarTitle, ATTR_BOLD)
  row += 2

  const groupSectionMax = Math.max(6, Math.floor(innerHeight * 0.4))
  const groupCols = ['by ' + state.groupBy, 'cost', 'tokens', 'runs', 'avg cost', 'share']
  const groupData = rows.map(item => {
    const sharePct = (item.cost / Math.max(0.0001, totalCost)) * 100
    return [
      item.label,
      fmtCost(item.cost),
      formatTokenPair(item.tokensIn, item.tokensOut),
      String(item.runs),
      fmtCost(item.runs > 0 ? item.cost / item.runs : 0),
      `${sharePct.toFixed(1)}%`,
    ]
  })
  const groupMinWidths = groupCols.map((header, i) => Math.max(widthOf(header), ...groupData.map(cells => widthOf(cells[i]))))
  const groupWidths = computeColumnWidths(groupMinWidths, innerWidth)

  // by-<group> section: NO vertical separators (the share-bar row below each
  // data row would break the grid anyway). Use plain padded cells joined by
  // a 2-space gap.
  const renderGroupRow = (cells: readonly string[], fg: string, attrs = 0): void => {
    let x = innerLeft
    for (let i = 0; i < groupWidths.length; i += 1) {
      screen.put(row, x, padRight(cells[i] ?? '', groupWidths[i]), fg, '', attrs)
      x += groupWidths[i]
      if (i < groupWidths.length - 1) {
        screen.put(row, x, '  ', fg, '')
        x += 2
      }
    }
  }
  renderGroupRow(groupCols, t.sidebarMuted, ATTR_BOLD)
  row += 1
  putLine(screen, row, innerLeft, innerWidth, '─'.repeat(Math.max(0, innerWidth)), t.sidebarMuted)
  row += 1

  const groupCapRows = Math.max(2, groupSectionMax - 2)
  const groupRowsToShow = Math.floor(groupCapRows / 2)
  const shown = rows.slice(0, groupRowsToShow)
  const hidden = Math.max(0, rows.length - shown.length)
  const maxCost = Math.max(0.0001, ...shown.map(r => r.cost))
  const barWidth = Math.max(20, Math.floor(innerWidth * 0.55))

  for (const item of shown) {
    const sharePct = (item.cost / Math.max(0.0001, totalCost)) * 100
    renderGroupRow(
      [
        item.label,
        fmtCost(item.cost),
        formatTokenPair(item.tokensIn, item.tokensOut),
        String(item.runs),
        fmtCost(item.runs > 0 ? item.cost / item.runs : 0),
        `${sharePct.toFixed(1)}%`,
      ],
      t.sidebarText,
    )
    row += 1
    putLine(screen, row, innerLeft + 2, Math.max(1, innerWidth - 2), bar(item.cost, maxCost, Math.min(barWidth, innerWidth - 2)), t.commandPrefix)
    row += 1
  }
  if (hidden > 0) {
    putLine(screen, row, innerLeft, innerWidth, `  +${hidden} more (${state.groupBy} group)`, t.sidebarMuted, ATTR_DIM)
    row += 1
  }
  row += 1

  const sparkLabel =
    state.period === 'today' ? 'cost over last 24h (1 bar = 1h, leftmost = 24h ago)'
    : state.period === 'week' ? 'cost over last 7d (1 bar = 6h, leftmost = 7d ago)'
    : state.period === 'month' ? 'cost over last 30d (1 bar = 1d, leftmost = 30d ago)'
    : 'cost over last 60d (1 bar = 1d, leftmost = 60d ago)'
  putLine(screen, row, innerLeft, innerWidth, sparkLabel, t.sidebarMuted)
  row += 1
  putLine(screen, row, innerLeft, innerWidth, sparkline(grouped.sparkline24h), t.commandPrefix, ATTR_BOLD)
  row += 2

  putLine(screen, row, innerLeft, innerWidth, `recent runs (tree, ${filtered.length} total) — j/k scroll`, t.sidebarMuted)
  row += 1

  const orchestrator = getOrchestrator()
  const orchestratorName = orchestrator ? (orchestrator.type === 'human' ? 'human' : 'orchestrator') : 'human'
  const runRows = buildRunsTree(filtered, data.runs, data.parents, orchestratorName)
  const runCols = ['ts', 'run', 'model', 'cost', 'tokens']
  const runData = runRows.map(item => [
    item.archive ? formatTime(item.archive.spawnedAt) : '—',
    `${item.continuation}${item.connector}${item.label}`,
    item.archive ? (item.archive.actualModel || item.archive.model || '(unknown)') : '—',
    item.archive ? fmtCost(num(item.archive.cost_usd)) : '—',
    item.archive ? formatTokenPair(num(item.archive.tokens_in), num(item.archive.tokens_out)) : '—',
  ])
  const runMinWidths = runCols.map((header, i) => Math.max(widthOf(header), ...runData.map(cells => widthOf(cells[i]))))
  const runWidths = computeColumnWidths(runMinWidths, innerWidth)

  putSeparatedRow(screen, row, innerLeft, runWidths, runCols, t.sidebarMuted, t.sidebarBorder, ATTR_BOLD)
  row += 1
  // Horizontal rule with ┼ at the column-separator positions so the
  // underline meets the vertical separators cleanly.
  putHorizontalRule(screen, row, innerLeft, runWidths, t.sidebarMuted)
  row += 1

  const maxRunRows = Math.max(0, innerTop + innerHeight - 2 - row)
  const offset = Math.max(0, Math.min(state.runsScrollOffset, Math.max(0, runRows.length - maxRunRows)))
  const visible = runRows.slice(offset, offset + maxRunRows)
  for (const run of visible) {
    putSeparatedRow(
      screen,
      row,
      innerLeft,
      runWidths,
      [
        run.archive ? formatTime(run.archive.spawnedAt) : '—',
        `${run.continuation}${run.connector}${run.label}`,
        run.archive ? (run.archive.actualModel || run.archive.model || '(unknown)') : '—',
        run.archive ? fmtCost(num(run.archive.cost_usd)) : '—',
        run.archive ? formatTokenPair(num(run.archive.tokens_in), num(run.archive.tokens_out)) : '—',
      ],
      t.sidebarText,
      t.sidebarBorder,
    )
    row += 1
  }

  const footer = `m group │ t period │ j/k scroll runs │ Esc close   (showing ${visible.length}/${runRows.length})`
  putLine(screen, height - 2, 2, Math.max(1, width - 4), footer, t.sidebarMuted, ATTR_DIM)
}
