import { getCompletionHint } from './input'
import { ATTR_BOLD, ATTR_DIM, type Screen } from './screen'
import { COLORS, fg, getTheme, modeColor, statusColor, statusSymbol } from './theme'
import type { AgentView, AppState, Mode } from './types'
import { getAsciiLogo, getAsciiLogoWidth } from './ascii'

const MODE_HINTS: Record<Mode, string> = {
  normal: 'j/k select | Enter focus | r reply | m inbox | t shell | K kill | : cmd | q quit',
  'log-focus': 'j/k scroll | i insert | Ctrl-d/u page | G/g bottom/top | Esc back',
  insert: 'typing to agent | Ctrl-c interrupt | Esc exit',
  command: 'Enter execute | Tab complete | Esc cancel',
  inbox: 'j/k select | r reply | d delete | D clear all | Esc close',
  presets: ': cmd | Esc close',
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
  hasChildren: boolean  // does this agent have children in the tree?
}

/** Build tree-ordered list with continuation lines and connectors */
export function treeOrder(agents: AgentView[]): TreeEntry[] {
  const byName = new Map(agents.map(a => [a.name, a]))
  const result: TreeEntry[] = []
  const visited = new Set<string>()

  function getChildren(parentName: string): AgentView[] {
    return agents.filter(a => !visited.has(a.name) && (
      a.parentName === parentName ||
      (parentName === 'human' && !byName.has(a.parentName))
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

      // Connector: replaces the last │ on the name row
      // ├ = more siblings below, └ = last child. Root = no connector.
      const connector = isRoot ? '' : (isLast ? '└' : '├')
      const hasChildren = getChildren(agent.name).length > 0

      result.push({ agent, index: agents.indexOf(agent), continuation, connector, hasChildren })
      const childAncestry = [...ancestry]
      if (isLast && childAncestry.length > 0) {
        childAncestry[childAncestry.length - 1] = false
      }
      const showLine = isRoot ? hasChildren : !isLast
      walk(agent.name, [...childAncestry, showLine], false)
    })
  }

  walk('human', [], true)
  for (const agent of agents) {
    if (!visited.has(agent.name)) {
      result.push({ agent, index: agents.indexOf(agent), continuation: '', connector: '', hasChildren: false })
    }
  }

  return result
}

