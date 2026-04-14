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
  inbox: 'j/k card | Enter expand | r reply | Esc close',
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

      // Connector: replaces the last │ on the name row
      // ├ = more siblings below, └ = last child. Root = no connector.
      const connector = isRoot ? '' : (isLast ? '└' : '├')
      const hasChildren = getChildren(agent.name).length > 0

      result.push({ agent, index: agents.indexOf(agent), continuation, connector, hasChildren })
      // Ancestry for children's subtree:
      // - Copy current ancestry
      // - If this agent is last child (└), parent's │ stops → set parent's entry to false
      // - Then push this agent's own line: !isLast (or hasChildren for root)
      const childAncestry = [...ancestry]
      if (isLast && childAncestry.length > 0) {
        childAncestry[childAncestry.length - 1] = false
      }
      const showLine = isRoot ? hasChildren : !isLast
      walk(agent.name, [...childAncestry, showLine], false)
    })
  }

  walk('orchestrator', [], true)
  for (const agent of agents) {
    if (!visited.has(agent.name)) {
      result.push({ agent, index: agents.indexOf(agent), continuation: '', connector: '', hasChildren: false })
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

  for (const { agent, index, continuation, connector, hasChildren } of ordered) {
    if (row + 4 >= top + height) break
    const selected = index === state.selectedIndex
    const notification = state.notifications[agent.name]

    const agentColor = selected ? t.sidebarSelected : statusColor(agent.status)
    const bg = selected ? t.sidebarSelectedBg : ''
    const pad = ' '
    // Name row: continuation with last │ replaced by ├ or └
    // e.g. continuation "│ │ " → namePrefix "│ ├ " (connector replaces last │)
    let namePrefix: string
    if (!connector) {
      namePrefix = continuation  // root: no connector
    } else {
      // Replace the trailing "│" of continuation with the connector char
      namePrefix = continuation.slice(0, -2) + connector + ' '
    }

    // Above-name prefix: continuation only (no connector, no extra │ for root)
    const abovePrefix = continuation

    // Below-name prefix: what shows on detail/padding rows AFTER the name
    // The last 2 chars of continuation represent THIS agent's parent level.
    // After └ (last child), parent's │ must STOP on rows below the name.
    // After ├ (not last), parent's │ continues.
    let belowPrefix: string
    if (!connector) {
      // Root: add │ if has children (starts the tree line for children)
      belowPrefix = hasChildren ? continuation + '│ ' : continuation
    } else if (connector === '└') {
      // Last child: parent's │ stops. Replace last │ with space.
      const stripped = continuation.slice(0, -2) + '  '
      // But if THIS agent has children, start a NEW │ for them
      belowPrefix = hasChildren ? stripped + '│ ' : stripped
    } else {
      // ├: parent's │ continues (already in continuation)
      belowPrefix = continuation
    }

    const innerWidth = Math.max(0, width - 2 - widthOf(namePrefix))

    // Padding row above name
    screen.put(row, left, padRight(`${pad}${abovePrefix}`, width), agentColor, bg)
    row += 1

    // Name row
    const badge = notification && !selected ? (notification === 'message' ? '● ' : '◐ ') : ''
    const dot = statusSymbol(agent.status)
    const age = formatAge(agent.spawnedAt)
    const nameText = `${badge}${dot} ${agent.name}`
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

interface InboxCard {
  from: string
  messages: AppState['inboxMessages']
}

function groupInboxCards(messages: AppState['inboxMessages']): InboxCard[] {
  const grouped = new Map<string, { from: string; messages: AppState['inboxMessages']; lastIdx: number }>()
  messages.forEach((msg, idx) => {
    const existing = grouped.get(msg.from)
    if (existing) {
      existing.messages.push(msg)
      existing.lastIdx = idx
    } else {
      grouped.set(msg.from, { from: msg.from, messages: [msg], lastIdx: idx })
    }
  })
  return Array.from(grouped.values())
    .sort((a, b) => a.lastIdx - b.lastIdx)
    .map(({ from, messages }) => ({ from, messages }))
}

const MAX_COLLAPSED_MSGS = 3
const CARD_GAP = 1

function collapsedCardHeight(msgCount: number): number {
  return 2 + Math.min(MAX_COLLAPSED_MSGS, Math.max(1, msgCount))
}

function renderInboxMsgLine(
  screen: Screen,
  row: number,
  left: number,
  width: number,
  timestamp: string,
  text: string,
  t: ReturnType<typeof getTheme>,
): void {
  if (width <= 2) return
  const innerLeft = left + 1
  const innerRight = left + width - 1
  const innerWidth = innerRight - innerLeft

  // Clear inner area
  screen.put(row, innerLeft, ' '.repeat(innerWidth), t.sidebarText)

  // Timestamp (dim)
  const ts = `[${timestamp}]`
  const tsWidth = widthOf(ts)
  if (tsWidth < innerWidth) {
    screen.put(row, innerLeft, ts, t.sidebarMuted, '', ATTR_DIM)
  }

  let col = innerLeft + tsWidth + 1
  if (col >= innerRight) return

  // Message text with inline [NAME]: coloring
  const regex = /\[([^\]]+)\]:/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  // eslint-disable-next-line no-cond-assign
  while ((match = regex.exec(text)) !== null && col < innerRight) {
    if (match.index > lastIndex) {
      const segment = text.slice(lastIndex, match.index)
      const avail = innerRight - col
      const s = truncate(segment, avail)
      if (s) { screen.put(row, col, s, t.sidebarText); col += widthOf(s) }
    }
    const avail = innerRight - col
    if (avail > 0) {
      const s = truncate(match[0], avail)
      screen.put(row, col, s, senderColor(match[1]))
      col += widthOf(s)
    }
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length && col < innerRight) {
    const avail = innerRight - col
    const s = truncate(text.slice(lastIndex), avail)
    if (s) screen.put(row, col, s, t.sidebarText)
  }
}

function renderCollapsedCard(
  screen: Screen,
  row: number,
  left: number,
  width: number,
  card: InboxCard,
  selected: boolean,
  t: ReturnType<typeof getTheme>,
): number {
  const msgsToShow = Math.min(MAX_COLLAPSED_MSGS, card.messages.length)
  const cardHeight = 2 + msgsToShow
  const color = senderColor(card.from)
  const borderColor = selected ? color : t.sidebarBorder

  // Draw box
  screen.box(row, left, width, cardHeight, 'round', borderColor)

  // Overwrite top border with sender tag: ╭─ [sender] ──╮
  if (width > 6) {
    const tag = ` [${card.from}] `
    const maxTagWidth = width - 4  // leave room for ╭─ and ─╮
    const tagStr = truncate(tag, maxTagWidth)
    screen.put(row, left + 2, tagStr, color, '', ATTR_BOLD)
    // Fill remaining top border after tag
    const afterTag = left + 2 + widthOf(tagStr)
    const remaining = left + width - 1 - afterTag
    if (remaining > 0) {
      screen.put(row, afterTag, '─'.repeat(remaining), borderColor)
    }
  }

  // Show last N messages
  const msgStart = Math.max(0, card.messages.length - msgsToShow)
  for (let i = 0; i < msgsToShow; i += 1) {
    const msgRow = row + 1 + i
    const msg = card.messages[msgStart + i]
    // Right border (left border is drawn by box)
    screen.put(msgRow, left + width - 1, '│', borderColor)
    renderInboxMsgLine(screen, msgRow, left, width, msg.timestamp, msg.text, t)
  }

  // Indicate hidden messages on first visible line if truncated
  if (card.messages.length > MAX_COLLAPSED_MSGS && width > 8) {
    const hidden = card.messages.length - MAX_COLLAPSED_MSGS
    const indicator = `+${hidden}`
    const indCol = left + width - 1 - widthOf(indicator) - 1
    if (indCol > left + widthOf(`[${card.messages[msgStart].timestamp}]`) + 3) {
      screen.put(row + 1, indCol, indicator, t.sidebarMuted, '', ATTR_DIM)
    }
  }

  return cardHeight
}

function renderFocusedCard(
  screen: Screen,
  state: AppState,
  card: InboxCard,
  bodyTop: number,
  bodyHeight: number,
  left: number,
  width: number,
  t: ReturnType<typeof getTheme>,
): void {
  const color = senderColor(card.from)

  // Draw box filling the body
  screen.box(bodyTop, left, width, bodyHeight, 'round', color)

  // Overwrite top border with sender tag
  if (width > 6) {
    const tag = ` [${card.from}] `
    const maxTagWidth = width - 4
    const tagStr = truncate(tag, maxTagWidth)
    screen.put(bodyTop, left + 2, tagStr, color, '', ATTR_BOLD)
    const afterTag = left + 2 + widthOf(tagStr)
    const remaining = left + width - 1 - afterTag
    if (remaining > 0) screen.put(bodyTop, afterTag, '─'.repeat(remaining), color)
  }

  const msgAreaHeight = Math.max(0, bodyHeight - 2)
  const msgs = card.messages
  const scroll = state.inboxCardMsgScroll
  const endIdx = Math.max(0, msgs.length - scroll)
  const startIdx = Math.max(0, endIdx - msgAreaHeight)
  const visible = msgs.slice(startIdx, endIdx)
  const offset = msgAreaHeight - visible.length  // empty rows above first message

  for (let i = 0; i < msgAreaHeight; i += 1) {
    const msgRow = bodyTop + 1 + i
    const visIdx = i - offset
    if (visIdx >= 0 && visIdx < visible.length) {
      const msg = visible[visIdx]
      screen.put(msgRow, left + width - 1, '│', color)
      renderInboxMsgLine(screen, msgRow, left, width, msg.timestamp, msg.text, t)
    } else {
      screen.put(msgRow, left + 1, ' '.repeat(Math.max(0, width - 2)), t.sidebarText)
    }
  }

  // Overwrite bottom border with scroll hint
  // scroll=0 → at newest (bottom); k goes older; scroll>0 → j goes newer
  const bottomRow = bodyTop + bodyHeight - 1
  const pos = `${endIdx}/${msgs.length}`
  const hint = scroll > 0 ? ` k older  j newer  Esc back  ${pos} ` : ` k older  Esc back  ${pos} `
  if (width > widthOf(hint) + 4) {
    screen.put(bottomRow, left + 2, truncate(hint, width - 4), t.sidebarMuted, '', ATTR_DIM)
  }
}

function renderInbox(screen: Screen, state: AppState, top: number, left: number, width: number, height: number): void {
  if (width <= 0 || height <= 0) return

  const t = getTheme()
  const lines = Math.max(1, height)
  putLine(screen, top, left, width, `Inbox (${state.inboxMessages.length})`, t.sidebarText, ATTR_BOLD)

  if (lines <= 2) return

  const bodyTop = top + 1
  const bodyHeight = Math.max(0, lines - 2)
  const footerRow = top + lines - 1

  const cards = groupInboxCards(state.inboxMessages)

  if (cards.length === 0) {
    putLine(screen, bodyTop, left, width, 'No inbox messages', t.sidebarMuted, ATTR_DIM)
    putLine(screen, footerRow, left, width, MODE_HINTS.inbox, COLORS.gray)
    return
  }

  const validSelected = clamp(state.inboxSelectedCard, 0, cards.length - 1)

  // Focused card: fills the entire body
  if (state.inboxFocusedCard) {
    renderFocusedCard(screen, state, cards[validSelected], bodyTop, bodyHeight, left, width, t)
    return
  }

  // Card list view: find visible window around selected card
  const heights = cards.map((c) => collapsedCardHeight(c.messages.length))
  let visStart = validSelected
  let visEnd = validSelected
  let totalH = heights[validSelected]

  // Expand downward (newer cards)
  for (let i = validSelected + 1; i < cards.length; i += 1) {
    const needed = heights[i] + CARD_GAP
    if (totalH + needed > bodyHeight) break
    visEnd = i
    totalH += needed
  }

  // Expand upward (older cards)
  for (let i = validSelected - 1; i >= 0; i -= 1) {
    const needed = heights[i] + CARD_GAP
    if (totalH + needed > bodyHeight) break
    visStart = i
    totalH += needed
  }

  let row = bodyTop
  for (let i = visStart; i <= visEnd; i += 1) {
    if (i > visStart) row += CARD_GAP
    const cardH = renderCollapsedCard(screen, row, left, width, cards[i], i === validSelected, t)
    row += cardH
  }

  putLine(screen, footerRow, left, width, MODE_HINTS.inbox, COLORS.gray)
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
