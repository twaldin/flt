import { getCompletionHint } from './input'
import { ATTR_BOLD, ATTR_DIM, type Screen } from './screen'
import { COLORS, fg, getTheme, modeColor, statusColor, statusSymbol } from './theme'
import type { AgentView, AppState, Mode } from './types'

const FLT_BANNER = [
  '    ██████  ████   █████   ',
  '   ███░░███░░███  ░░███    ',
  '  ░███ ░░░  ░███  ███████  ',
  ' ███████    ░███ ░░░███░   ',
  '░░░███░     ░███   ░███    ',
  '  ░███      ░███   ░███ ███',
  '  █████     █████  ░░█████ ',
  ' ░░░░░     ░░░░░    ░░░░░  ',
]

const MODE_HINTS: Record<Mode, string> = {
  normal: 'j/k select | Enter focus | r reply | m inbox | t shell | K kill | : cmd | q quit',
  'log-focus': 'j/k scroll | i insert | Ctrl-d/u page | G/g bottom/top | Esc back',
  insert: 'typing to selected agent | Esc exit insert mode',
  command: 'Enter execute | Tab complete | Esc cancel',
  inbox: 'r reply to last sender | Esc close',
  'kill-confirm': 'y confirm | n cancel | Esc cancel',
  shell: 'typing in shell | Esc close',
}

export interface LayoutMetrics {
  sidebarWidth: number
  logWidth: number
  contentHeight: number
  statusHeight: number
  bannerHeight: number
  logTop: number
  logHeight: number
  sidebarInnerWidth: number
  sidebarInnerHeight: number
  bannerInnerWidth: number
  bannerInnerHeight: number
  logInnerWidth: number
  logInnerHeight: number
  commandRow: number
  statusRow: number
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
  const pad = Math.max(0, width - widthOf(clipped))
  return `${clipped}${' '.repeat(pad)}`
}

function putLine(screen: Screen, row: number, col: number, width: number, text: string, fgColor = '', attrs = 0): void {
  if (width <= 0 || row < 0 || row >= screen.rows) return
  screen.put(row, col, padRight(text, width), fgColor, '', attrs)
}

