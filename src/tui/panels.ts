import { getKillConfirmPrompt, getModeHint } from './keybinds'
import { ATTR_BOLD, ATTR_DIM, ATTR_UNDERLINE, ATTR_INVERSE, type Screen } from './screen'
import { COLORS, fg, getTheme, modeColor, statusColor, statusSymbol } from './theme'
import type { AgentView, AppState, ModalState } from './types'
import { getAsciiLogo, getAsciiLogoWidth } from './ascii'

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
  const entryRows = height - logo.length  // reserve logo space
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
    const dot = (agent.persistent && agent.status === 'exited') ? '⟳' : statusSymbol(agent.status)
    const age = formatAge(agent.spawnedAt)
    const notifDot = notification && !selected ? ' ●' : ''
    // Collapsed indicator: show [+N] when agent has hidden children
    const collapsedSuffix = (agent.collapsedChildCount !== undefined && agent.collapsedChildCount > 0)
      ? ` [+${agent.collapsedChildCount}]`
      : ''
    const nameText = `${dot} ${agent.name}${collapsedSuffix}`
    const ageWithNotif = `${notifDot} ${age}`
    const agePad = Math.max(0, innerWidth - widthOf(nameText) - widthOf(ageWithNotif))
    const line1 = `${pad}${namePrefix}${nameText}${' '.repeat(agePad)}${ageWithNotif}${pad}`
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

  // Overflow indicator
  const hiddenBelow = ordered.length - (scrollOffset + visibleCount)
  if (hiddenBelow > 0 && row < top + height) {
    const overflowText = `  +${hiddenBelow} more`
    putLine(screen, row, left, width, overflowText, t.sidebarMuted, ATTR_DIM)
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

    // Preview text (first line only)
    if (col < left + width) {
      const previewWidth = left + width - col
      const firstLine = msg.text.split('\n')[0]
      screen.put(row, col, truncate(firstLine, previewWidth), fgText, bg)
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

function buildAnsiCarryPrefix(priorText: string): string {
  let fg = ''
  let bg = ''
  let bold = false
  let dim = false
  let italic = false
  let underline = false
  let inverse = false

  const re = /\x1b\[([0-9;]*)m/g
  let m: RegExpExecArray | null
  while ((m = re.exec(priorText)) !== null) {
    const params = (m[1] || '').split(';').filter(Boolean).map(v => Number.parseInt(v, 10))
    const values = params.length > 0 ? params : [0]
    for (let i = 0; i < values.length; i++) {
      const code = Number.isFinite(values[i]) ? values[i] : 0
      if (code === 0) {
        fg = ''; bg = ''
        bold = dim = italic = underline = inverse = false
      } else if (code === 1) bold = true
      else if (code === 2) dim = true
      else if (code === 3) italic = true
      else if (code === 4) underline = true
      else if (code === 7) inverse = true
      else if (code === 22) { bold = false; dim = false }
      else if (code === 23) italic = false
      else if (code === 24) underline = false
      else if (code === 27) inverse = false
      else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) fg = String(code)
      else if (code === 39) fg = ''
      else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) bg = String(code)
      else if (code === 49) bg = ''
      else if (code === 38 || code === 48) {
        const isFg = code === 38
        const mode = values[i + 1]
        if (mode === 5 && i + 2 < values.length) {
          const n = values[i + 2]
          if (isFg) fg = `38;5;${n}`
          else bg = `48;5;${n}`
          i += 2
        } else if (mode === 2 && i + 4 < values.length) {
          const r = values[i + 2]
          const g = values[i + 3]
          const b = values[i + 4]
          if (isFg) fg = `38;2;${r};${g};${b}`
          else bg = `48;2;${r};${g};${b}`
          i += 4
        }
      }
    }
  }

  const codes: string[] = []
  if (bold) codes.push('1')
  if (dim) codes.push('2')
  if (italic) codes.push('3')
  if (underline) codes.push('4')
  if (inverse) codes.push('7')
  if (fg) codes.push(fg)
  if (bg) codes.push(bg)
  return codes.length ? `\x1b[${codes.join(';')}m` : ''
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

  // Reconstruct style state from off-screen lines so ANSI sequences that begin
  // above the viewport still apply to visible rows (including auto-follow).
  const prior = (startIdx > 0) ? lines.slice(0, startIdx).join('\n') : ''
  const carryPrefix = prior ? buildAnsiCarryPrefix(prior) : ''

  let block = `${carryPrefix}${visible.join('\n')}`
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
    const prompt = getKillConfirmPrompt(state.killConfirmAgent)
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

  screen.put(row, col, ':', t.commandPrefix, '', ATTR_BOLD)

  const available = Math.max(0, width - 2)
  const input = state.commandInput
  const inputLen = widthOf(input)
  const leftClipped = inputLen > available

  let inputCol = col + 1
  let inputText: string
  if (leftClipped && available > 1) {
    inputText = '‹' + input.slice(-(available - 1))
  } else {
    inputText = inputLen <= available ? input : input.slice(-available)
  }
  screen.put(row, inputCol, inputText, t.commandInput)
  if (leftClipped && available > 1) {
    screen.put(row, inputCol, '‹', t.commandHint, '', ATTR_DIM)
  }

  const cursorInInput = Math.max(0, Math.min(state.commandCursor, widthOf(state.commandInput)))
  const visibleCursor = leftClipped && available > 1
    ? Math.max(1, Math.min(available, 1 + cursorInInput - Math.max(0, widthOf(state.commandInput) - (available - 1))))
    : Math.max(0, Math.min(available, cursorInInput))

  const cursorCol = inputCol + visibleCursor
  if (cursorCol < col + width) {
    screen.put(row, cursorCol, '█', t.commandPrefix)
  }
}

function renderStatusBar(screen: Screen, state: AppState, row: number, col: number, width: number): void {
  if (row < 0 || row >= screen.rows || width <= 0) return

  const t = getTheme()
  putLine(screen, row, col, width, '', t.statusText)

  const label = `[${state.mode.toUpperCase()}]`
  screen.put(row, col, label, modeColor(state.mode), '', ATTR_BOLD)

  const selected = state.agents[state.selectedIndex]
  const modeHint = getModeHint(state.mode)
  const summary = selected
    ? `${modeHint} | ${selected.name} (${state.agents.length})`
    : modeHint

  const baseCol = col + widthOf(label) + 1
  const summaryWidth = Math.max(0, width - (baseCol - col))
  if (summaryWidth > 0) {
    screen.put(row, baseCol, truncate(summary, summaryWidth), t.sidebarMuted)
  }
}

function renderCompletionPopup(screen: Screen, state: AppState, commandRow: number, sidebarWidth: number, logWidth: number): void {
  const items = state.completionItems
  if (items.length === 0 || state.mode !== 'command') return

  const maxVisible = Math.min(8, items.length)
  const popupHeight = maxVisible + 2
  const popupBottom = commandRow - 1
  const popupTop = Math.max(0, popupBottom - popupHeight + 1)
  const actualHeight = popupBottom - popupTop + 1
  if (actualHeight < 3) return

  // Compute content width
  let contentWidth = 0
  for (const item of items) {
    let w = widthOf(item.value)
    if (item.label) w += 1 + widthOf(item.label)
    if (item.description) w += 2 + Math.min(widthOf(item.description), 30)
    contentWidth = Math.max(contentWidth, w)
  }
  const popupWidth = Math.min(contentWidth + 4, Math.max(8, logWidth))
  if (popupWidth < 4) return

  const t = getTheme()

  // Anchor near command cursor, not fixed at left edge.
  const commandInputCol = 1 // after ':' at col 0
  const available = Math.max(0, screen.cols - 2)
  const inputLen = widthOf(state.commandInput)
  const cursorInInput = Math.max(0, Math.min(state.commandCursor, inputLen))
  const leftClipped = inputLen > available
  const visibleCursor = leftClipped && available > 1
    ? Math.max(1, Math.min(available, 1 + cursorInInput - Math.max(0, inputLen - (available - 1))))
    : Math.max(0, Math.min(available, cursorInInput))
  const anchorCol = commandInputCol + visibleCursor
  const minCol = 0
  const maxCol = Math.max(minCol, screen.cols - popupWidth)
  const popupLeft = clamp(anchorCol - 2, minCol, maxCol)

  // Scrolling: keep selected item visible
  const selIdx = state.completionSelectedIndex
  let scrollOffset = Math.max(0, selIdx - maxVisible + 1)
  scrollOffset = Math.min(scrollOffset, Math.max(0, items.length - maxVisible))

  // Draw box background first (fill area)
  const innerWidth = popupWidth - 2
  const innerHeight = actualHeight - 2

  // Render box border
  screen.box(popupTop, popupLeft, popupWidth, actualHeight, 'round', t.sidebarBorder)

  // Render items
  for (let i = 0; i < maxVisible && i < items.length; i++) {
    const itemIdx = scrollOffset + i
    if (itemIdx >= items.length) break
    const item = items[itemIdx]
    const row = popupTop + 1 + i
    if (row > popupBottom - 1) break

    const isSelected = itemIdx === selIdx
    const bg = isSelected ? t.sidebarSelectedBg : ''
    const fgColor = isSelected ? t.sidebarSelected : t.commandInput

    // Fill row background
    screen.put(row, popupLeft + 1, ' '.repeat(innerWidth), fgColor, bg, isSelected ? ATTR_BOLD : 0)

    // Build item text: value  label  description
    let col = popupLeft + 1
    const marker = isSelected ? '▸ ' : '  '
    screen.put(row, col, marker, fgColor, bg, isSelected ? ATTR_BOLD : 0)
    col += 2

    const valueText = truncate(item.value, innerWidth - 2)
    screen.put(row, col, valueText, fgColor, bg, isSelected ? ATTR_BOLD : 0)
    col += widthOf(valueText)

    if (item.label && col < popupLeft + popupWidth - 2) {
      const labelText = truncate(` ${item.label}`, popupLeft + popupWidth - 2 - col)
      if (widthOf(labelText) > 0) {
        screen.put(row, col, labelText, isSelected ? fgColor : t.sidebarMuted, bg, isSelected ? ATTR_BOLD : ATTR_DIM)
        col += widthOf(labelText)
      }
    }

    if (item.description && col < popupLeft + popupWidth - 2) {
      const descAvail = popupLeft + popupWidth - 2 - col - 2
      if (descAvail > 3) {
        const descText = truncate(` ${item.description}`, descAvail + 1)
        screen.put(row, col, descText, isSelected ? fgColor : t.sidebarMuted, bg, isSelected ? 0 : ATTR_DIM)
      }
    }
  }

  // Scroll indicator
  if (items.length > maxVisible) {
    const indicator = `${scrollOffset + 1}-${Math.min(scrollOffset + maxVisible, items.length)}/${items.length}`
    const indCol = popupLeft + popupWidth - 2 - widthOf(indicator)
    screen.put(popupTop, indCol, indicator, t.sidebarMuted, '', ATTR_DIM)
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

function renderModal(screen: Screen, modal: ModalState, cols: number, rows: number): void {
  const t = getTheme()

  const isForm = modal.fields.length > 0

  const maxDetailWidth = modal.listItems.reduce((m, it) => Math.max(m, widthOf(it.label) + 2 + widthOf(it.detail || '')), 0)
  const contentRows = isForm
    ? modal.fields.length + 2
    : Math.max(6, Math.min(modal.listItems.length, Math.floor(rows * 0.55)))

  const baseWidth = modal.type === 'presets' ? Math.floor(cols * 0.62) : Math.floor(cols * 0.55)
  const modalWidth = Math.min(
    cols - 4,
    Math.max(
      modal.type === 'presets' ? 58 : 40,
      Math.min(baseWidth, maxDetailWidth + 8),
    ),
  )
  const modalHeight = Math.min(rows - 2, contentRows + 6) // title + blank + error + footer + padding

  const left = Math.floor((cols - modalWidth) / 2)
  const top = Math.floor((rows - modalHeight) / 2)

  // Opaque modal body (prevents underlying pane text leakage)
  for (let r = top; r < top + modalHeight; r++) {
    screen.put(r, left, ' '.repeat(modalWidth), t.sidebarText, '')
  }

  // Modal border
  screen.box(top, left, modalWidth, modalHeight, 'double', t.sidebarBorder)

  // Title bar
  const titleText = ` ${modal.title} `
  const titlePad = Math.max(0, Math.floor((modalWidth - widthOf(titleText)) / 2))
  screen.put(top, left + titlePad, titleText, t.sidebarBorder, '', ATTR_BOLD)

  let row = top + 1

  if (isForm) {
    for (let i = 0; i < modal.fields.length; i++) {
      if (row >= top + modalHeight - 2) break
      const field = modal.fields[i]
      const active = i === modal.activeField
      const req = field.required ? '*' : ' '
      const labelStr = `${req}${field.label}: `
      const labelWidth = widthOf(labelStr)
      const valueWidth = Math.max(0, modalWidth - labelWidth - 4)

      // Clear full editable row area first
      screen.put(row, left + 1, ' '.repeat(Math.max(0, modalWidth - 2)), t.sidebarText, '')

      const labelColor = active ? t.sidebarSelected : t.sidebarText
      screen.put(row, left + 2, labelStr, labelColor, '', active ? ATTR_BOLD : 0)

      const displayValue = truncate(field.value, valueWidth)
      const paddedValue = padRight(displayValue, valueWidth)
      const valueColor = field.value ? t.sidebarText : t.sidebarMuted
      screen.put(row, left + 2 + labelWidth, paddedValue, valueColor, '', active ? ATTR_UNDERLINE : 0)

      // Cursor
      if (active) {
        const cursorOffset = Math.min(field.cursor, valueWidth)
        const cursorChar = displayValue[cursorOffset] || ' '
        screen.put(row, left + 2 + labelWidth + cursorOffset, cursorChar, t.commandPrefix, '', ATTR_BOLD | ATTR_INVERSE)
      }

      // Options hint
      if (active && field.options && field.options.length > 0) {
        const hintCol = left + 2 + labelWidth + valueWidth + 1
        const hintWidth = left + modalWidth - 2 - hintCol
        if (hintWidth > 2) {
          screen.put(row, hintCol, '↑↓', t.sidebarMuted, '', ATTR_DIM)
        }
      }

      row += 1
    }
  } else {
    const maxVisible = Math.min(modal.listItems.length, modalHeight - 5)
    const scrollOff = clamp(
      modal.selectedIndex - maxVisible + 1,
      0,
      Math.max(0, modal.listItems.length - maxVisible),
    )
    for (let i = 0; i < maxVisible; i++) {
      if (row >= top + modalHeight - 2) break
      const idx = scrollOff + i
      if (idx >= modal.listItems.length) break

      const item = modal.listItems[idx]
      const selected = idx === modal.selectedIndex
      const prefix = selected ? ' > ' : '   '
      const color = selected ? t.sidebarSelected : t.sidebarText
      const bg = selected ? t.sidebarSelectedBg : ''
      const attrs = selected ? ATTR_BOLD : 0

      const line = `${prefix}${item.label}`
      screen.put(row, left + 1, padRight(line, modalWidth - 2), color, bg, attrs)

      if (item.detail) {
        const detailCol = left + 1 + widthOf(line) + 1
        const detailWidth = modalWidth - 2 - widthOf(line) - 2
        if (detailWidth > 0) {
          screen.put(row, detailCol, truncate(item.detail, detailWidth), selected ? color : t.sidebarMuted, bg, selected ? 0 : ATTR_DIM)
        }
      }
      row += 1
    }
    // Overflow indicator
    const hidden = modal.listItems.length - (scrollOff + maxVisible)
    if (hidden > 0 && row < top + modalHeight - 2) {
      screen.put(row, left + 2, `+${hidden} more`, t.sidebarMuted, '', ATTR_DIM)
      row += 1
    }
  }

  // Error line
  row = top + modalHeight - 3
  if (row >= top + 1 && row < top + modalHeight - 1) {
    if (modal.error) {
      screen.put(row, left + 2, truncate(modal.error, modalWidth - 4), COLORS.red, '', ATTR_BOLD)
    } else {
      screen.put(row, left + 2, padRight('', modalWidth - 4), t.sidebarText, '')
    }
  }

  // Footer
  const footerRow = top + modalHeight - 2
  if (footerRow >= top && footerRow < top + modalHeight) {
    let footer: string
    if (isForm) {
      footer = 'Tab next │ Enter submit │ Esc cancel'
    } else if (modal.type === 'presets') {
      footer = '↑↓ select │ a add │ d remove │ Esc cancel'
    } else {
      footer = '↑↓ select │ Enter confirm │ Esc cancel'
    }
    screen.put(footerRow, left + 2, truncate(footer, modalWidth - 4), t.sidebarMuted, '', ATTR_DIM)
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
  renderCompletionPopup(screen, state, layout.commandRow, layout.sidebarWidth, layout.logWidth)
  renderStatusBar(screen, state, layout.statusRow, 0, cols)

  if (state.modal) {
    renderModal(screen, state.modal, cols, rows)
  }
}
