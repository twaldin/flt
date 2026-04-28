import * as fs from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { scanGates, scanBlockers, cleanStaleGates, type GateRow, type BlockerRow } from '../gates'
import { pendingQna, writeAnswer, type QnaRow, type Question } from '../qna'
import { computeColumnWidths, truncateEllipsis } from './columns'
import { ATTR_BOLD, ATTR_DIM, ATTR_INVERSE, ATTR_UNDERLINE, type Screen } from './screen'
import { getTheme } from './theme'

export type ModalKind = GateRow['kind'] | 'question'

export interface ModalRow {
  runId: string
  workflow: string
  kind: ModalKind
  reason: string
  ageMs: number
  runDir: string
  payload: Record<string, unknown>
  source: 'gate' | 'question'
  question?: Question
  questionPath?: string
  answerPath?: string
  batchQuestions?: Question[]
  batchAnswerPaths?: string[]
}

export interface GatesModalState {
  rows: ModalRow[]
  selectedIndex: number
  subPicker: { nodeId: string; candidates: string[]; index: number } | null
  rejectPrompt: { reason: string } | null
  cancelConfirm: boolean
  blockerOverlay: BlockerRow | null
  detailOverlay: ModalRow | null
  questionPicker: {
    question: Question
    answerPath: string
    runId: string
    index: number
    selected: Set<string>
    typing: { text: string } | null
    batch?: { questions: Question[]; answerPaths: string[]; index: number }
  } | null
  watcher: fs.FSWatcher | null
  qnaWatcher: fs.FSWatcher | null
}

function gateRowToModal(row: GateRow): ModalRow {
  return { ...row, source: 'gate' }
}

function qnaRowToModal(row: QnaRow): ModalRow {
  return {
    runId: row.runId || '_unrouted',
    workflow: row.question.header,
    kind: 'question',
    reason: row.question.question,
    ageMs: row.ageMs,
    runDir: '',
    payload: { kind: 'question', questionId: row.questionId },
    source: 'question',
    question: row.question,
    questionPath: row.questionPath,
    answerPath: row.answerPath,
  }
}

function loadAllRows(): ModalRow[] {
  const gates = scanGates().map(gateRowToModal)
  const qnaRows = pendingQna()

  // Group qna rows by batchId so multi-question askHuman calls render as one
  // chained pick-flow (single row → walks through each question on Enter).
  const batches = new Map<string, QnaRow[]>()
  const singletons: QnaRow[] = []
  for (const row of qnaRows) {
    const bid = row.question.batchId
    if (!bid) {
      singletons.push(row)
      continue
    }
    const arr = batches.get(bid) ?? []
    arr.push(row)
    batches.set(bid, arr)
  }

  const batchRows: ModalRow[] = []
  for (const [bid, rows] of batches) {
    if (rows.length === 1) {
      // Single question that happened to carry a batchId — render as singleton.
      singletons.push(rows[0]!)
      continue
    }
    const sorted = [...rows].sort((a, b) => a.askedAt.localeCompare(b.askedAt))
    const first = sorted[0]!
    batchRows.push({
      runId: first.runId || '_unrouted',
      workflow: `[${rows.length}q] ${first.question.header}`,
      kind: 'question',
      reason: `${rows.length} questions from ${first.question.askedBy ?? 'agent'} — Enter walks through them`,
      ageMs: first.ageMs,
      runDir: '',
      payload: { kind: 'question-batch', batchId: bid, count: rows.length },
      source: 'question',
      question: first.question,
      questionPath: first.questionPath,
      answerPath: first.answerPath,
      batchQuestions: sorted.map(r => r.question),
      batchAnswerPaths: sorted.map(r => r.answerPath),
    })
  }

  return [...gates, ...batchRows, ...singletons.map(qnaRowToModal)]
}

export function getPendingGatesCount(runsDir?: string, qnaDir?: string): number {
  return scanGates(runsDir).length + (() => {
    // Count batches as one + non-batch questions as one each (mirror the
    // grouping in loadAllRows so the badge agrees with the modal's row count).
    const qnaRows = pendingQna(qnaDir)
    const seen = new Set<string>()
    let n = 0
    for (const row of qnaRows) {
      const bid = row.question.batchId
      if (!bid) { n += 1; continue }
      if (!seen.has(bid)) { seen.add(bid); n += 1 }
    }
    return n
  })()
}

function dispatchAnswer(runId: string, questionId: string, selected: string[], text: string | undefined): void {
  void writeAnswer(questionId, selected, text, { runId, notify: true }).catch(() => {})
}