function formatAge(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime()
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

function shortenPath(path: string): string {
  const home = process.env.HOME || ''
  if (home && path.startsWith(home)) return `~${path.slice(home.length)}`

  if (path.includes('/T/flt-wt-')) {
    const match = path.match(/flt-wt-(.+)$/)
    if (match) return `wt:${match[1]}`
  }

  return path
}

interface TreeEntry {
  agent: AgentView
  index: number
  continuation: string  // "│ │ " — vertical lines from ancestors, applies to ALL rows
  connector: string     // "├ " or "└ " — only on name row, empty for root agents
}

/** Build tree-ordered list with continuation lines and connectors */
function treeOrder(agents: AgentView[]): TreeEntry[] {
  const byName = new Map(agents.map(a => [a.name, a]))
  const result: TreeEntry[] = []
  const visited = new Set<string>()

  function getChildren(parentName: string): AgentView[] {
    return agents.filter(a => !visited.has(a.name) && (
      a.parentName === parentName ||
      (parentName === 'orchestrator' && !byName.has(a.parentName))
    ))
  }

  function walk(parentName: string, ancestry: boolean[], isRoot: boolean): void {
    const children = getChildren(parentName)
    children.forEach((agent, i) => {
      visited.add(agent.name)
      const isLast = i === children.length - 1

      // Continuation: vertical lines from ancestors (shown on ALL 5 rows)
      let continuation = ''
      for (const continues of ancestry) {
        continuation += continues ? '│ ' : '  '
      }

      // Connector: only on name row, empty for root-level agents
      const connector = isRoot ? '' : (isLast ? '└ ' : '├ ')

      result.push({ agent, index: agents.indexOf(agent), continuation, connector })
      walk(agent.name, [...ancestry, !isLast], false)
    })
  }

  walk('orchestrator', [], true)
  for (const agent of agents) {
    if (!visited.has(agent.name)) {
      result.push({ agent, index: agents.indexOf(agent), continuation: '', connector: '' })
    }
  }

  return result
}

function renderSidebar(screen: Screen, state: AppState, top: number, left: number, width: number, height: number): void {
  if (width <= 0 || height <= 0) return

  let row = top
  const t = getTheme()
  putLine(screen, row, left, width, `Agents (${state.agents.length})`, t.sidebarTitle, ATTR_BOLD)
  row += 2  // blank line after header

  if (state.agents.length === 0) {
    putLine(screen, row, left, width, 'No agents', t.sidebarMuted, ATTR_DIM)
    return
  }

  const ordered = treeOrder(state.agents)

  for (const { agent, index, continuation, connector } of ordered) {
    if (row + 4 >= top + height) break
    const selected = index === state.selectedIndex
    const notification = state.notifications[agent.name]

    const agentColor = selected ? t.sidebarSelected : statusColor(agent.status)
    const bg = selected ? t.sidebarSelectedBg : ''
    const pad = ' '
    const fullPrefix = continuation + connector
    const contIndent = continuation + '  '  // continuation + space past connector
    const innerWidth = Math.max(0, width - 2 - widthOf(fullPrefix))

    // Padding row: continuation lines extend through
    screen.put(row, left, padRight(`${pad}${contIndent}`, width), agentColor, bg)
    row += 1

    // Name row: continuation + connector + status dot + name ... age
    const badge = notification && !selected ? (notification === 'message' ? '● ' : '◐ ') : ''
    const dot = statusSymbol(agent.status)
    const age = formatAge(agent.spawnedAt)
    const nameText = `${badge}${dot} ${agent.name}`
    const agePad = Math.max(0, innerWidth - widthOf(nameText) - widthOf(age))
    const line1 = `${pad}${fullPrefix}${nameText}${' '.repeat(agePad)}${age}${pad}`
    screen.put(row, left, padRight(line1, width), agentColor, bg, ATTR_BOLD)
    row += 1

    // Detail: cli/model — continuation lines extend, indented past connector
    const line2 = `${pad}${contIndent}  ${agent.cli}/${agent.model}`
    screen.put(row, left, padRight(line2, width), agentColor, bg)
    row += 1

    // Detail: dir
    const line3 = `${pad}${contIndent}  ${shortenPath(agent.dir)}`
    screen.put(row, left, padRight(line3, width), agentColor, bg)
    row += 1

    // Padding row: continuation lines extend through
    screen.put(row, left, padRight(`${pad}${contIndent}`, width), agentColor, bg)
    row += 1
  }

  // ASCII banner at the bottom of the sidebar
  const bannerSpace = (top + height) - row
  if (bannerSpace >= FLT_BANNER.length) {
    const bannerStart = top + height - FLT_BANNER.length
    for (let i = 0; i < FLT_BANNER.length; i++) {
      const line = FLT_BANNER[i]
      const lineWidth = widthOf(line)
      const col = left + Math.max(0, Math.floor((width - lineWidth) / 2))
      const bannerRow = bannerStart + i
      if (bannerRow < top + height) {
        screen.put(bannerRow, col, truncate(line, width), t.sidebarBorder, '', ATTR_DIM)
      }
    }
  }
}

function renderBanner(screen: Screen, state: AppState, top: number, left: number, width: number, height: number): void {
  if (width <= 0 || height <= 0) return

  const startRow = top + Math.max(0, Math.floor((height - FLT_BANNER.length) / 2))
  for (let i = 0; i < FLT_BANNER.length; i += 1) {
    const row = startRow + i
    if (row >= top + height) break
    const line = FLT_BANNER[i]
    const lineWidth = widthOf(line)
    const col = left + Math.max(0, Math.floor((width - lineWidth) / 2))
    screen.put(row, col, truncate(line, width), getTheme().bannerText, '', ATTR_BOLD)
  }

}

function renderInbox(screen: Screen, state: AppState, top: number, left: number, width: number, height: number): void {
  if (width <= 0 || height <= 0) return

  const lines = Math.max(1, height)
  putLine(screen, top, left, width, `Inbox (${state.inboxMessages.length})`, getTheme().sidebarSelected, ATTR_BOLD)

  const usable = Math.max(0, lines - 2)
  const recent = state.inboxMessages.slice(-usable)

  for (let i = 0; i < usable; i += 1) {
    const row = top + 1 + i
    const msg = recent[i]
    if (!msg) {
      putLine(screen, row, left, width, '', COLORS.gray)
      continue
    }
    const line = `[${msg.timestamp}] ${msg.from}: ${msg.text}`
    putLine(screen, row, left, width, line, COLORS.gray)
  }

  if (lines >= 2) {
    putLine(screen, top + lines - 1, left, width, '[r] reply to last sender', COLORS.gray)
  }
}

function renderLogPane(screen: Screen, state: AppState, top: number, left: number, width: number, height: number): void {
  if (width <= 0 || height <= 0) return

  if (state.mode === 'inbox') {
    renderInbox(screen, state, top, left, width, height)
    return
  }

  const selected = state.agents[state.selectedIndex]
  if (!selected) {
    putLine(screen, top, left, width, 'No agent selected', getTheme().sidebarMuted)
    return
  }

  const lines = state.logContent.split('\n')
  const viewableLines = Math.max(1, height)

  const maxStart = Math.max(0, lines.length - viewableLines)
  const startIdx = clamp(state.logScrollOffset, 0, maxStart)
  const visible = lines.slice(startIdx, startIdx + viewableLines)

  let block = visible.join('\n')
  if (state.searchQuery) {
    const escaped = state.searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`(${escaped})`, 'gi')
    block = block.replace(regex, '\\x1b[43;30m$1\\x1b[0m')
  }

  screen.putAnsi(top, left, width, viewableLines, block)
}

