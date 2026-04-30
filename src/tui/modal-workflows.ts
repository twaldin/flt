import { getAgent } from '../state'
import {
  deriveSlug,
  formatTokens,
  formatUsd,
  getWorkflowHistory,
  listWorkflows,
  type WorkflowFilter,
  type WorkflowRow,
  type WorkflowStepRow,
} from '../metrics-workflows'
import { computeColumnWidths, truncateEllipsis } from './columns'
import { ATTR_BOLD, ATTR_DIM, ATTR_INVERSE, ATTR_UNDERLINE, type Screen } from './screen'
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

function padRight(text: string, width: number): string {
  if (width <= 0) return ''
  const clipped = truncateEllipsis(text, width)
  return `${clipped}${' '.repeat(Math.max(0, width - widthOf(clipped)))}`
}

function putLine(screen: Screen, row: number, col: number, width: number, text: string, fg = '', bg = '', attrs = 0): void {
  if (width <= 0 || row < 0 || row >= screen.rows) return
  screen.put(row, col, padRight(text, width), fg, bg, attrs)
}

// 3-cell separator (" │ ") gives breathing room around vertical column
// dividers so cells don't sit flush against the line glyph.
const SEP_W = 3

export function putSeparatedRow(
  screen: Screen,
  row: number,
  col: number,
  widths: readonly number[],
  cells: readonly string[],
  fg: string,
  sepFg: string,
  bg = '',
  attrs = 0,
): void {
  if (row < 0 || row >= screen.rows) return
  let x = col
  // Keep separator attrs aligned with row attrs so ATTR_INVERSE highlights
  // selected rows as one continuous bar across cells and separators.
  for (let i = 0; i < widths.length; i += 1) {
    screen.put(row, x, padRight(cells[i] ?? '', widths[i]), fg, bg, attrs)
    x += widths[i]
    if (i < widths.length - 1) {
      screen.put(row, x, ' │ ', sepFg, bg, attrs)
      x += SEP_W
    }
  }
}