// After answering the current question in the picker, advance to the next
// question in the batch (if any). Otherwise close the picker.
function advancePickerOrClose(state: GatesModalState): void {
  const picker = state.questionPicker
  if (!picker) return
  const batch = picker.batch
  if (batch && batch.index < batch.questions.length - 1) {
    const nextIdx = batch.index + 1
    batch.index = nextIdx
    picker.question = batch.questions[nextIdx]!
    picker.answerPath = batch.answerPaths[nextIdx]!
    picker.index = 0
    picker.selected = new Set<string>()
    picker.typing = null
  } else {
    state.questionPicker = null
  }
}

function defaultRunsDir(): string {
  return join(homedir(), '.flt', 'runs')
}

export function initialGatesModalState(): GatesModalState {
  cleanStaleGates()
  return {
    rows: loadAllRows(),
    selectedIndex: 0,
    subPicker: null,
    rejectPrompt: null,
    cancelConfirm: false,
    blockerOverlay: null,
    detailOverlay: null,
    questionPicker: null,
    watcher: null,
    qnaWatcher: null,
  }
}

function defaultQnaDir(): string {
  return join(homedir(), '.flt', 'qna')
}

export function openGatesWatcher(state: GatesModalState, onChange: () => void): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const refresh = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      cleanStaleGates()
      state.rows = loadAllRows()
      onChange()
    }, 150)
  }

  if (!state.watcher) {
    try {
      state.watcher = fs.watch(defaultRunsDir(), { recursive: true }, refresh)
      state.watcher.on('error', () => { state.watcher = null })
    } catch {
      state.watcher = null
    }
  }

  if (!state.qnaWatcher) {
    const qnaDir = defaultQnaDir()
    try {
      if (!fs.existsSync(qnaDir)) fs.mkdirSync(qnaDir, { recursive: true })
      state.qnaWatcher = fs.watch(qnaDir, { recursive: true }, refresh)
      state.qnaWatcher.on('error', () => { state.qnaWatcher = null })
    } catch {
      state.qnaWatcher = null
    }
  }
}

export function closeGatesWatcher(state: GatesModalState): void {
  if (state.watcher) {
    state.watcher.close()
    state.watcher = null
  }
  if (state.qnaWatcher) {
    state.qnaWatcher.close()
    state.qnaWatcher = null
  }
}

// Rendering helpers (mirroring modal-workflows.ts)

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

function putSeparatedRow(
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
  // Separator never inherits ATTR_INVERSE — keeps the line glyph crisp on
  // selected rows (highlight is bg-only).
  const sepAttrs = attrs & ~ATTR_INVERSE
  for (let i = 0; i < widths.length; i += 1) {
    screen.put(row, x, padRight(cells[i] ?? '', widths[i]), fg, bg, attrs)
    x += widths[i]
    if (i < widths.length - 1) {
      screen.put(row, x, ' │ ', sepFg, bg, sepAttrs)
      x += SEP_W
    }
  }
}

function formatAge(ms: number): string {
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  return `${hours}h`
}

function kindColor(kind: string, t: ReturnType<typeof getTheme>): string {
  switch (kind) {
    case 'human_gate': return t.statusRunning   // calls for action — accent
    case 'node-fail': return t.statusError       // failure — alert
    case 'reconcile-fail': return t.statusError  // failure — alert
    case 'node-candidate': return t.statusRunning // calls for action
    case 'question': return t.commandPrefix       // info / waiting on you
    case 'blocker': return t.statusError         // hard stop
    default: return t.sidebarText
  }
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'human_gate': return 'human'
    case 'node-fail': return 'node-fail'
    case 'reconcile-fail': return 'recon-fail'
    case 'node-candidate': return 'candidate'
    case 'question': return 'question'
    default: return kind
  }
}

function kindFooter(kind: string): string {
  switch (kind) {
    case 'human_gate': return 'a approve | x reject | c cancel'
    case 'node-fail': return 'r retry | s skip | a abort | c cancel'
    case 'reconcile-fail': return 'r retry | a abort | c cancel'
    case 'node-candidate': return 'Enter pick candidate | c cancel'
    case 'question': return 'Enter answer | s skip'
    case 'blocker': return 'v view | c cancel'
    default: return 'c cancel'
  }
}

export interface GatesActions {
  approve: (runId: string, opts?: { candidate?: string; nodeId?: string }) => void
  reject: (runId: string, reason: string) => void
  nodeRetry: (runId: string, nodeId?: string) => void
  nodeSkip: (runId: string, nodeId?: string) => void
  nodeAbort: (runId: string) => void
  reconcileRetry: (runId: string) => void
  reconcileAbort: (runId: string) => void
  pickCandidate: (runId: string, nodeId: string, candidate: string) => void
  cancelRun: (runId: string) => void
  dismissBlocker: (runDir: string) => void
  refresh: () => void
}