function renderCommandBar(screen: Screen, state: AppState, row: number, col: number, width: number): void {
  if (row < 0 || row >= screen.rows || width <= 0) return

  putLine(screen, row, col, width, '', COLORS.default)

  const t = getTheme()
  if (state.mode === 'kill-confirm') {
    const prompt = `Kill ${state.killConfirmAgent}? [y/n]`
    screen.put(row, col, prompt, t.statusMode['kill-confirm'], '', ATTR_BOLD)
    return
  }

  if (state.mode !== 'command') {
    if (state.banner) {
      const bannerText = truncate(state.banner.text, width)
      putLine(screen, row, col, width, bannerText, fg(state.banner.color), ATTR_BOLD)
    } else {
      putLine(screen, row, col, width, ':command...', t.commandHint, ATTR_DIM)
    }
    return
  }

  const { hint, multiHint } = getCompletionHint(
    state.commandInput,
    state.agents.map((a) => a.name),
    Array.from(new Set(state.agents.map((a) => a.cli))),
  )

  screen.put(row, col, ':', t.commandPrefix, '', ATTR_BOLD)

  const available = Math.max(0, width - 2)
  // Scroll input: show the tail when text exceeds available width
  const input = state.commandInput
  const inputLen = widthOf(input)
  const inputVisible = inputLen <= available
    ? input
    : input.slice(inputLen - available)
  screen.put(row, col + 1, inputVisible, t.commandInput)

  const cursorCol = col + 1 + Math.min(widthOf(inputVisible), available)
  if (cursorCol < col + width) {
    screen.put(row, cursorCol, '█', t.commandPrefix)
  }

  const hintText = hint || multiHint
  if (hintText) {
    const hintCol = cursorCol + 1
    const hintWidth = col + width - hintCol
    if (hintWidth > 0) {
      screen.put(row, hintCol, truncate(hintText, hintWidth), t.commandHint)
    }
  }
}

