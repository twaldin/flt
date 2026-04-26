import { getAgent } from '../state'
import { formatCost, getWorkflowHistory, listWorkflows, type WorkflowFilter, type WorkflowRow, type WorkflowStepRow } from '../metrics-workflows'
import { ATTR_BOLD, ATTR_DIM, ATTR_INVERSE, type Screen } from './screen'
import { COLORS, getTheme } from './theme'

export interface WorkflowModalState {
  filter: WorkflowFilter
  rows: WorkflowRow[]
  selectedIndex: number
  drilldown: WorkflowStepRow[] | null
  drilldownId: string | null
  drilldownTitle: string | null
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.max(min, Math.min(max, value))
}

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

function putLine(screen: Screen, row: number, col: number, width: number, text: string, fg = '', bg = '', attrs = 0): void {
  if (width <= 0 || row < 0 || row >= screen.rows) return
  screen.put(row, col, padRight(text, width), fg, bg, attrs)
}

function rowTitle(row: WorkflowRow): string {
  return `${row.workflow} · ${row.id}`
}

export function loadWorkflowRows(filter: WorkflowFilter): WorkflowRow[] {
  return listWorkflows(filter)
}

export function initialWorkflowModalState(filter: WorkflowFilter = 'all'): WorkflowModalState {
  return {
    filter,
    rows: loadWorkflowRows(filter),
    selectedIndex: 0,
    drilldown: null,
    drilldownId: null,
    drilldownTitle: null,
  }
}

function renderListView(state: WorkflowModalState, screen: Screen, top: number, left: number, width: number, height: number): void {
  const t = getTheme()
  const innerWidth = width - 2
  const innerTop = top + 1
  const innerBottom = top + height - 2

  const running = state.rows.filter(r => r.status === 'running')
  const past = state.rows.filter(r => r.status !== 'running')

  let row = innerTop
  putLine(screen, row, left + 1, innerWidth, ` ● RUNNING (${running.length})`, running.length > 0 ? t.commandPrefix : t.sidebarMuted, '', ATTR_BOLD)
  row += 1

  const maxRows = Math.max(0, innerBottom - innerTop + 1)
  const maxDataRows = Math.max(0, maxRows - 4)

  const items: WorkflowRow[] = [...running, ...past]
  const selectedIndex = clamp(state.selectedIndex, 0, Math.max(0, items.length - 1))
  const scrollOffset = clamp(selectedIndex - maxDataRows + 1, 0, Math.max(0, items.length - maxDataRows))

  const idW = 22
  const stepW = 10
  const timeW = 11
  const costW = 18

  let drawn = 0
  for (let i = scrollOffset; i < items.length && drawn < maxDataRows && row <= innerBottom; i += 1) {
    if (i === running.length) {
      putLine(screen, row, left + 1, innerWidth, ` ─ PAST (${past.length})`, t.sidebarMuted, '', ATTR_DIM)
      row += 1
      if (row > innerBottom) break
    }

    const item = items[i]
    const selected = i === selectedIndex
    const fg = selected ? t.sidebarSelected : t.sidebarText
    const bg = selected ? t.sidebarSelectedBg : ''
    const attrs = selected ? ATTR_INVERSE : 0

    const prefix = selected ? '› ' : '  '
    const leftCols = `${padRight(item.id, idW)} ${padRight(item.currentStep, stepW)} ${padRight(item.startedAtDisplay, timeW)} ${padRight(formatCost(item.cost), costW)}`
    const parent = `${item.workflow} · parent: ${item.parentName}`
    const base = `${prefix}${leftCols} ${parent}`
    putLine(screen, row, left + 1, innerWidth, base, fg, bg, attrs)
    row += 1
    drawn += 1
  }

  while (row <= innerBottom) {
    putLine(screen, row, left + 1, innerWidth, '', t.sidebarText)
    row += 1
  }

  const footer = `filter: ${state.filter}  [a]all [r]running [c]completed [f]failed   ESC`
  putLine(screen, top + height - 2, left + 2, width - 4, footer, t.sidebarMuted, '', ATTR_DIM)
}