function renderSubPicker(
  screen: Screen,
  state: GatesModalState,
  top: number,
  left: number,
  cols: number,
  rows: number,
): void {
  const t = getTheme()
  const picker = state.subPicker
  if (!picker) return

  const width = Math.min(44, cols - 4)
  const height = Math.min(picker.candidates.length + 4, rows - 4)
  const pickerLeft = left + Math.floor((cols - width) / 2)
  const pickerTop = top + Math.floor((rows - height) / 2)

  for (let r = pickerTop; r < pickerTop + height; r += 1) {
    screen.put(r, pickerLeft, ' '.repeat(width), t.sidebarText, '')
  }
  screen.box(pickerTop, pickerLeft, width, height, 'round', t.sidebarBorder)

  const title = ' Select Candidate '
  screen.put(pickerTop, pickerLeft + Math.floor((width - widthOf(title)) / 2), title, t.sidebarBorder, '', ATTR_BOLD)

  let r = pickerTop + 1
  const innerWidth = width - 2
  for (let i = 0; i < picker.candidates.length && r < pickerTop + height - 1; i += 1) {
    const selected = i === picker.index
    const label = picker.candidates[i]
    const shortcut = String.fromCharCode(97 + i)
    const text = ` [${shortcut}] ${label}`
    screen.put(
      r,
      pickerLeft + 1,
      padRight(text, innerWidth),
      selected ? t.sidebarSelected : t.sidebarText,
      selected ? t.sidebarSelectedBg : '',
      0,
    )
    r += 1
  }

  putLine(screen, pickerTop + height - 2, pickerLeft + 2, innerWidth - 2, 'j/k select | Enter pick | Esc back', t.sidebarMuted, '', ATTR_DIM)
}

function renderRejectPrompt(
  screen: Screen,
  state: GatesModalState,
  top: number,
  left: number,
  cols: number,
  rows: number,
): void {
  const t = getTheme()
  const prompt = state.rejectPrompt
  if (!prompt) return

  const width = Math.min(60, cols - 4)
  const height = 5
  const promptLeft = left + Math.floor((cols - width) / 2)
  const promptTop = top + Math.floor((rows - height) / 2)

  for (let r = promptTop; r < promptTop + height; r += 1) {
    screen.put(r, promptLeft, ' '.repeat(width), t.sidebarText, '')
  }
  screen.box(promptTop, promptLeft, width, height, 'round', t.sidebarBorder)

  const title = ' Reject Reason '
  screen.put(promptTop, promptLeft + Math.floor((width - widthOf(title)) / 2), title, t.sidebarBorder, '', ATTR_BOLD)

  const innerWidth = width - 4
  const reasonDisplay = truncateEllipsis(prompt.reason, innerWidth - 1)
  putLine(screen, promptTop + 1, promptLeft + 2, innerWidth, 'Reason:', t.sidebarMuted)
  putLine(screen, promptTop + 2, promptLeft + 2, innerWidth, `${reasonDisplay}█`, t.sidebarText)
  putLine(screen, promptTop + 3, promptLeft + 2, innerWidth, 'Enter submit | Esc cancel', t.sidebarMuted, '', ATTR_DIM)
}

function renderCancelConfirm(
  screen: Screen,
  state: GatesModalState,
  top: number,
  left: number,
  cols: number,
  rows: number,
): void {
  const t = getTheme()
  if (!state.cancelConfirm) return

  const row = state.rows[state.selectedIndex]
  const runLabel = row ? row.runId : '?'

  const width = Math.min(48, cols - 4)
  const height = 3
  const confirmLeft = left + Math.floor((cols - width) / 2)
  const confirmTop = top + Math.floor((rows - height) / 2)

  for (let r = confirmTop; r < confirmTop + height; r += 1) {
    screen.put(r, confirmLeft, ' '.repeat(width), t.sidebarText, '')
  }
  screen.box(confirmTop, confirmLeft, width, height, 'round', t.sidebarBorder)
  putLine(screen, confirmTop + 1, confirmLeft + 2, width - 4, `Cancel run ${runLabel}? [y/n]`, t.sidebarText)
}