function renderSidebar(screen: Screen, state: AppState, top: number, left: number, width: number, height: number, ordered: TreeEntry[]): void {
  if (width <= 0 || height <= 0) return

  let row = top
  const t = getTheme()
  putLine(screen, row, left, width, `Agents (${state.agents.length})`, t.sidebarTitle, ATTR_BOLD)
  row += 2  // blank line after header

  if (state.agents.length === 0) {
    putLine(screen, row, left, width, 'No agents running.', t.sidebarMuted, ATTR_DIM)
    row += 1
    putLine(screen, row, left, width, '', t.sidebarMuted, ATTR_DIM)
    row += 1
    putLine(screen, row, left, width, 'Press : then type', t.sidebarMuted, ATTR_DIM)
    row += 1
    putLine(screen, row, left, width, 'spawn <name> -p default', t.sidebarMuted, ATTR_DIM)
    return
  }

  // Compute how many entries fit while reserving space for the ASCII logo
  const logo = getAsciiLogo(width)
  const entryRows = height - 2 - logo.length  // -2 for header+blank, reserve logo space
  const visibleCount = Math.max(1, Math.floor(entryRows / 5))
  const scrollOffset = clamp(state.sidebarScrollOffset, 0, Math.max(0, ordered.length - visibleCount))
  const visibleEntries = ordered.slice(scrollOffset, scrollOffset + visibleCount)

  for (const { agent, index, continuation, connector, hasChildren } of visibleEntries) {
    if (row + 4 >= top + height) break
    const selected = index === state.selectedIndex
    const notification = state.notifications[agent.name]

    const agentColor = selected ? t.sidebarSelected : statusColor(agent.status)
    const bg = selected ? t.sidebarSelectedBg : ''
    const pad = ' '
    // Name row: continuation with last │ replaced by ├ or └
    let namePrefix: string
    if (!connector) {
      namePrefix = continuation  // root: no connector
    } else {
      namePrefix = continuation.slice(0, -2) + connector + ' '
    }

    // Above-name prefix: continuation only
    const abovePrefix = continuation

    // Below-name prefix
    let belowPrefix: string
    if (!connector) {
      belowPrefix = hasChildren ? continuation + '│ ' : continuation
    } else if (connector === '└') {
      const stripped = continuation.slice(0, -2) + '  '
      belowPrefix = hasChildren ? stripped + '│ ' : stripped
    } else {
      belowPrefix = continuation
    }

    const innerWidth = Math.max(0, width - 2 - widthOf(namePrefix))

    // Padding row above name
    screen.put(row, left, padRight(`${pad}${abovePrefix}`, width), agentColor, bg)
    row += 1

    // Name row
    const badge = notification && !selected ? (notification === 'message' ? '● ' : '◐ ') : ''
    // Persistent dead agents show ⟳ (respawning indicator) instead of ○ (exited)
    const dot = (agent.persistent && agent.status === 'exited') ? '⟳' : statusSymbol(agent.status)
    const persistentBadge = agent.persistent ? 'P ' : ''
    const age = formatAge(agent.spawnedAt)
    // Collapsed indicator: show [+N] when agent has hidden children
    const collapsedSuffix = (agent.collapsedChildCount !== undefined && agent.collapsedChildCount > 0)
      ? ` [+${agent.collapsedChildCount}]`
      : ''
    const nameText = `${badge}${persistentBadge}${dot} ${agent.name}${collapsedSuffix}`
    const agePad = Math.max(0, innerWidth - widthOf(nameText) - widthOf(age))
    const line1 = `${pad}${namePrefix}${nameText}${' '.repeat(agePad)}${age}${pad}`
    screen.put(row, left, padRight(line1, width), agentColor, bg, ATTR_BOLD)
    row += 1

    // Detail: cli/model
    const line2 = `${pad}${belowPrefix}  ${agent.cli}/${agent.model}`
    screen.put(row, left, padRight(line2, width), agentColor, bg)
    row += 1

    // Detail: dir
    const line3 = `${pad}${belowPrefix}  ${shortenPath(agent.dir)}`
    screen.put(row, left, padRight(line3, width), agentColor, bg)
    row += 1

    // Padding row below
    screen.put(row, left, padRight(`${pad}${belowPrefix}`, width), agentColor, bg)
    row += 1
  }

  // ASCII banner at the bottom of the sidebar
  const bannerSpace = (top + height) - row
  if (bannerSpace >= logo.length) {
    const bannerStart = top + height - logo.length
    for (let i = 0; i < logo.length; i++) {
      const line = logo[i]
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

  const logo = getAsciiLogo(width)
  const startRow = top + Math.max(0, Math.floor((height - logo.length) / 2))
  for (let i = 0; i < logo.length; i += 1) {
    const row = startRow + i
    if (row >= top + height) break
    const line = logo[i]
    const lineWidth = widthOf(line)
    const col = left + Math.max(0, Math.floor((width - lineWidth) / 2))
    screen.put(row, col, truncate(line, width), getTheme().bannerText, '', ATTR_BOLD)
  }
}

// ─── Inbox rendering helpers ─────────────────────────────────────

const SENDER_PALETTE = [
  COLORS.cyan,
  COLORS.green,
  COLORS.yellow,
  COLORS.magenta,
  COLORS.brightBlue,
  COLORS.brightGreen,
  COLORS.brightYellow,
  COLORS.brightMagenta,
  COLORS.brightCyan,
  COLORS.brightRed,
]

function hashSender(name: string): number {
  let h = 0
  for (const c of name) h = ((h * 31) + c.charCodeAt(0)) & 0xffff
  return h
}

function senderColor(name: string): string {
  return SENDER_PALETTE[hashSender(name) % SENDER_PALETTE.length]
}

function wordWrap(text: string, width: number): string[] {
  if (width <= 0) return []
  const lines: string[] = []
  for (const para of text.split('\n')) {
    if (!para) { lines.push(''); continue }
    const words = para.split(' ')
    let current = ''
    for (const word of words) {
      if (!current) {
        current = word
      } else if (widthOf(current) + 1 + widthOf(word) <= width) {
        current += ' ' + word
      } else {
        lines.push(current)
        current = word
      }
    }
    if (current) lines.push(current)
  }
  return lines.length > 0 ? lines : ['']
}

function renderInbox(screen: Screen, state: AppState, top: number, left: number, width: number, height: number): void {
  if (width <= 0 || height <= 0) return

  const t = getTheme()
  const msgs = state.inboxMessages

  // Header
  putLine(screen, top, left, width, `Inbox (${msgs.length})`, t.sidebarText, ATTR_BOLD)
  if (height <= 1) return

  if (msgs.length === 0) {
    putLine(screen, top + 1, left, width, 'No inbox messages', t.sidebarMuted, ATTR_DIM)
    return
  }

  // Split remaining height: list | separator | detail
  const available = height - 1
  const listHeight = Math.max(2, Math.floor(available * 0.35))
  const detailHeight = Math.max(0, available - listHeight - 1)  // -1 for separator

  const listTop = top + 1
  const separatorRow = listTop + listHeight
  const detailTop = separatorRow + 1

  const selIdx = clamp(state.inboxSelectedMsg, 0, msgs.length - 1)

  // Message list — keep selected visible, scroll up when needed
  const startIdx = clamp(selIdx - listHeight + 1, 0, Math.max(0, msgs.length - listHeight))

  for (let i = 0; i < listHeight; i++) {
    const msgIdx = startIdx + i
    const row = listTop + i
    if (row >= top + height) break

    if (msgIdx >= msgs.length) {
      screen.put(row, left, ' '.repeat(width), t.sidebarText, '')
      continue
    }

    const msg = msgs[msgIdx]
    const isSelected = msgIdx === selIdx
    const bg = isSelected ? t.sidebarSelectedBg : ''
    const color = senderColor(msg.from)
    const fgText = isSelected ? t.sidebarSelected : t.sidebarText

    // Fill row background
    screen.put(row, left, ' '.repeat(width), fgText, bg)

    // Timestamp (dim)
    const ts = msg.timestamp
    const tsWidth = widthOf(ts)
    screen.put(row, left, ts, t.sidebarMuted, bg, ATTR_DIM)

    // Sender tag (colored, bold)
    let col = left + tsWidth + 1
    if (col < left + width) {
      const senderTag = `[${msg.from}]`
      const senderWidth = widthOf(senderTag)
      screen.put(row, col, senderTag, color, bg, ATTR_BOLD)
      col += senderWidth + 1
    }

    // Preview text
    if (col < left + width) {
      const previewWidth = left + width - col
      screen.put(row, col, truncate(msg.text, previewWidth), fgText, bg)
    }
  }

  // Separator
  if (separatorRow < top + height) {
    screen.put(separatorRow, left, '─'.repeat(width), t.sidebarBorder, '')
  }

  // Detail pane — selected message in full with word wrap
  if (detailTop < top + height && detailHeight > 0) {
    const msg = msgs[selIdx]
    let row = detailTop

    // Header: [SENDER] timestamp
    if (row < top + height) {
      screen.put(row, left, ' '.repeat(width), t.sidebarText, '')
      const senderTag = `[${msg.from}]`
      screen.put(row, left, senderTag, senderColor(msg.from), '', ATTR_BOLD)
      screen.put(row, left + widthOf(senderTag) + 1, msg.timestamp, t.sidebarMuted, '', ATTR_DIM)
      row++
    }

    // Word-wrapped message body
    const wrappedLines = wordWrap(msg.text, width)
    for (const line of wrappedLines) {
      if (row >= top + height) break
      putLine(screen, row, left, width, line, t.sidebarText)
      row++
    }

    // Clear remaining detail rows
    while (row < top + height) {
      putLine(screen, row, left, width, '', t.sidebarText)
      row++
    }
  }
}

function renderLogPane(screen: Screen, state: AppState, top: number, left: number, width: number, height: number): void {
  if (width <= 0 || height <= 0) return

  if (state.mode === 'inbox') {
    renderInbox(screen, state, top, left, width, height)
    return
  }

  if (state.mode === 'presets') {
    const lines = state.logContent.split('\n')
    const viewableLines = Math.max(1, height)
    const maxStart = Math.max(0, lines.length - viewableLines)
    const startIdx = clamp(state.logScrollOffset, 0, maxStart)
    const visible = lines.slice(startIdx, startIdx + viewableLines)
    screen.putAnsi(top, left, width, viewableLines, visible.join('\n'))
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

export function calculateLayout(cols: number, rows: number, agents?: AgentView[], precomputedOrder?: TreeEntry[]): LayoutMetrics {
  const safeCols = Math.max(1, cols)
  const safeRows = Math.max(1, rows)

  const statusHeight = Math.min(2, safeRows)
  const contentHeight = Math.max(0, safeRows - statusHeight)

  // Dynamic sidebar width based on content
  const bannerMaxWidth = getAsciiLogoWidth()
  const minLogWidth = 24
  let contentWidth = bannerMaxWidth

  if (agents && agents.length > 0) {
    const ordered = precomputedOrder ?? treeOrder(agents)
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
  const ordered = treeOrder(state.agents)
  const layout = calculateLayout(cols, rows, state.agents, ordered)

  screen.clear(0, 0, cols, rows)

  const t = getTheme()

  if (layout.contentHeight > 0) {
    screen.box(0, 0, layout.sidebarWidth, layout.contentHeight, 'round', t.sidebarBorder)
    renderSidebar(screen, state, 1, 1, layout.sidebarInnerWidth, layout.sidebarInnerHeight, ordered)

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