function renderStatusBar(screen: Screen, state: AppState, row: number, col: number, width: number): void {
  if (row < 0 || row >= screen.rows || width <= 0) return

  const t = getTheme()
  putLine(screen, row, col, width, '', t.statusText)

  const label = `[${state.mode.toUpperCase()}]`
  screen.put(row, col, label, modeColor(state.mode), '', ATTR_BOLD)

  const selected = state.agents[state.selectedIndex]
  const summary = selected
    ? `${MODE_HINTS[state.mode]} | ${selected.name} (${state.agents.length})`
    : MODE_HINTS[state.mode]

  const baseCol = col + widthOf(label) + 1
  const summaryWidth = Math.max(0, width - (baseCol - col))
  if (summaryWidth > 0) {
    screen.put(row, baseCol, truncate(summary, summaryWidth), t.sidebarMuted)
  }
}

export function calculateLayout(cols: number, rows: number, agents?: AgentView[]): LayoutMetrics {
  const safeCols = Math.max(1, cols)
  const safeRows = Math.max(1, rows)

  const statusHeight = Math.min(2, safeRows)
  const contentHeight = Math.max(0, safeRows - statusHeight)

  // Dynamic sidebar width based on content
  const bannerMaxWidth = 27  // widest FLT_BANNER line
  const minLogWidth = 24
  let contentWidth = bannerMaxWidth

  if (agents && agents.length > 0) {
    const ordered = treeOrder(agents)
    for (const { agent, continuation, connector } of ordered) {
      const pLen = (continuation + connector).length
      const dLen = continuation.length + 4  // continuation + "    " detail indent
      contentWidth = Math.max(contentWidth, pLen + 2 + agent.name.length + 4 + 3)
      contentWidth = Math.max(contentWidth, dLen + agent.cli.length + 1 + agent.model.length)
      contentWidth = Math.max(contentWidth, dLen + shortenPath(agent.dir).length)
    }
  }

  // +2 for box borders, +2 for horizontal padding inside agent entries
  let sidebarWidth = contentWidth + 4
  sidebarWidth = clamp(sidebarWidth, 18, Math.max(18, safeCols - minLogWidth))
  if (safeCols - sidebarWidth < 1) sidebarWidth = Math.max(1, safeCols - 1)

  const logWidth = Math.max(1, safeCols - sidebarWidth)

  const logTop = 0
  const logHeight = contentHeight

  return {
    sidebarWidth,
    logWidth,
    contentHeight,
    statusHeight,
    bannerHeight: 0,
    logTop,
    logHeight,
    sidebarInnerWidth: Math.max(0, sidebarWidth - 2),
    sidebarInnerHeight: Math.max(0, contentHeight - 2),
    bannerInnerWidth: 0,
    bannerInnerHeight: 0,
    logInnerWidth: Math.max(0, logWidth - 2),
    logInnerHeight: Math.max(0, contentHeight - 2),
    commandRow: safeRows - 2,
    statusRow: safeRows - 1,
  }
}

export function renderLayout(screen: Screen, state: AppState): void {
  const cols = screen.cols
  const rows = screen.rows
  const layout = calculateLayout(cols, rows, state.agents)

  screen.clear(0, 0, cols, rows)

  const t = getTheme()

  if (layout.contentHeight > 0) {
    screen.box(0, 0, layout.sidebarWidth, layout.contentHeight, 'round', t.sidebarBorder)
    renderSidebar(screen, state, 1, 1, layout.sidebarInnerWidth, layout.sidebarInnerHeight)

    if (layout.logHeight > 0) {
      // Log border color matches the mode indicator color
      const borderColor = state.mode === 'normal' || state.mode === 'kill-confirm'
        ? t.logBorder
        : modeColor(state.mode)
      screen.box(
        layout.logTop,
        layout.sidebarWidth,
        layout.logWidth,
        layout.logHeight,
        state.mode === 'log-focus' ? 'double' : 'round',
        borderColor,
      )
      renderLogPane(
        screen,
        state,
        layout.logTop + 1,
        layout.sidebarWidth + 1,
        layout.logInnerWidth,
        layout.logInnerHeight,
      )
    }
  }

  renderCommandBar(screen, state, layout.commandRow, 0, cols)
  renderStatusBar(screen, state, layout.statusRow, 0, cols)
}