function renderBlockerOverlay(
  screen: Screen,
  state: GatesModalState,
  top: number,
  left: number,
  cols: number,
  rows: number,
): void {
  const t = getTheme()
  const blocker = state.blockerOverlay
  if (!blocker) return

  const width = Math.min(80, cols - 4)
  const height = Math.min(14, rows - 4)
  const overlayLeft = left + Math.floor((cols - width) / 2)
  const overlayTop = top + Math.floor((rows - height) / 2)

  for (let r = overlayTop; r < overlayTop + height; r += 1) {
    screen.put(r, overlayLeft, ' '.repeat(width), t.sidebarText, '')
  }
  screen.box(overlayTop, overlayLeft, width, height, 'round', t.sidebarBorder)

  const title = ' Blocker Report '
  screen.put(overlayTop, overlayLeft + Math.floor((width - widthOf(title)) / 2), title, t.sidebarBorder, '', ATTR_BOLD)

  const innerWidth = width - 4
  let r = overlayTop + 1

  putLine(screen, r, overlayLeft + 2, innerWidth, `Run: ${blocker.runId}  Workflow: ${blocker.workflow}`, t.sidebarText, '', ATTR_BOLD)
  r += 1
  putLine(screen, r, overlayLeft + 2, innerWidth, `Reason: ${blocker.reason}`, t.sidebarText)
  r += 2

  const reportEntries = Object.entries(blocker.report)
  for (const [k, v] of reportEntries) {
    if (r >= overlayTop + height - 2) break
    putLine(screen, r, overlayLeft + 2, innerWidth, `${k}: ${JSON.stringify(v)}`, t.sidebarMuted, '', ATTR_DIM)
    r += 1
  }

  putLine(screen, overlayTop + height - 2, overlayLeft + 2, innerWidth, 'Esc close', t.sidebarMuted, '', ATTR_DIM)
}

function renderDetailOverlay(
  screen: Screen,
  state: GatesModalState,
  top: number,
  left: number,
  cols: number,
  rows: number,
): void {
  const t = getTheme()
  const row = state.detailOverlay
  if (!row) return

  const innerCap = Math.max(40, Math.min(96, cols - 8))
  const reasonLines = wordWrap(row.reason, innerCap - 4)
  const headerLines = 4 // title + run/workflow + kind/age + spacer
  const footerLines = 2 // spacer + action hint
  const contentLines = reasonLines.length
  const desiredHeight = headerLines + contentLines + footerLines + 2 // +2 for borders
  const height = Math.max(8, Math.min(desiredHeight, rows - 4))
  const width = innerCap
  const overlayLeft = left + Math.floor((cols - width) / 2)
  const overlayTop = top + Math.floor((rows - height) / 2)

  for (let r = overlayTop; r < overlayTop + height; r += 1) {
    screen.put(r, overlayLeft, ' '.repeat(width), t.sidebarText, '')
  }
  screen.box(overlayTop, overlayLeft, width, height, 'round', t.sidebarBorder)

  const title = ` ${kindLabel(row.kind)} `
  screen.put(overlayTop, overlayLeft + Math.max(1, Math.floor((width - widthOf(title)) / 2)), title, t.sidebarBorder, '', ATTR_BOLD)

  const innerWidth = width - 4
  let r = overlayTop + 1
  putLine(screen, r, overlayLeft + 2, innerWidth, `Run: ${row.runId}  ·  Workflow: ${row.workflow}`, t.sidebarText, '', ATTR_BOLD)
  r += 1
  putLine(screen, r, overlayLeft + 2, innerWidth, `Age: ${formatAge(row.ageMs)}`, t.sidebarMuted, '', ATTR_DIM)
  r += 2

  const maxReasonRows = Math.max(0, overlayTop + height - 2 - r)
  for (let i = 0; i < reasonLines.length && i < maxReasonRows; i += 1) {
    putLine(screen, r, overlayLeft + 2, innerWidth, reasonLines[i]!, t.sidebarText)
    r += 1
  }

  const hint = kindFooter(row.kind)
  const footer = hint ? `${hint} | Esc close` : 'Esc close'
  putLine(screen, overlayTop + height - 2, overlayLeft + 2, innerWidth, footer, t.sidebarMuted, '', ATTR_DIM)
}