/**
 * Horizontal rule with ─┼─ at column-separator positions, so the underline
 * meets the padded vertical separators cleanly.
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
      screen.put(row, x, '─┼─', fg)
      x += SEP_W
    }
  }
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
  const items: WorkflowRow[] = [...running, ...past]

  const headers = ['workflow', 'slug', 'stage', 'started', 'cost', 'tokens', 'parent']
  const data = items.map(item => {
    const slug = deriveSlug(item.id, item.workflow)
    return [
      item.workflow,
      slug,
      item.currentStep,
      item.startedAtDisplay,
      formatUsd(item.cost),
      formatTokens(item.cost),
      item.parentName,
    ]
  })
  const minWidths = headers.map((header, i) => Math.max(widthOf(header), ...data.map(cells => widthOf(cells[i]))))
  const widths = computeColumnWidths(minWidths, innerWidth, Math.max(0, (minWidths.length - 1) * SEP_W))

  // Two distinct tables, sharing column widths so they align: RUNNING (top)
  // then a one-row gap, then PAST (bottom). Each has its own section title +
  // header row + horizontal rule. Selection cursor crosses both tables (one
  // contiguous selectedIndex into items[]).
  const selectedIndex = clamp(state.selectedIndex, 0, Math.max(0, items.length - 1))

  // Section heights: 3 chrome rows each (title + header + rule). Past starts
  // after running's chrome + rows + gap.
  const totalRows = Math.max(0, innerBottom - innerTop + 1)
  const chromeOverhead = 3 + 3 + 1 + 1 // running chrome + past chrome + gap + footer-buffer
  const dataBudget = Math.max(0, totalRows - chromeOverhead)
  // Give running at least its full count when small; otherwise split.
  const runningBudget = Math.min(running.length, Math.max(2, Math.ceil(dataBudget * 0.4)))
  const pastBudget = Math.max(0, dataBudget - runningBudget)

  let row = innerTop

  const sectionTitle = (label: string, count: number, emphasize: boolean): void => {
    putLine(screen, row, left + 1, innerWidth, ` ${label} (${count})`, emphasize ? t.commandPrefix : t.sidebarMuted, '', emphasize ? ATTR_BOLD : (ATTR_BOLD | ATTR_DIM))
    row += 1
  }

  const sectionHeader = (): void => {
    putSeparatedRow(screen, row, left + 1, widths, headers, t.sidebarTitle, t.sidebarBorder, '', ATTR_BOLD)
    row += 1
    putHorizontalRule(screen, row, left + 1, widths, t.sidebarBorder)
    row += 1
  }

  const statusFg = (status: WorkflowRow['status']): string => {
    switch (status) {
      case 'running': return t.statusRunning
      case 'failed': return t.statusError
      // 'cancelled' uses sidebarText (not sidebarMuted) so the row text never
      // shares the border color and stays distinguishable from the line glyphs.
      case 'cancelled': return t.sidebarText
      default: return t.sidebarText
    }
  }

  const statusAttrs = (status: WorkflowRow['status']): number => {
    return status === 'cancelled' ? ATTR_DIM : 0
  }

  const renderItemRow = (item: WorkflowRow, absoluteIndex: number): void => {
    const selected = absoluteIndex === selectedIndex
    // Selected: keep the row's own status color as fg, render via ATTR_INVERSE
    // so the terminal swaps fg/bg — the row's color becomes the highlight bg.
    const fg = statusFg(item.status)
    const attrs = statusAttrs(item.status) | (selected ? ATTR_INVERSE : 0)
    const slug = deriveSlug(item.id, item.workflow)
    putSeparatedRow(
      screen,
      row,
      left + 1,
      widths,
      [
        item.workflow,
        slug,
        item.currentStep,
        item.startedAtDisplay,
        formatUsd(item.cost),
        formatTokens(item.cost),
        item.parentName,
      ],
      fg,
      t.sidebarBorder,
      '',
      attrs,
    )
    row += 1
  }

  // RUNNING section
  sectionTitle('RUNNING', running.length, running.length > 0)
  sectionHeader()
  if (running.length === 0) {
    putLine(screen, row, left + 1, innerWidth, '   (none)', t.sidebarMuted, '', ATTR_DIM)
    row += 1
  } else {
    const runningScrollMax = Math.max(0, running.length - runningBudget)
    const runningScroll = selectedIndex < running.length
      ? clamp(selectedIndex - runningBudget + 1, 0, runningScrollMax)
      : 0
    const runningEnd = Math.min(running.length, runningScroll + runningBudget)
    for (let i = runningScroll; i < runningEnd && row <= innerBottom; i += 1) {
      renderItemRow(running[i], i)
    }
  }

  // Gap
  row += 1
  if (row > innerBottom) {
    while (row <= innerBottom) { putLine(screen, row, left + 1, innerWidth, '', t.sidebarText); row += 1 }
    // skip past section if no room
  } else {
    // PAST section
    sectionTitle('PAST', past.length, false)
    if (row <= innerBottom) sectionHeader()
    if (past.length === 0) {
      if (row <= innerBottom) {
        putLine(screen, row, left + 1, innerWidth, '   (none)', t.sidebarMuted, '', ATTR_DIM)
        row += 1
      }
    } else {
      const pastSelectedRel = selectedIndex >= running.length ? selectedIndex - running.length : -1
      const pastScrollMax = Math.max(0, past.length - pastBudget)
      const pastScroll = pastSelectedRel >= 0
        ? clamp(pastSelectedRel - pastBudget + 1, 0, pastScrollMax)
        : 0
      const pastEnd = Math.min(past.length, pastScroll + pastBudget)
      for (let i = pastScroll; i < pastEnd && row <= innerBottom; i += 1) {
        renderItemRow(past[i], running.length + i)
      }
    }
    while (row <= innerBottom) { putLine(screen, row, left + 1, innerWidth, '', t.sidebarText); row += 1 }
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

  const meta = state.rows.find(r => r.id === state.drilldownId)
  let row = startRow
  if (meta) {
    const slug = deriveSlug(meta.id, meta.workflow)
    const headerLine1 = ` workflow: ${meta.workflow}    slug: ${slug || '—'}    parent: ${meta.parentName}`
    const headerLine2 = ` status: ${meta.status}    stage: ${meta.currentStep}    started: ${meta.startedAtDisplay}    cost: ${formatUsd(meta.cost)}    tokens: ${formatTokens(meta.cost)}`
    const taskLine = meta.task ? ` task: ${truncateEllipsis(meta.task.replace(/\s+/g, ' ').trim(), innerWidth - 8)}` : ''
    putLine(screen, row, left + 1, innerWidth, headerLine1, t.sidebarText, '', ATTR_BOLD); row += 1
    putLine(screen, row, left + 1, innerWidth, headerLine2, t.sidebarText); row += 1
    if (taskLine) { putLine(screen, row, left + 1, innerWidth, taskLine, t.sidebarMuted, '', ATTR_DIM); row += 1 }
    putLine(screen, row, left + 1, innerWidth, '', t.sidebarText); row += 1
  }

  const headers = ['step', 'agent', 'status', 'at', 'dur', 'cost', 'tokens']
  const data = steps.map(step => {
    const agentState = step.agent ? getAgent(step.agent) : undefined
    const agentDisplay = agentState ? `${step.agent} (${agentState.model})` : (step.agent ?? '—')
    const statusText = step.status === 'completed' ? 'pass' : (step.status === 'failed' ? 'fail' : 'skip')
    return [step.name, agentDisplay, statusText, step.atDisplay, step.duration, formatUsd(step.cost), formatTokens(step.cost)]
  })
  const minWidths = headers.map((header, i) => Math.max(widthOf(header), ...data.map(cells => widthOf(cells[i]))))
  const widths = computeColumnWidths(minWidths, innerWidth, Math.max(0, (minWidths.length - 1) * SEP_W))

  putSeparatedRow(screen, row, left + 1, widths, headers, t.sidebarTitle, t.sidebarBorder, '', ATTR_BOLD)
  row += 1
  putHorizontalRule(screen, row, left + 1, widths, t.sidebarBorder)
  row += 1

  const statusCol = left + 1 + widths[0] + 1 + widths[1] + 1

  for (let i = 0; i < steps.length && row <= endRow; i += 1) {
    const step = steps[i]
    const agentState = step.agent ? getAgent(step.agent) : undefined
    const agentDisplay = agentState ? `${step.agent} (${agentState.model})` : (step.agent ?? '—')
    const statusText = step.status === 'completed' ? 'pass' : (step.status === 'failed' ? 'fail' : 'skip')
    const statusColor = step.status === 'completed' ? COLORS.green : (step.status === 'failed' ? COLORS.red : t.sidebarMuted)

    putSeparatedRow(
      screen,
      row,
      left + 1,
      widths,
      [step.name, agentDisplay, statusText, step.atDisplay, step.duration, formatUsd(step.cost), formatTokens(step.cost)],
      t.sidebarText,
      t.sidebarBorder,
    )
    screen.put(row, statusCol, padRight(statusText, widths[2]), statusColor, '', step.status === 'skipped' ? ATTR_DIM : ATTR_BOLD)
    row += 1
  }

  if (steps.length === 0 && row <= endRow) {
    putLine(screen, row, left + 1, innerWidth, ' No step history', t.sidebarMuted, '', ATTR_DIM)
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

  const modalWidth = cols
  const modalHeight = rows
  const left = 0
  const top = 0

  for (let r = top; r < top + modalHeight; r += 1) {
    screen.put(r, left, ' '.repeat(modalWidth), t.sidebarText, '')
  }

  screen.box(top, left, modalWidth, modalHeight, 'round', t.sidebarBorder)

  const title = state.drilldown
    ? ` Workflows › ${truncateEllipsis(state.drilldownTitle ?? state.drilldownId ?? '', modalWidth - 16)} `
    : ' Workflows '
  const titleCol = left + Math.max(1, Math.floor((modalWidth - widthOf(title)) / 2))
  screen.put(top, titleCol, title, t.sidebarBorder, '', ATTR_BOLD)

  // Inner padding: shift the content rectangle inward from the box border so
  // table cells aren't flush against the vertical lines. The border stays on
  // the screen edge; only the content gets pushed in.
  const INNER_PAD = 2
  const padLeft = left + INNER_PAD
  const padWidth = Math.max(20, modalWidth - INNER_PAD * 2)

  // Always render the list view first so drilldown can overlay on top.
  renderListView(state, screen, top, padLeft, padWidth, modalHeight)

  // Drilldown is now an overlay (centered, smaller) on top of the list, so the
  // user retains visual context of which row they drilled into.
  if (state.drilldown) {
    renderDrilldownOverlay(state, screen, cols, rows)
  }
}

function renderDrilldownOverlay(state: WorkflowModalState, screen: Screen, cols: number, rows: number): void {
  const t = getTheme()
  const overlayWidth = Math.max(60, Math.min(cols - 8, Math.floor(cols * 0.85)))
  const overlayHeight = Math.max(15, Math.min(rows - 4, Math.floor(rows * 0.8)))
  const overlayLeft = Math.max(0, Math.floor((cols - overlayWidth) / 2))
  const overlayTop = Math.max(0, Math.floor((rows - overlayHeight) / 2))

  // Clear the overlay area + draw frame on top of the underlying list view.
  for (let r = overlayTop; r < overlayTop + overlayHeight; r += 1) {
    screen.put(r, overlayLeft, ' '.repeat(overlayWidth), t.sidebarText, '')
  }
  screen.box(overlayTop, overlayLeft, overlayWidth, overlayHeight, 'round', t.sidebarBorder)

  const title = ` ${truncateEllipsis(state.drilldownTitle ?? state.drilldownId ?? '', overlayWidth - 6)} `
  const titleCol = overlayLeft + Math.max(1, Math.floor((overlayWidth - widthOf(title)) / 2))
  screen.put(overlayTop, titleCol, title, t.sidebarBorder, '', ATTR_BOLD)

  renderDrilldownView(state, screen, overlayTop, overlayLeft, overlayWidth, overlayHeight)
}

export function openWorkflowDrilldown(state: WorkflowModalState): WorkflowModalState {
  const running = state.rows.filter(r => r.status === 'running')
  const past = state.rows.filter(r => r.status !== 'running')
  const items = [...running, ...past]
  const row = items[state.selectedIndex]
  if (!row) return state
  return {
    ...state,
    drilldown: getWorkflowHistory(row.id),
    drilldownId: row.id,
    drilldownTitle: rowTitle(row),
  }
}