function renderDrilldownView(state: WorkflowModalState, screen: Screen, top: number, left: number, width: number, height: number): void {
  const t = getTheme()
  const steps = state.drilldown ?? []
  const innerWidth = width - 2
  const startRow = top + 1
  const endRow = top + height - 2

  // Header: meta info pulled from the matching list row.
  const meta = state.rows.find(r => r.id === state.drilldownId)
  let row = startRow
  if (meta) {
    const totalCost = formatCost(meta.cost)
    const headerLine1 = `  name: ${meta.id}    workflow: ${meta.workflow}    parent: ${meta.parentName}`
    const headerLine2 = `  status: ${meta.status}    step: ${meta.currentStep}    started: ${meta.startedAtDisplay}    cost: ${totalCost}`
    const taskLine   = meta.task ? `  task: ${truncate(meta.task.replace(/\s+/g, ' ').trim(), innerWidth - 9)}` : ''
    putLine(screen, row, left + 1, innerWidth, headerLine1, t.sidebarText, '', ATTR_BOLD); row += 1
    putLine(screen, row, left + 1, innerWidth, headerLine2, t.sidebarText); row += 1
    if (taskLine) { putLine(screen, row, left + 1, innerWidth, taskLine, t.sidebarMuted, '', ATTR_DIM); row += 1 }
    putLine(screen, row, left + 1, innerWidth, '  ─────────────────────────────────────────────────────────────', t.sidebarMuted, '', ATTR_DIM); row += 1
  }

  const nameW = 12
  const agentW = 22
  const statusW = 6
  const atW = 9
  const durW = 7
  const costW = 18

  for (let i = 0; i < steps.length && row <= endRow; i += 1) {
    const step = steps[i]
    const agentState = step.agent ? getAgent(step.agent) : undefined
    const agentDisplay = agentState ? `${step.agent} (${agentState.model})` : (step.agent ?? '—')

    const statusText = step.status === 'completed' ? 'pass' : (step.status === 'failed' ? 'fail' : 'skip')
    const statusColor = step.status === 'completed' ? COLORS.green : (step.status === 'failed' ? COLORS.red : t.sidebarMuted)

    const line = `  ${padRight(step.name, nameW)} ${padRight(agentDisplay, agentW)} ${padRight(statusText, statusW)} ${padRight(step.atDisplay, atW)} ${padRight(step.duration, durW)} ${padRight(formatCost(step.cost), costW)}`
    putLine(screen, row, left + 1, innerWidth, line, t.sidebarText)
    const statusCol = left + 1 + 2 + nameW + 1 + agentW + 1
    screen.put(row, statusCol, padRight(statusText, statusW), statusColor, '', step.status === 'skipped' ? ATTR_DIM : ATTR_BOLD)
    row += 1
  }

  if (steps.length === 0 && row <= endRow) {
    putLine(screen, row, left + 1, innerWidth, '  No step history', t.sidebarMuted, '', ATTR_DIM)
    row += 1
  }

  while (row <= endRow) {
    putLine(screen, row, left + 1, innerWidth, '', t.sidebarText)
    row += 1
  }

  const footer = 'ESC back'
  putLine(screen, top + height - 2, left + width - 2 - footer.length, footer.length, footer, t.sidebarMuted, '', ATTR_DIM)
}

export function renderWorkflowModal(state: WorkflowModalState, screen: Screen, cols: number, rows: number): void {
  const t = getTheme()

  const modalWidth = clamp(Math.floor(cols * 0.7), 60, cols - 4)
  const modalHeight = clamp(Math.floor(rows * 0.7), 12, rows - 2)

  const left = Math.floor((cols - modalWidth) / 2)
  const top = Math.floor((rows - modalHeight) / 2)

  for (let r = top; r < top + modalHeight; r += 1) {
    screen.put(r, left, ' '.repeat(modalWidth), t.sidebarText, '')
  }

  screen.box(top, left, modalWidth, modalHeight, 'round', t.sidebarBorder)

  const title = state.drilldown
    ? ` Workflows › ${truncate(state.drilldownTitle ?? state.drilldownId ?? '', modalWidth - 16)} `
    : ' Workflows '
  const titleCol = left + Math.max(1, Math.floor((modalWidth - widthOf(title)) / 2))
  screen.put(top, titleCol, title, t.sidebarBorder, '', ATTR_BOLD)

  if (state.drilldown) {
    renderDrilldownView(state, screen, top, left, modalWidth, modalHeight)
  } else {
    renderListView(state, screen, top, left, modalWidth, modalHeight)
  }
}

export function openWorkflowDrilldown(state: WorkflowModalState): WorkflowModalState {
  const row = state.rows[state.selectedIndex]
  if (!row) return state
  return {
    ...state,
    drilldown: getWorkflowHistory(row.id),
    drilldownId: row.id,
    drilldownTitle: rowTitle(row),
  }
}