export function renderGatesModal(screen: Screen, state: GatesModalState, layout: { width: number; height: number }): void {
  const t = getTheme()
  const { width: cols, height: rows } = layout
  const left = 0
  const top = 0

  for (let r = top; r < top + rows; r += 1) {
    screen.put(r, left, ' '.repeat(cols), t.sidebarText, '')
  }

  screen.box(top, left, cols, rows, 'round', t.sidebarBorder)

  const title = ' Gates '
  screen.put(top, left + Math.floor((cols - widthOf(title)) / 2), title, t.sidebarBorder, '', ATTR_BOLD)

  const innerWidth = cols - 2
  const innerTop = top + 1
  const innerBottom = top + rows - 2

  const headers = ['AGE', 'RUN', 'WORKFLOW', 'KIND', 'REASON']
  const data = state.rows.map(row => [
    formatAge(row.ageMs),
    row.runId,
    row.workflow,
    kindLabel(row.kind),
    row.reason,
  ])

  const minWidths = headers.map((h, i) => Math.max(widthOf(h), ...data.map(cells => widthOf(cells[i] ?? ''))))
  const widths = computeColumnWidths(minWidths, innerWidth, Math.max(0, (minWidths.length - 1) * SEP_W))

  let r = innerTop
  putSeparatedRow(screen, r, left + 1, widths, headers, t.sidebarTitle, t.sidebarBorder, '', ATTR_BOLD | ATTR_UNDERLINE)
  r += 1

  if (state.rows.length === 0) {
    putLine(screen, r, left + 1, innerWidth, '  No pending gates', t.sidebarMuted, '', ATTR_DIM)
    r += 1
  } else {
    const maxDataRows = Math.max(0, innerBottom - r)
    const selectedIndex = clamp(state.selectedIndex, 0, Math.max(0, state.rows.length - 1))
    const scrollOffset = clamp(selectedIndex - maxDataRows + 1, 0, Math.max(0, state.rows.length - maxDataRows))

    for (let i = scrollOffset; i < state.rows.length && r <= innerBottom - 1; i += 1) {
      const row = state.rows[i]
      const selected = i === selectedIndex
      const kindFg = kindColor(row.kind, t)
      putSeparatedRow(
        screen,
        r,
        left + 1,
        widths,
        [formatAge(row.ageMs), row.runId, row.workflow, kindLabel(row.kind), row.reason],
        selected ? t.sidebarSelected : kindFg,
        t.sidebarBorder,
        selected ? t.sidebarSelectedBg : '',
        0,
      )
      r += 1
    }
  }

  while (r <= innerBottom - 1) {
    putLine(screen, r, left + 1, innerWidth, '', t.sidebarText)
    r += 1
  }

  const selectedRow = state.rows[state.selectedIndex]
  const kindHint = selectedRow ? kindFooter(selectedRow.kind) : ''
  const footer = kindHint ? `${kindHint} | d dismiss | j/k select | Esc close` : 'j/k select | Esc close'
  putLine(screen, innerBottom, left + 2, cols - 4, footer, t.sidebarMuted, '', ATTR_DIM)

  if (state.blockerOverlay) {
    renderBlockerOverlay(screen, state, top, left, cols, rows)
  } else if (state.detailOverlay) {
    renderDetailOverlay(screen, state, top, left, cols, rows)
  } else if (state.cancelConfirm) {
    renderCancelConfirm(screen, state, top, left, cols, rows)
  } else if (state.rejectPrompt) {
    renderRejectPrompt(screen, state, top, left, cols, rows)
  } else if (state.subPicker) {
    renderSubPicker(screen, state, top, left, cols, rows)
  } else if (state.questionPicker) {
    renderQuestionPicker(screen, state, top, left, cols, rows)
  }
}

function wordWrap(text: string, width: number): string[] {
  if (width <= 0 || text.length === 0) return ['']
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    if (paragraph.length === 0) { out.push(''); continue }
    const words = paragraph.split(/\s+/).filter(Boolean)
    let line = ''
    for (const word of words) {
      if (widthOf(word) > width) {
        if (line) { out.push(line); line = '' }
        for (let i = 0; i < word.length; i += width) out.push(word.slice(i, i + width))
        continue
      }
      if (!line) { line = word; continue }
      if (widthOf(line) + 1 + widthOf(word) <= width) line += ' ' + word
      else { out.push(line); line = word }
    }
    if (line) out.push(line)
  }
  return out.length > 0 ? out : ['']
}

interface OptionBlock {
  selected: boolean
  isChecked: boolean
  shortcut: string
  headLines: string[]
  descLines: string[]
}

function renderQuestionPicker(
  screen: Screen,
  state: GatesModalState,
  top: number,
  left: number,
  cols: number,
  rows: number,
): void {
  const t = getTheme()
  const picker = state.questionPicker
  if (!picker) return

  const opts = picker.question.options

  // Picker sizing — content-aware, centered, capped at most-of-screen.
  // Use a wrap target of ~70% of available, then size to actual longest line.
  const maxOuterW = Math.max(40, cols - 4)
  const maxInnerW = Math.max(20, maxOuterW - 4)
  const wrapTarget = Math.min(maxInnerW, Math.max(48, Math.floor(cols * 0.7)))
  const descIndent = '       '

  const promptLines = wordWrap(picker.question.question, wrapTarget)
  const optionBlocks: OptionBlock[] = opts.map((opt, i) => {
    const isChecked = picker.selected.has(opt.label)
    const checkBox = isChecked ? '[x]' : (picker.question.multiSelect ? '[ ]' : '   ')
    const shortcut = String.fromCharCode(97 + i)
    const head = ` ${checkBox} ${shortcut}. ${opt.label}`
    const headLines = wordWrap(head, wrapTarget)
    const descLines = opt.description
      ? wordWrap(opt.description, wrapTarget - descIndent.length).map(l => descIndent + l)
      : []
    return { selected: i === picker.index, isChecked, shortcut, headLines, descLines }
  })

  const allLines: { text: string; kind: 'prompt' | 'spacer' | 'opt-head' | 'opt-desc' | 'input' | 'footer'; selected?: boolean }[] = []
  for (const l of promptLines) allLines.push({ text: l, kind: 'prompt' })
  allLines.push({ text: '', kind: 'spacer' })
  for (const block of optionBlocks) {
    for (const l of block.headLines) allLines.push({ text: l, kind: 'opt-head', selected: block.selected })
    for (const l of block.descLines) allLines.push({ text: l, kind: 'opt-desc', selected: block.selected })
  }
  if (picker.typing) {
    allLines.push({ text: '', kind: 'spacer' })
    allLines.push({ text: `> ${picker.typing.text}█`, kind: 'input' })
  }

  // Compute width = max line length + padding, capped.
  const longest = Math.max(
    widthOf(` ${picker.question.header} `),
    ...allLines.map(l => widthOf(l.text)),
  )
  const innerWidth = Math.min(maxInnerW, Math.max(longest, 40))
  const width = Math.min(maxOuterW, innerWidth + 4)

  // Footer help text (kept short so it doesn't dominate width)
  const help = picker.typing
    ? 'type your answer | Enter submit | Esc back'
    : (picker.question.multiSelect
      ? 'j/k select | Space toggle | t type custom | Enter submit | Esc back'
      : 'j/k select | t type custom | Enter submit | Esc back')

  // Height = title + content + footer + 2 borders, capped to fit screen.
  const contentLines = allLines.length + 1 /* footer line */ + 1 /* spacer above footer */
  const desiredHeight = contentLines + 2 /* top/bottom border */
  const height = Math.min(Math.max(8, desiredHeight), rows - 4)

  // Centered placement.
  const pickerLeft = left + Math.max(0, Math.floor((cols - width) / 2))
  const pickerTop = top + Math.max(0, Math.floor((rows - height) / 2))

  // Clear background.
  for (let r = pickerTop; r < pickerTop + height; r += 1) {
    screen.put(r, pickerLeft, ' '.repeat(width), t.sidebarText, '')
  }
  screen.box(pickerTop, pickerLeft, width, height, 'round', t.sidebarBorder)

  // Title (centered in border). Includes batch progress when in a multi-question batch.
  const batchSuffix = picker.batch ? ` [${picker.batch.index + 1}/${picker.batch.questions.length}]` : ''
  const titleText = ` ${picker.question.header}${batchSuffix} `
  screen.put(pickerTop, pickerLeft + Math.max(1, Math.floor((width - widthOf(titleText)) / 2)), titleText, t.sidebarBorder, '', ATTR_BOLD)

  // Available content rows = height - 2 borders - 2 (footer + spacer above footer).
  const contentRowsAvail = height - 4
  // Auto-scroll so the selected option's first headLine is visible.
  let firstSelectedIdx = -1
  for (let i = 0; i < allLines.length; i += 1) {
    if (allLines[i].kind === 'opt-head' && allLines[i].selected) { firstSelectedIdx = i; break }
  }
  let scrollOffset = 0
  if (firstSelectedIdx >= 0 && allLines.length > contentRowsAvail) {
    if (firstSelectedIdx >= contentRowsAvail) {
      scrollOffset = Math.min(firstSelectedIdx - contentRowsAvail + 2, allLines.length - contentRowsAvail)
    }
  }
  scrollOffset = Math.max(0, scrollOffset)

  let r = pickerTop + 1
  for (let i = scrollOffset; i < allLines.length && r < pickerTop + 1 + contentRowsAvail; i += 1) {
    const ln = allLines[i]
    if (ln.kind === 'spacer') {
      r += 1
      continue
    }
    const isPromptHead = ln.kind === 'prompt'
    const isInput = ln.kind === 'input'
    const fg = ln.selected ? t.sidebarSelected : (ln.kind === 'opt-desc' ? t.sidebarMuted : t.sidebarText)
    const bg = ln.selected ? t.sidebarSelectedBg : ''
    const attrs = ln.selected ? ATTR_INVERSE : (isPromptHead ? ATTR_BOLD : (ln.kind === 'opt-desc' ? ATTR_DIM : 0))
    const padded = padRight(ln.text, innerWidth)
    screen.put(r, pickerLeft + 2, isInput ? ln.text : padded, fg, bg, attrs)
    r += 1
  }

  // Footer (always at the bottom, with a visual separator above).
  const footerRow = pickerTop + height - 2
  putLine(screen, footerRow, pickerLeft + 2, innerWidth, help, t.sidebarMuted, '', ATTR_DIM)
}

export function handleGatesKey(state: GatesModalState, key: string, actions: GatesActions): boolean {
  if (state.blockerOverlay) {
    if (key === 'escape') state.blockerOverlay = null
    return true
  }

  // Detail overlay: read full text, then act. Action keys still work in the
  // overlay (close on action). Esc closes without acting.
  if (state.detailOverlay) {
    if (key === 'escape') {
      state.detailOverlay = null
      return true
    }
    const row = state.detailOverlay
    const dispatch = (k: string): boolean => {
      switch (row.kind) {
        case 'human_gate':
          if (k === 'a') { actions.approve(row.runId); state.detailOverlay = null; return true }
          if (k === 'x') { state.detailOverlay = null; state.rejectPrompt = { reason: '' }; return true }
          break
        case 'node-fail': {
          const nodeId = typeof row.payload.nodeId === 'string' ? row.payload.nodeId : undefined
          if (k === 'r') { actions.nodeRetry(row.runId, nodeId); state.detailOverlay = null; return true }
          if (k === 's') { actions.nodeSkip(row.runId, nodeId); state.detailOverlay = null; return true }
          if (k === 'a') { actions.nodeAbort(row.runId); state.detailOverlay = null; return true }
          break
        }
        case 'reconcile-fail':
          if (k === 'r') { actions.reconcileRetry(row.runId); state.detailOverlay = null; return true }
          if (k === 'a') { actions.reconcileAbort(row.runId); state.detailOverlay = null; return true }
          break
        case 'blocker':
          if (k === 'v') {
            const blockers = scanBlockers()
            const blocker = blockers.find(b => b.runId === row.runId)
            if (blocker) state.blockerOverlay = blocker
            state.detailOverlay = null
            return true
          }
          break
      }
      return false
    }
    if (dispatch(key)) return true
    if (key === 'c') {
      state.detailOverlay = null
      state.cancelConfirm = true
      return true
    }
    if (key === 'd' && row.runDir) {
      state.detailOverlay = null
      actions.dismissBlocker(row.runDir)
      return true
    }
    return true
  }

  if (state.cancelConfirm) {
    if (key === 'y') {
      const row = state.rows[state.selectedIndex]
      state.cancelConfirm = false
      if (row) actions.cancelRun(row.runId)
    } else {
      state.cancelConfirm = false
    }
    return true
  }

  if (state.rejectPrompt) {
    if (key === 'escape') {
      state.rejectPrompt = null
    } else if (key === 'enter') {
      const reason = state.rejectPrompt.reason.trim()
      if (reason) {
        const row = state.rows[state.selectedIndex]
        state.rejectPrompt = null
        if (row) actions.reject(row.runId, reason)
      }
    } else if (key === 'backspace') {
      state.rejectPrompt.reason = state.rejectPrompt.reason.slice(0, -1)
    } else if (key.length === 1) {
      state.rejectPrompt.reason += key
    }
    return true
  }

  if (state.subPicker) {
    const picker = state.subPicker
    if (key === 'escape') {
      state.subPicker = null
    } else if (key === 'j' || key === 'down') {
      picker.index = Math.min(picker.candidates.length - 1, picker.index + 1)
    } else if (key === 'k' || key === 'up') {
      picker.index = Math.max(0, picker.index - 1)
    } else if (key === 'enter') {
      const candidate = picker.candidates[picker.index]
      const nodeId = picker.nodeId
      const row = state.rows[state.selectedIndex]
      state.subPicker = null
      if (row && candidate) actions.pickCandidate(row.runId, nodeId, candidate)
    } else if (key.length === 1) {
      const idx = key.charCodeAt(0) - 97
      if (idx >= 0 && idx < picker.candidates.length) {
        const candidate = picker.candidates[idx]
        const nodeId = picker.nodeId
        const row = state.rows[state.selectedIndex]
        state.subPicker = null
        if (row && candidate) actions.pickCandidate(row.runId, nodeId, candidate)
      }
    }
    return true
  }

  if (state.questionPicker) {
    const picker = state.questionPicker
    const opts = picker.question.options
    if (picker.typing) {
      if (key === 'escape') {
        picker.typing = null
      } else if (key === 'enter') {
        const text = picker.typing.text.trim()
        const selected = picker.question.multiSelect ? Array.from(picker.selected) : []
        dispatchAnswer(picker.runId, picker.question.id, selected, text || undefined)
        advancePickerOrClose(state)
        actions.refresh()
      } else if (key === 'backspace') {
        picker.typing.text = picker.typing.text.slice(0, -1)
      } else if (key.length === 1) {
        picker.typing.text += key
      }
      return true
    }
    if (key === 't') {
      picker.typing = { text: '' }
      return true
    }
    if (key === 'escape') {
      state.questionPicker = null
    } else if (key === 'j' || key === 'down') {
      picker.index = Math.min(opts.length - 1, picker.index + 1)
    } else if (key === 'k' || key === 'up') {
      picker.index = Math.max(0, picker.index - 1)
    } else if (key === 'space' || (key === ' ' && picker.question.multiSelect)) {
      const label = opts[picker.index]?.label
      if (label) {
        if (picker.selected.has(label)) picker.selected.delete(label)
        else picker.selected.add(label)
      }
    } else if (key === 'enter') {
      const label = opts[picker.index]?.label
      let selected: string[]
      if (picker.question.multiSelect) {
        selected = Array.from(picker.selected)
      } else {
        selected = label ? [label] : []
      }
      dispatchAnswer(picker.runId, picker.question.id, selected, undefined)
      advancePickerOrClose(state)
      actions.refresh()
    } else if (key.length === 1) {
      const idx = key.charCodeAt(0) - 97
      if (idx >= 0 && idx < opts.length) {
        if (picker.question.multiSelect) {
          picker.index = idx
        } else {
          const label = opts[idx].label
          dispatchAnswer(picker.runId, picker.question.id, [label], undefined)
          advancePickerOrClose(state)
          actions.refresh()
        }
      }
    }
    return true
  }

  if (key === 'escape') return false

  if (key === 'j' || key === 'down') {
    state.selectedIndex = Math.min(Math.max(0, state.rows.length - 1), state.selectedIndex + 1)
    return true
  }

  if (key === 'k' || key === 'up') {
    state.selectedIndex = Math.max(0, state.selectedIndex - 1)
    return true
  }

  const row = state.rows[state.selectedIndex]
  if (!row) return true

  if (key === 'd') {
    actions.dismissBlocker(row.runDir)
    return true
  }

  if (key === 'c') {
    state.cancelConfirm = true
    return true
  }

  if (key === 'v') {
    const blockers = scanBlockers()
    const blocker = blockers.find(b => b.runId === row.runId)
    if (blocker) state.blockerOverlay = blocker
    return true
  }

  // Enter on a non-question/non-candidate row opens a word-wrapped detail
  // overlay so the full reason text is readable. Action keys still work
  // from within the overlay.
  if (key === 'enter' && row.kind !== 'question' && row.kind !== 'node-candidate') {
    state.detailOverlay = row
    return true
  }

  switch (row.kind) {
    case 'human_gate':
      if (key === 'a') { actions.approve(row.runId); return true }
      if (key === 'x') { state.rejectPrompt = { reason: '' }; return true }
      break

    case 'node-fail': {
      const nodeId = typeof row.payload.nodeId === 'string' ? row.payload.nodeId : undefined
      if (key === 'r') { actions.nodeRetry(row.runId, nodeId); return true }
      if (key === 's') { actions.nodeSkip(row.runId, nodeId); return true }
      if (key === 'a') { actions.nodeAbort(row.runId); return true }
      break
    }

    case 'reconcile-fail':
      if (key === 'r') { actions.reconcileRetry(row.runId); return true }
      if (key === 'a') { actions.reconcileAbort(row.runId); return true }
      break

    case 'node-candidate':
      if (key === 'enter') {
        const candidates = Array.isArray(row.payload.options) ? row.payload.options as string[] : []
        const nodeId = typeof row.payload.nodeId === 'string' ? row.payload.nodeId : ''
        if (candidates.length > 0) {
          state.subPicker = { nodeId, candidates, index: 0 }
        }
        return true
      }
      break

    case 'question':
      if ((key === 'enter' || key === 't') && row.question && row.answerPath) {
        const isBatch = !!row.batchQuestions && !!row.batchAnswerPaths && row.batchQuestions.length > 1
        state.questionPicker = {
          question: isBatch ? row.batchQuestions![0]! : row.question,
          answerPath: isBatch ? row.batchAnswerPaths![0]! : row.answerPath,
          runId: row.runId === '_unrouted' ? '' : row.runId,
          index: 0,
          selected: new Set<string>(),
          typing: key === 't' ? { text: '' } : null,
          batch: isBatch
            ? { questions: row.batchQuestions!, answerPaths: row.batchAnswerPaths!, index: 0 }
            : undefined,
        }
        return true
      }
      if (key === 's' && row.question) {
        const r = row.runId === '_unrouted' ? '' : row.runId
        // Skip applies to whichever question is currently selected. For a
        // batch row this skips only the first question; the rest stay pending.
        dispatchAnswer(r, row.question.id, [], undefined)
        actions.refresh()
        return true
      }
      break
  }

  return true
}
