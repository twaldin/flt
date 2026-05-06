import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { listAdapters } from '../adapters/registry'
import { kill } from '../commands/kill'
import { formatPresetList, presetsAdd, presetsRemove } from '../commands/presets'
import { send } from '../commands/send'
import { spawn } from '../commands/spawn'
import { listPresets } from '../presets'
import { allAgents, type AgentState } from '../state'
import { capturePane, capturePaneVisible, flushBatchedKeys, hasSession, refreshCurrentTmuxWindow, resizeWindow, restoreCurrentTmuxWindowSize, sendKeysAsync, sendLiteralBatched } from '../tmux'
import { getInboxPath } from '../commands/init'
import { parseCommand, enrichMessageWithFiles } from './command-parser'
import { setupInput, getCompletionItems, type InputBindings, type TmuxInsertKey } from './input'
import { getKeybindsBanner } from './keybinds'
import { calculateLayout, renderLayout } from './panels'
import { Screen } from './screen'
import { getWorkflowHistory, type WorkflowFilter } from '../metrics-workflows'
import { initialWorkflowModalState, loadWorkflowRows } from './modal-workflows'
import { initialGatesModalState, openGatesWatcher, closeGatesWatcher, handleGatesKey, loadAllRows, type GatesActions } from './modal-gates'
import { workflowApprove, workflowReject, workflowNodeDecision, workflowReconcileDecision, workflowCancel } from '../commands/workflow'
import { scanGates, cleanStaleGates } from '../gates'
import { getCurrentThemeName, getThemeBackground, getThemeNames, setTheme } from './theme'
import { getAsciiLogo } from './ascii'
import { invalidateMetricsModalCache } from './metrics-modal'
import { createInitialState, type AgentView, type AppState, type GroupBy, type InboxMessage, type MetricsModalState, type Mode, type ModalState, type ModalListItem, type Period } from './types'

/** Strip OSC 8 hyperlink sequences, keeping the display text */
function stripOsc8(s: string): string {
  // OSC 8: \x1b]8;params;uri\x07  or  \x1b]8;params;uri\x1b\\
  return s.replace(/\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
}

/** Count all descendants of an agent in the full (unfiltered) agents list */
function countDescendants(name: string, agents: AgentView[]): number {
  let count = 0
  for (const a of agents) {
    if (a.parentName === name) {
      count++
      count += countDescendants(a.name, agents)
    }
  }
  return count
}

/**
 * Sort agents into tree order (parent before children) so array index matches display.
 * Agents whose parent is in collapsedSet are excluded from the result.
 * Collapsed agents gain a collapsedChildCount field showing how many descendants are hidden.
 */
function sortTreeOrder(agents: AgentView[], collapsedSet: Set<string> = new Set()): AgentView[] {
  const byName = new Map(agents.map(a => [a.name, a]))
  const result: AgentView[] = []
  const visited = new Set<string>()

  function markDescendants(name: string): void {
    for (const a of agents) {
      if (!visited.has(a.name) && a.parentName === name) {
        visited.add(a.name)
        markDescendants(a.name)
      }
    }
  }

  function walk(parentName: string): void {
    for (const agent of agents) {
      if (visited.has(agent.name)) continue
      if (agent.parentName === parentName || (parentName === 'human' && !byName.has(agent.parentName))) {
        visited.add(agent.name)
        if (collapsedSet.has(agent.name)) {
          const childCount = countDescendants(agent.name, agents)
          result.push({ ...agent, collapsedChildCount: childCount })
          markDescendants(agent.name)
        } else {
          result.push({ ...agent, collapsedChildCount: undefined })
          walk(agent.name)
        }
      }
    }
  }

  walk('human')
  // Append any orphans not yet visited
  for (const agent of agents) {
    if (!visited.has(agent.name)) result.push(agent)
  }
  return result
}

function parseInbox(content: string): InboxMessage[] {
  const messages: InboxMessage[] = []
  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    // New format: [timestamp] [SENDER]: message (timestamp may contain spaces like "5:11:29 PM")
    const tagMatch = line.match(/^\[([^\]]+)\]\s+\[([^\]]+)\]:\s+(.+)$/)
    if (tagMatch) {
      messages.push({ timestamp: tagMatch[1], from: tagMatch[2], text: tagMatch[3].replace(/\\n/g, '\n') })
      continue
    }
    // Legacy format: [timestamp] sender: message
    const legacyMatch = line.match(/^\[([^\]]+)\]\s+(\S+):\s+(.+)$/)
    if (legacyMatch) {
      messages.push({ timestamp: legacyMatch[1], from: legacyMatch[2], text: legacyMatch[3].replace(/\\n/g, '\n') })
    }
  }
  return messages
}

function agentsHash(agents: AgentView[]): string {
  return agents.map((a) => `${a.name}:${a.status}:${a.cli}:${a.model}`).join('|')
}

export class App {
  screen: Screen
  state: AppState

  private pollTimer: ReturnType<typeof setInterval> | null = null
  private cleanupInput: (() => void) | null = null

  private shellSession = 'flt-shell'
  private shellContent = ''
  private lastAgentsHash = ''
  private lastLogContent = ''
  private paneCache: Record<string, string> = {}  // cached pane content per agent
  private lastInboxRaw = ''
  private lastSelectedName: string | undefined
  private lastStatusByAgent: Record<string, string> = {}
  private lastResizedDims: Record<string, { width: number; height: number; spawnedAt: string }> = {}
  private priorTmuxWindowSize: string | null = null
  // Status detection moved to controller poller — these are no longer needed
  private bannerTimer: ReturnType<typeof setTimeout> | null = null
  private insertCaptureTimer: ReturnType<typeof setTimeout> | null = null
  private running = false

  // Frame scheduler
  private renderPending = false
  private renderFlushId: ReturnType<typeof setImmediate> | null = null

  // Burst detection
  private lastActivity = 0
  private burstTimeout: ReturnType<typeof setTimeout> | null = null

  constructor() {
    const cols = process.stdout.columns ?? 80
    const rows = process.stdout.rows ?? 24
    this.screen = new Screen(cols, rows)
    this.screen.setDefaultBg(getThemeBackground())
    this.state = createInitialState(cols, rows)
  }

  start(): void {
    if (this.running) return
    this.running = true

    process.env.FLT_TUI_ACTIVE = '1'

    // If running inside tmux, force the window to match the actual client
    // size. Fixes "tmux locked small" where a prior smaller client or
    // window-size=smallest pinned the window narrower than the terminal.
    // The call also switches window-size to `latest` so future client-
    // initiated resizes (terminal zoom) auto-propagate into the TUI.
    const actualCols = process.stdout.columns ?? this.screen.cols
    const actualRows = process.stdout.rows ?? this.screen.rows
    this.priorTmuxWindowSize = refreshCurrentTmuxWindow(actualCols, actualRows)
    if (actualCols !== this.screen.cols || actualRows !== this.screen.rows) {
      this.screen.resize(actualCols, actualRows)
      this.state.termWidth = actualCols
      this.state.termHeight = actualRows
    }

    // Suppress all console output — TUI owns stdout exclusively
    const noop = () => {}
    console.log = noop
    console.error = noop
    console.warn = noop
    console.info = noop
    const themeBg = getThemeBackground()
    if (themeBg) {
      process.stdout.write(`\x1b[?1049h\x1b[?25l\x1b[${themeBg}m\x1b[2J\x1b[H`)
    } else {
      process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H')
    }

    const bindings: InputBindings = {
      getState: () => ({ ...this.state, selectedAgent: this.selectedAgent }),
      getAgentNames: () => this.state.agents.map((a) => a.name),
      getCliAdapters: () => listAdapters(),
      getPresetNames: () => {
        try {
          return listPresets().map((preset) => preset.name)
        } catch {
          return []
        }
      },
      setMode: (mode) => this.setMode(mode),
      openCommand: (initial) => this.openCommand(initial),
      setCommand: (input, cursor) => this.setCommand(input, cursor),
      selectNext: () => this.selectNext(),
      selectPrev: () => this.selectPrev(),
      scrollLogUp: () => this.scrollLogUp(),
      scrollLogDown: () => this.scrollLogDown(),
      scrollLogPageUp: () => this.scrollLogPageUp(),
      scrollLogPageDown: () => this.scrollLogPageDown(),
      jumpLogTop: () => this.jumpLogTop(),
      jumpLogBottom: () => this.jumpLogBottom(),
      inboxMsgDown: () => this.inboxMsgDown(),
      inboxMsgUp: () => this.inboxMsgUp(),
      inboxReply: () => this.inboxReply(),
      inboxDeleteCard: () => this.inboxDeleteCard(),
      inboxClearAll: () => this.inboxClearAll(),
      setSearchQuery: (query) => this.setSearchQuery(query),
      submitCommand: (input) => this.submitCommand(input),
      setKillConfirm: (agentName) => this.setKillConfirm(agentName),
      confirmKill: () => this.confirmKill(),
      cancelKill: () => this.cancelKill(),
      sendInsertText: (text) => this.sendInsertText(text),
      sendInsertKey: (key) => this.sendInsertKey(key),
      flushInsert: () => this.flushInsert(),
      openShell: () => this.openShell(),
      closeShell: () => this.closeShell(),
      openMetrics: () => this.openMetrics(),
      closeMetrics: () => this.closeMetrics(),
      metricsCycleGroup: () => this.metricsCycleGroup(),
      metricsCyclePeriod: () => this.metricsCyclePeriod(),
      metricsToggleRunsFocus: () => this.metricsToggleRunsFocus(),
      metricsScrollDown: () => this.metricsScrollDown(),
      metricsScrollUp: () => this.metricsScrollUp(),
      sendShellText: (text) => {
        sendLiteralBatched(this.shellSession, text)
        this.scheduleShellCapture()
      },
      sendShellKey: (key) => {
        sendKeysAsync(this.shellSession, [key])
        this.scheduleShellCapture()
      },
      flushShell: () => flushBatchedKeys(this.shellSession),
      toggleCollapse: () => this.toggleCollapse(),
      setCompletionPopup: (items, selectedIndex) => {
        this.state.completionItems = items
        this.state.completionSelectedIndex = selectedIndex
        this.requestRender()
      },
      setCompletionSelectedIndex: (index) => {
        this.state.completionSelectedIndex = index
        this.requestRender()
      },
      closeCompletionPopup: () => {
        this.state.completionItems = []
        this.state.completionSelectedIndex = 0
        this.requestRender()
      },
      quit: () => {
        this.stop()
        process.exit(0)
      },
      adjustSidebarWidth: (delta) => this.adjustSidebarWidth(delta),
      navigateCommandHistory: (delta) => this.navigateCommandHistory(delta),
      onResize: () => this.resize(process.stdout.columns ?? this.screen.cols, process.stdout.rows ?? this.screen.rows),
      openSpawnModal: () => this.openSpawnModal(),
      openWorkflowsModal: () => this.openWorkflowsModal(),
      closeWorkflowsModal: () => this.closeWorkflowsModal(),
      openGatesModal: () => this.openGatesModal(),
      closeGatesModal: () => this.closeGatesModal(),
      gatesKey: (key) => this.gatesKey(key),
      setWorkflowFilter: (filter) => this.setWorkflowFilter(filter),
      workflowsSelectNext: () => this.workflowsSelectNext(),
      workflowsSelectPrev: () => this.workflowsSelectPrev(),
      openWorkflowDrilldown: () => this.openWorkflowDrilldown(),
      closeWorkflowDrilldown: () => this.closeWorkflowDrilldown(),
      setModalField: (fieldIndex, value, cursor) => this.setModalField(fieldIndex, value, cursor),
      modalNextField: () => this.modalNextField(),
      modalPrevField: () => this.modalPrevField(),
      modalSelectUp: () => this.modalSelectUp(),
      modalSelectDown: () => this.modalSelectDown(),
      submitModal: () => this.submitModal(),
      cancelModal: () => this.cancelModal(),
    }

    this.cleanupInput = setupInput(bindings)

    this.doRender()
    this.startPolling()
    this.poll()
  }

  stop(): void {
    if (!this.running) return
    this.running = false

    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }

    if (this.bannerTimer) {
      clearTimeout(this.bannerTimer)
      this.bannerTimer = null
    }

    if (this.burstTimeout) {
      clearTimeout(this.burstTimeout)
      this.burstTimeout = null
    }

    if (this.renderFlushId) {
      clearImmediate(this.renderFlushId)
      this.renderFlushId = null
    }

    if (this.cleanupInput) {
      this.cleanupInput()
      this.cleanupInput = null
    }

    if (this.state.gatesModal) {
      closeGatesWatcher(this.state.gatesModal)
      this.state.gatesModal = null
    }

    // Clean up typing indicator
    try { unlinkSync(join(homedir(), '.flt', 'typing')) } catch {}

    // Restore the user's original window-size option so we don't leave their
    // tmux window in `latest` mode after the TUI exits.
    restoreCurrentTmuxWindowSize(this.priorTmuxWindowSize)
    this.priorTmuxWindowSize = null

    process.stdout.write('\x1b[0m\x1b[?25h\x1b[?1049l')
  }

  resize(cols: number, rows: number): void {
    this.markActivity()
    // SIGWINCH means tmux already resized our pane — don't call
    // refreshCurrentTmuxWindow here. That would run `tmux resize-window`, which
    // flips window-size back to `manual` and breaks subsequent client-initiated
    // resizes (e.g. the user's next cmd+/cmd- zoom).

    this.screen.resize(cols, rows)
    this.state.termWidth = cols
    this.state.termHeight = rows
    this.resizeAgentPanes()

    if (this.state.autoFollow) {
      this.state.logScrollOffset = this.maxScroll(this.state.logContent)
    } else {
      this.state.logScrollOffset = Math.min(this.state.logScrollOffset, this.maxScroll(this.state.logContent))
    }

    this.requestRender()
  }

  private resizeAgentPanes(agents: Record<string, AgentState> = allAgents()): void {
    const layout = calculateLayout(this.state.termWidth, this.state.termHeight, this.state.agents, undefined, this.state.sidebarWidth)
    const paneWidth = Math.max(20, layout.logInnerWidth)
    const paneHeight = Math.max(10, layout.logInnerHeight)

    for (const ag of Object.values(agents)) {
      if (!hasSession(ag.tmuxSession)) continue
      const last = this.lastResizedDims[ag.tmuxSession]
      if (!last || last.spawnedAt !== ag.spawnedAt || last.width !== paneWidth || last.height !== paneHeight) {
        resizeWindow(ag.tmuxSession, paneWidth, paneHeight)
        this.lastResizedDims[ag.tmuxSession] = { width: paneWidth, height: paneHeight, spawnedAt: ag.spawnedAt }
      }
    }
  }

  private get selectedAgent(): AgentView | undefined {
    return this.state.agents[this.state.selectedIndex]
  }

  private setMode(mode: Mode): void {
    const previousMode = this.state.mode
    if (previousMode === mode) return
    this.state.previousMode = previousMode
    this.state.mode = mode
    this.restartPolling()


    // Signal controller which agent is being typed into
    const typingFile = join(homedir(), '.flt', 'typing')
    if (mode === 'insert' && this.selectedAgent) {
      try { writeFileSync(typingFile, this.selectedAgent.name) } catch {}
    } else if (previousMode === 'insert') {
      try { unlinkSync(typingFile) } catch {}
    }

    // Default to most recent message when entering inbox mode
    if (mode === 'inbox') {
      this.state.inboxSelectedMsg = Math.max(0, this.state.inboxMessages.length - 1)
    }

    // Immediately capture content for the new mode
    if (mode === 'log-focus' || mode === 'insert' || (mode === 'normal' && previousMode === 'presets')) {
      this.captureSelectedPane()
    }
    this.requestRender()
  }

  private openShell(): void {
    if (!hasSession(this.shellSession)) {
      const cwd = process.cwd()
      const { createSession } = require('../tmux') as typeof import('../tmux')
      createSession(this.shellSession, cwd, process.env.SHELL || 'zsh', {})
    }
    const layout = calculateLayout(this.state.termWidth, this.state.termHeight, this.state.agents, undefined, this.state.sidebarWidth)
    resizeWindow(this.shellSession, Math.max(20, layout.logInnerWidth), Math.max(5, layout.logInnerHeight))
    this.state.mode = 'shell'
    this.captureShell() // immediate capture so content shows right away
    this.restartPolling()
    this.requestRender()
  }

  private closeShell(): void {
    this.state.mode = 'normal'
    this.lastLogContent = '' // force re-capture of agent content
    this.restartPolling()
    this.poll() // immediate refresh
    this.requestRender()
  }

  private openMetrics(): void {
    this.state.metrics = {
      period: 'today',
      groupBy: 'model',
      runsListFocused: false,
      runsScrollOffset: 0,
    }
    invalidateMetricsModalCache()
    this.setMode('metrics')
    this.requestRender()
  }

  private closeMetrics(): void {
    if (this.state.mode !== 'metrics') return
    this.state.metrics = null
    this.setMode('normal')
    this.screen.forceDirty()
    this.requestRender()
  }

  private metricsCycleGroup(): void {
    const modal = this.state.metrics
    if (!modal || this.state.mode !== 'metrics') return
    const order: GroupBy[] = ['model', 'workflow', 'agent']
    const idx = order.indexOf(modal.groupBy)
    modal.groupBy = order[(idx + 1) % order.length]
    modal.runsScrollOffset = 0
    invalidateMetricsModalCache()
    this.requestRender()
  }

  private metricsCyclePeriod(): void {
    const modal = this.state.metrics
    if (!modal || this.state.mode !== 'metrics') return
    const order: Period[] = ['today', 'week', 'month', 'all']
    const idx = order.indexOf(modal.period)
    modal.period = order[(idx + 1) % order.length]
    modal.runsScrollOffset = 0
    invalidateMetricsModalCache()
    this.requestRender()
  }

  private metricsToggleRunsFocus(): void {
    const modal = this.state.metrics
    if (!modal || this.state.mode !== 'metrics') return
    modal.runsListFocused = !modal.runsListFocused
    this.requestRender()
  }

  private metricsScrollDown(): void {
    const modal = this.state.metrics
    if (!modal || this.state.mode !== 'metrics') return
    modal.runsScrollOffset += 1
    this.requestRender()
  }

  private metricsScrollUp(): void {
    const modal = this.state.metrics
    if (!modal || this.state.mode !== 'metrics') return
    modal.runsScrollOffset = Math.max(0, modal.runsScrollOffset - 1)
    this.requestRender()
  }

  private scheduleShellCapture(): void {
    if (this.insertCaptureTimer) return
    this.insertCaptureTimer = setTimeout(() => {
      this.insertCaptureTimer = null
      this.captureShell()
    }, 50)
  }

  private captureShell(): void {
    if (!hasSession(this.shellSession)) return
    try {
      // Only capture the visible pane — no scrollback. Matches what the user sees after clear.
      const content = capturePaneVisible(this.shellSession)
      if (content !== this.shellContent) {
        this.shellContent = content
        this.state.logContent = content
        this.state.logScrollOffset = 0
        this.requestRender()
      }
    } catch {}
  }

  private setKillConfirm(agentName: string): void {
    this.state.mode = 'kill-confirm'
    this.state.killConfirmAgent = agentName
    this.requestRender()
  }

  private confirmKill(): void {
    const agentName = this.state.killConfirmAgent
    if (!agentName) return
    this.state.mode = 'normal'
    this.state.killConfirmAgent = undefined
    kill({ name: agentName })
      .then(() => {
        this.setBanner(`Killed ${agentName}`, 'green', 3000)
        this.poll()
        this.requestRender()
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e)
        this.setBanner(`Kill failed: ${msg}`, 'red', 5000)
        this.requestRender()
      })
  }

  private cancelKill(): void {
    this.state.mode = 'normal'
    this.state.killConfirmAgent = undefined
    this.requestRender()
  }

  private openCommand(initial: string): void {
    this.state.mode = 'command'
    this.state.commandInput = initial
    this.state.commandCursor = initial.length
    this.updateCompletionPopup()
    this.restartPolling()
    this.requestRender()
  }

  private setCommand(input: string, cursor: number): void {
    this.markActivity()
    this.state.commandInput = input
    this.state.commandCursor = cursor
    this.updateCompletionPopup()
    this.requestRender()
  }

  private updateCompletionPopup(): void {
    if (this.state.mode !== 'command') {
      this.state.completionItems = []
      return
    }
    // Empty input → no suggestions, so up/down arrows can navigate history
    // instead of an unsolicited "all commands" suggestion list.
    if (this.state.commandInput.length === 0) {
      this.state.completionItems = []
      this.state.completionSelectedIndex = 0
      return
    }
    try {
      const items = getCompletionItems(
        this.state.commandInput,
        this.state.agents.map(a => a.name),
        listAdapters(),
        listPresets().map(p => p.name),
      )
      this.state.completionItems = items
      if (this.state.completionSelectedIndex >= items.length) {
        this.state.completionSelectedIndex = 0
      }
    } catch {
      this.state.completionItems = []
      this.state.completionSelectedIndex = 0
    }
  }

  private showCachedPane(): void {
    const agent = this.state.agents[this.state.selectedIndex]
    const cached = agent ? this.paneCache[agent.name] : undefined
    if (cached) {
      this.lastLogContent = cached
      this.applyLogContent(cached)
    } else {
      this.lastLogContent = ''
    }
  }

  private selectPrev(): void {
    if (this.state.agents.length === 0) return
    const total = this.state.agents.length
    this.state.selectedIndex = (this.state.selectedIndex - 1 + total) % total
    this.showCachedPane()
    const selected = this.selectedAgent
    if (selected) delete this.state.notifications[selected.name]
    this.sidebarScrollSync()
    this.requestRender()
  }

  private selectNext(): void {
    if (this.state.agents.length === 0) return
    this.state.selectedIndex = (this.state.selectedIndex + 1) % this.state.agents.length
    this.showCachedPane()
    const selected = this.selectedAgent
    if (selected) delete this.state.notifications[selected.name]
    this.sidebarScrollSync()
    this.requestRender()
  }

  private sidebarVisibleCount(): number {
    const layout = calculateLayout(this.state.termWidth, this.state.termHeight, this.state.agents, undefined, this.state.sidebarWidth)
    const logoHeight = getAsciiLogo(layout.sidebarInnerWidth).length
    const entryRows = layout.sidebarInnerHeight - 2 - logoHeight
    return Math.max(1, Math.floor(entryRows / 5))
  }

  private sidebarScrollSync(): void {
    const count = this.state.agents.length
    if (count === 0) { this.state.sidebarScrollOffset = 0; return }
    const idx = this.state.selectedIndex
    const visible = this.sidebarVisibleCount()
    const offset = this.state.sidebarScrollOffset
    if (idx < offset) {
      this.state.sidebarScrollOffset = idx
    } else if (idx >= offset + visible) {
      this.state.sidebarScrollOffset = Math.max(0, idx - visible + 1)
    }
    this.state.sidebarScrollOffset = Math.max(0, Math.min(this.state.sidebarScrollOffset, Math.max(0, count - visible)))
  }

  private adjustSidebarWidth(delta: number): void {
    const SIDEBAR_MIN = 20
    const SIDEBAR_MAX = 60
    const next = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, this.state.sidebarWidth + delta))
    if (next === this.state.sidebarWidth) return
    this.state.sidebarWidth = next
    this.requestRender()
  }

  private navigateCommandHistory(delta: number): void {
    const hist = this.state.commandHistory
    if (hist.length === 0) return
    let idx = this.state.commandHistoryIndex
    if (idx < 0) idx = hist.length
    idx = Math.max(0, Math.min(hist.length, idx + delta))
    this.state.commandHistoryIndex = idx
    const next = idx >= hist.length ? '' : hist[idx]!
    this.state.commandInput = next
    this.state.commandCursor = next.length
    this.requestRender()
  }

  private toggleCollapse(): void {
    const agent = this.selectedAgent
    if (!agent) return
    const name = agent.name
    const idx = this.state.collapsedAgents.indexOf(name)
    if (idx === -1) {
      this.state.collapsedAgents = [...this.state.collapsedAgents, name]
    } else {
      this.state.collapsedAgents = this.state.collapsedAgents.filter(n => n !== name)
    }
    // Re-sort with new collapsed set
    this.applyCurrentCollapse()
    this.requestRender()
  }

  private applyCurrentCollapse(): void {
    const collapsedSet = new Set(this.state.collapsedAgents)
    const currentAgents = this.state.agents.map(a => ({ ...a, collapsedChildCount: undefined }))
    const sorted = sortTreeOrder(currentAgents, collapsedSet)
    // Keep selectedIndex pointing at the same agent
    const prevName = this.selectedAgent?.name
    this.state.agents = sorted
    if (prevName) {
      const idx = sorted.findIndex(a => a.name === prevName)
      if (idx >= 0) this.state.selectedIndex = idx
      else this.state.selectedIndex = Math.min(this.state.selectedIndex, Math.max(0, sorted.length - 1))
    }
    this.sidebarScrollSync()
  }

  private logViewHeight(): number {
    const layout = calculateLayout(this.state.termWidth, this.state.termHeight, this.state.agents, undefined, this.state.sidebarWidth)
    return Math.max(1, layout.logInnerHeight)
  }

  private maxScroll(content: string): number {
    const lines = content.split('\n').length
    return Math.max(0, lines - this.logViewHeight())
  }

  private applyLogContent(content: string): boolean {
    if (this.state.logContent === content) return false

    this.state.logContent = content
    const bottom = this.maxScroll(content)
    this.state.logScrollOffset = this.state.autoFollow
      ? bottom
      : Math.min(this.state.logScrollOffset, bottom)

    return true
  }

  private scrollLogUp(): void {
    if (this.state.autoFollow) {
      // Transitioning out of follow — will switch from visible-pane to scrollback capture.
      // Pre-capture deeper scrollback so off-screen style/opening sequences are preserved.
      const agent = this.selectedAgent
      if (agent) {
        try {
          const full = capturePane(agent.tmuxSession, Math.max(1000, (this.state.termHeight - 5) * 12))
          this.state.logContent = full
          this.lastLogContent = full
          this.state.logScrollOffset = this.maxScroll(full)
        } catch {}
      }
    }
    this.state.logScrollOffset = Math.max(0, this.state.logScrollOffset - 1)
    this.state.autoFollow = false
    this.requestRender()
  }

  private scrollLogDown(): void {
    const max = this.maxScroll(this.state.logContent)
    this.state.logScrollOffset = Math.min(max, this.state.logScrollOffset + 1)
    this.state.autoFollow = this.state.logScrollOffset >= max
    this.requestRender()
  }

  private scrollLogPageUp(): void {
    if (this.state.autoFollow) {
      const agent = this.selectedAgent
      if (agent) {
        try {
          const full = capturePane(agent.tmuxSession, Math.max(1000, (this.state.termHeight - 5) * 12))
          this.state.logContent = full
          this.lastLogContent = full
          this.state.logScrollOffset = this.maxScroll(full)
        } catch {}
      }
    }
    const page = Math.max(1, Math.floor(this.logViewHeight() / 2))
    this.state.logScrollOffset = Math.max(0, this.state.logScrollOffset - page)
    this.state.autoFollow = false
    this.requestRender()
  }

  private scrollLogPageDown(): void {
    const max = this.maxScroll(this.state.logContent)
    const page = Math.max(1, Math.floor(this.logViewHeight() / 2))
    this.state.logScrollOffset = Math.min(max, this.state.logScrollOffset + page)
    this.state.autoFollow = this.state.logScrollOffset >= max
    this.requestRender()
  }

  private jumpLogTop(): void {
    this.state.logScrollOffset = 0
    this.state.autoFollow = false
    this.requestRender()
  }

  private jumpLogBottom(): void {
    this.state.logScrollOffset = this.maxScroll(this.state.logContent)
    this.state.autoFollow = true
    this.requestRender()
  }

  private inboxMsgDown(): void {
    const max = Math.max(0, this.state.inboxMessages.length - 1)
    this.state.inboxSelectedMsg = Math.min(max, this.state.inboxSelectedMsg + 1)
    this.requestRender()
  }

  private inboxMsgUp(): void {
    this.state.inboxSelectedMsg = Math.max(0, this.state.inboxSelectedMsg - 1)
    this.requestRender()
  }

  private inboxDeleteCard(): void {
    const idx = this.state.inboxSelectedMsg
    if (idx < 0 || idx >= this.state.inboxMessages.length) return
    this.state.inboxMessages = this.state.inboxMessages.filter((_, i) => i !== idx)
    this.rewriteInbox()
    this.state.inboxSelectedMsg = Math.min(idx, Math.max(0, this.state.inboxMessages.length - 1))
    this.requestRender()
  }

  private inboxClearAll(): void {
    this.state.inboxMessages = []
    this.rewriteInbox()
    this.state.inboxSelectedMsg = 0
    this.requestRender()
  }

  private rewriteInbox(): void {
    const { getInboxPath } = require('../commands/init') as typeof import('../commands/init')
    const { writeFileSync } = require('fs')
    const content = this.state.inboxMessages
      .map(m => `[${m.timestamp}] [${m.from}]: ${m.text}`)
      .join('\n') + (this.state.inboxMessages.length > 0 ? '\n' : '')
    writeFileSync(getInboxPath(), content)
  }

  private inboxReply(): void {
    const msg = this.state.inboxMessages[this.state.inboxSelectedMsg]
    if (msg) this.openCommand(`send ${msg.from} `)
  }

  private setSearchQuery(query: string): void {
    this.state.searchQuery = query
    this.requestRender()
  }

  private setBanner(text: string, color: string, clearAfterMs?: number): void {
    if (this.bannerTimer) {
      clearTimeout(this.bannerTimer)
      this.bannerTimer = null
    }

    this.state.banner = { text, color }
    this.requestRender()

    if (clearAfterMs) {
      this.bannerTimer = setTimeout(() => {
        this.state.banner = null
        this.requestRender()
      }, clearAfterMs)
    }
  }

  private clearBanner(): void {
    if (this.bannerTimer) {
      clearTimeout(this.bannerTimer)
      this.bannerTimer = null
    }
    this.state.banner = null
    this.requestRender()
  }

  private submitCommand(input: string): void {
    const command = input.trim()
    this.state.mode = 'normal'
    this.restartPolling()
    this.requestRender()

    if (!command) return

    // Push to history (dedupe consecutive). Reset history navigation index.
    const hist = this.state.commandHistory
    if (hist.length === 0 || hist[hist.length - 1] !== command) {
      hist.push(command)
      if (hist.length > 200) hist.shift()
    }
    this.state.commandHistoryIndex = -1

    // Detect incomplete commands → open modal
    const parsed = parseCommand(`:${command}`)
    if (parsed) {
      if (parsed.cmd === 'spawn' && parsed.args.length === 0) {
        this.openSpawnModal(command)
        return
      }
      if (parsed.cmd === 'kill' && parsed.args.length === 0) {
        this.openKillModal(command)
        return
      }
      if (parsed.cmd === 'presets' && parsed.args.length <= 1 && !['add', 'remove'].includes(parsed.args[0] ?? '')) {
        this.openPresetsModal(command)
        return
      }
    }

    void this.executeCommand(command)
  }

  private async executeCommand(commandStr: string): Promise<void> {
    const parsed = parseCommand(`:${commandStr}`)
    if (!parsed) return

    if (parsed.cmd === 'send' && parsed.args.length >= 2) {
      const target = parsed.args[0]
      const rawMessage = parsed.args.slice(1).join(' ')
      const message = enrichMessageWithFiles(rawMessage)
      try {
        await send({ target, message })
        this.setBanner(`Sent message to ${target}`, 'green', 2000)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        this.setBanner(`Send failed: ${msg}`, 'red', 5000)
      }
      return
    }

    if (parsed.cmd === 'spawn' && parsed.args.length >= 1) {
      const spawnArgs = parsed.args
      const name = spawnArgs[0]
      let cli: string | undefined
      let model: string | undefined
      let preset: string | undefined
      let dir: string | undefined
      const messageTokens: string[] = []

      let persistent: boolean | undefined
      let worktree: boolean | undefined
      let parent: string | undefined
      const skills: string[] = []
      let allSkills: boolean | undefined
      let noModelResolve: boolean | undefined
      let i = 1
      while (i < spawnArgs.length) {
        if ((spawnArgs[i] === '--cli' || spawnArgs[i] === '-c') && i + 1 < spawnArgs.length) {
          cli = spawnArgs[i + 1]
          i += 2
        } else if ((spawnArgs[i] === '--model' || spawnArgs[i] === '-m') && i + 1 < spawnArgs.length) {
          model = spawnArgs[i + 1]
          i += 2
        } else if ((spawnArgs[i] === '--preset' || spawnArgs[i] === '-p') && i + 1 < spawnArgs.length) {
          preset = spawnArgs[i + 1]
          i += 2
        } else if ((spawnArgs[i] === '--dir' || spawnArgs[i] === '-d') && i + 1 < spawnArgs.length) {
          const raw = spawnArgs[i + 1]
          dir = raw.startsWith('~/') ? raw.replace('~', process.env.HOME || homedir()) : raw
          i += 2
        } else if (spawnArgs[i] === '--parent' && i + 1 < spawnArgs.length) {
          parent = spawnArgs[i + 1]
          i += 2
        } else if (spawnArgs[i] === '--persistent') {
          persistent = true
          i += 1
        } else if (spawnArgs[i] === '--skill' && i + 1 < spawnArgs.length) {
          skills.push(spawnArgs[i + 1])
          i += 2
        } else if (spawnArgs[i] === '--all-skills') {
          allSkills = true
          i += 1
        } else if (spawnArgs[i] === '--no-model-resolve') {
          noModelResolve = true
          i += 1
        } else if (spawnArgs[i] === '--no-worktree' || spawnArgs[i] === '-W') {
          worktree = false
          i += 1
        } else {
          messageTokens.push(spawnArgs[i])
          i += 1
        }
      }

      if (!cli && !preset) {
        cli = 'claude-code'
      }

      const bootstrap = messageTokens.join(' ') || undefined
      const cliLabel = cli ?? `preset:${preset}`
      this.setBanner(`Spawning ${name} (${cliLabel}/${model || 'default'})...`, 'yellow')

      const staleTimer = setTimeout(() => {
        this.setBanner(`Spawn ${name}: still waiting (check flt logs ${name})`, 'yellow')
      }, 65000)

      spawn({
        name,
        cli,
        preset,
        model,
        dir,
        bootstrap,
        persistent,
        worktree,
        parent,
        skills: skills.length ? skills : undefined,
        allSkills,
        noModelResolve,
      })
        .then(() => {
          clearTimeout(staleTimer)
          this.setBanner(`Spawned ${name}`, 'green', 3000)
          this.poll()
        })
        .catch((error: Error) => {
          clearTimeout(staleTimer)
          this.setBanner(`Spawn failed: ${error.message}`, 'red', 5000)
        })
      return
    }

    if (parsed.cmd === 'kill' && parsed.args.length >= 1) {
      const name = parsed.args[0]
      try {
        await kill({ name })
        this.setBanner(`Killed ${name}`, 'green', 3000)
        this.poll()
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        this.setBanner(`Kill failed: ${msg}`, 'red', 5000)
      }
      return
    }

    if (parsed.cmd === 'logs' && parsed.args.length >= 1) {
      const target = parsed.args[0]
      const idx = this.state.agents.findIndex((a) => a.name === target)
      if (idx !== -1) {
        this.state.selectedIndex = idx
        this.lastLogContent = ''
        this.requestRender()
      }
      return
    }

    if (parsed.cmd === 'presets') {
      const action = parsed.args[0]

      if (!action || action === 'list') {
        try {
          const output = formatPresetList()
          this.lastLogContent = output
          this.applyLogContent(output)
          this.clearBanner()
          this.setMode('presets')
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          this.setBanner(`Presets failed: ${msg}`, 'red', 5000)
        }
        return
      }

      if (action === 'add') {
        const name = parsed.args[1]
        if (!name) {
          this.setBanner('Usage: presets add <name> --cli <cli> --model <model> [--description <desc>]', 'red', 5000)
          return
        }

        let cli: string | undefined
        let model: string | undefined
        let description: string | undefined

        let i = 2
        while (i < parsed.args.length) {
          const token = parsed.args[i]
          if (token === '--cli' && i + 1 < parsed.args.length) {
            cli = parsed.args[i + 1]
            i += 2
            continue
          }

          if (token === '--model' && i + 1 < parsed.args.length) {
            model = parsed.args[i + 1]
            i += 2
            continue
          }

          if (token === '--description') {
            const descTokens: string[] = []
            let j = i + 1
            while (j < parsed.args.length && !parsed.args[j].startsWith('--')) {
              descTokens.push(parsed.args[j])
              j += 1
            }
            description = descTokens.join(' ')
            i = j
            continue
          }

          i += 1
        }

        if (!cli || !model) {
          this.setBanner('Usage: presets add <name> --cli <cli> --model <model> [--description <desc>]', 'red', 5000)
          return
        }

        try {
          presetsAdd({ name, cli, model, description })
          this.setBanner(`Added preset ${name}`, 'green', 3000)
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          this.setBanner(`Add preset failed: ${msg}`, 'red', 5000)
        }
        return
      }

      if (action === 'remove') {
        const name = parsed.args[1]
        if (!name) {
          this.setBanner('Usage: presets remove <name>', 'red', 5000)
          return
        }

        try {
          presetsRemove({ name })
          this.setBanner(`Removed preset ${name}`, 'green', 3000)
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          this.setBanner(`Remove preset failed: ${msg}`, 'red', 5000)
        }
        return
      }

      this.setBanner(`Unknown presets command: ${action}`, 'red', 4000)
      return
    }

    if (parsed.cmd === 'ascii') {
      const { setAsciiWord, resetAscii, getCurrentAsciiConfig } = require('./ascii') as typeof import('./ascii')
      const word = parsed.args[0]

      if (word === 'reset') {
        resetAscii()
        this.screen.forceDirty()
        this.setBanner('ASCII logo reset to flt', 'green', 2000)
        return
      }

      // No args = toggle logo visibility
      if (!word) {
        const current = getCurrentAsciiConfig()
        if (current.visible === false) {
          setAsciiWord(current.word, current.font, true)
          this.screen.forceDirty()
          this.setBanner('ASCII logo shown', 'green', 2000)
        } else {
          setAsciiWord(current.word, current.font, false)
          this.screen.forceDirty()
          this.setBanner('ASCII logo hidden', 'green', 2000)
        }
        return
      }

      // :ascii <word> [fontfile.flf]
      let fontPath: string | null = null
      const fontArg = parsed.args[1]
      if (fontArg) {
        const raw = fontArg.startsWith('~/') ? fontArg.replace('~', process.env.HOME || homedir()) : fontArg
        const { existsSync } = require('fs') as typeof import('fs')
        if (!existsSync(raw)) {
          this.setBanner(`Font file not found: ${raw}`, 'red', 4000)
          return
        }
        fontPath = raw
      }

      setAsciiWord(word, fontPath)
      this.screen.forceDirty()
      const fontMsg = fontPath ? ` (font: ${fontPath})` : ''
      this.setBanner(`ASCII logo: ${word}${fontMsg}`, 'green', 2000)
      return
    }

    if (parsed.cmd === 'q' || parsed.cmd === 'quit') {
      this.stop()
      process.exit(0)
    }

    if (parsed.cmd === 'help') {
      this.setBanner('Commands: send, logs, spawn, presets, kill, theme, ascii, keybinds, help', 'cyan', 4000)
      return
    }

    if (parsed.cmd === 'keybinds') {
      this.setBanner(getKeybindsBanner(this.state.mode), 'cyan', 5000)
      return
    }

    if (parsed.cmd === 'theme') {
      const themeName = parsed.args[0]
      if (!themeName) {
        this.setBanner(`Current: ${getCurrentThemeName()}. Available: ${getThemeNames().join(', ')}`, 'cyan', 4000)
      } else if (setTheme(themeName)) {
        const themeBg = getThemeBackground()
        this.screen.setDefaultBg(themeBg)
        // Keep alt-screen clear operations aligned with the selected theme background.
        if (themeBg) {
          process.stdout.write(`\x1b[${themeBg}m`)
        }
        this.setBanner(`Theme: ${themeName}`, 'green', 2000)
      } else {
        this.setBanner(`Unknown theme: ${themeName}. Available: ${getThemeNames().join(', ')}`, 'red', 4000)
      }
      return
    }

    this.setBanner(`Unknown command: ${parsed.cmd}`, 'red', 3000)
  }

  private sendInsertText(text: string): void {
    this.markActivity()
    const selected = this.selectedAgent
    if (!selected || !text) return
    sendLiteralBatched(selected.tmuxSession, text)
    this.scheduleInsertCapture()
  }

  private sendInsertKey(key: TmuxInsertKey): void {
    this.markActivity()
    const selected = this.selectedAgent
    if (!selected) return
    sendKeysAsync(selected.tmuxSession, [key])
    this.scheduleInsertCapture()
  }

  private flushInsert(): void {
    const selected = this.selectedAgent
    if (!selected) return
    flushBatchedKeys(selected.tmuxSession)
  }

  /** Capture pane ~50ms after keystroke so typed chars appear fast */
  private scheduleInsertCapture(): void {
    if (this.insertCaptureTimer) return // already scheduled
    this.insertCaptureTimer = setTimeout(() => {
      this.insertCaptureTimer = null
      this.captureSelectedPane()
    }, 50)
  }

  /** Capture just the selected agent's pane and re-render if changed */
  private captureSelectedPane(): void {
    const selected = this.selectedAgent
    if (!selected) return
    const agents = allAgents()
    const agent = agents[selected.name]
    if (!agent) return
    try {
      const layout = calculateLayout(this.state.termWidth, this.state.termHeight, this.state.agents, undefined, this.state.sidebarWidth)
      const paneHeight = Math.max(10, layout.logInnerHeight)
      // In auto-follow, include style context above the viewport so ANSI state
      // that begins just off-screen still applies to visible rows.
      const raw = capturePane(
        agent.tmuxSession,
        this.state.autoFollow ? Math.max(1000, paneHeight * 6) : Math.max(1000, (this.state.termHeight - 5) * 12),
      )
      const content = stripOsc8(raw)
      if (content !== this.lastLogContent) {
        this.lastLogContent = content
        this.state.logContent = content
        if (this.state.autoFollow) {
          this.state.logScrollOffset = this.maxScroll(content)
        }
        this.requestRender()
      }
    } catch {}
  }

  private restartPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    this.startPolling()
  }

  private startPolling(): void {
    const burst = this.burstTimeout !== null
    const baseMs = this.state.mode === 'insert' ? 500 : 1000
    const pollMs = burst ? 200 : baseMs
    this.pollTimer = setInterval(() => this.poll(), pollMs)
  }

  private applyAgents(nextAgents: AgentView[]): boolean {
    const prevSelectedName = this.selectedAgent?.name
    const nextHash = agentsHash(nextAgents)
    if (nextHash === this.lastAgentsHash) return false

    this.lastAgentsHash = nextHash
    this.state.agents = nextAgents

    if (!nextAgents.length) {
      this.state.selectedIndex = 0
      return true
    }

    if (prevSelectedName) {
      const idx = nextAgents.findIndex((a) => a.name === prevSelectedName)
      if (idx >= 0) {
        this.state.selectedIndex = idx
        return true
      }
    }

    this.state.selectedIndex = Math.min(this.state.selectedIndex, nextAgents.length - 1)
    return true
  }

  private poll(): void {
    if (!this.running) return

    let changed = false

    const agents = allAgents() ?? {}
    const isInsert = this.state.mode === 'insert'
    const nextViews: AgentView[] = []

    const selfName = process.env.FLT_AGENT_NAME
    const selfSession = selfName ? `flt-${selfName}` : null

    for (const [name, agentState] of Object.entries(agents)) {
      const isRecent = Date.now() - new Date(agentState.spawnedAt).getTime() < 10000
      let status: AgentView['status']

      if (isRecent) {
        status = 'spawning'
      } else if (agentState.tmuxSession === selfSession) {
        // This is us (the TUI) — we know we're running
        status = 'running'
      } else if (!hasSession(agentState.tmuxSession)) {
        status = 'exited'
      } else if (isInsert) {
        const existing = this.state.agents.find((a) => a.name === name)
        status = existing?.status ?? 'running'
      } else {
        // Read status from state.json (written by controller poller)
        status = agentState.status ?? 'idle'
      }

      // Track status changes → notifications for non-selected agents
      const prevStatus = this.lastStatusByAgent[name]
      if (prevStatus && prevStatus !== status && this.selectedAgent?.name !== name) {
        this.state.notifications[name] = 'status'
      }
      this.lastStatusByAgent[name] = status

      nextViews.push({
        name,
        status,
        lastSeen: Date.now(),
        ...agentState,
      })
    }

    // Sort agents in tree order so array index matches display order
    const collapsedSet = new Set(this.state.collapsedAgents)
    const sorted = sortTreeOrder(nextViews, collapsedSet)
    if (this.applyAgents(sorted)) changed = true

    const selected = this.selectedAgent
    if (selected?.name !== this.lastSelectedName) {
      this.lastSelectedName = selected?.name
      this.lastLogContent = ''
    }

    // In shell mode, capture shell pane instead of agent pane
    if (this.state.mode === 'shell') {
      this.captureShell()
      if (changed) this.requestRender()
      return
    }

    // Keep :presets list visible until user exits the presets view.
    if (this.state.mode === 'presets') {
      if (changed) this.requestRender()
      return
    }

    // Pre-resize all agent panes so switching is instant (no wrong-size frame)
    // and so sidebar width changes immediately propagate to tmux pane width.
    this.resizeAgentPanes(agents)

    if (!isInsert) {
      for (const [name, ag] of Object.entries(agents)) {
        if (!hasSession(ag.tmuxSession)) continue
        // Background-cache non-selected agents so switching is instant
        if (!selected || name !== selected.name) {
          try {
            this.paneCache[name] = stripOsc8(capturePaneVisible(ag.tmuxSession))
          } catch {}
        }
      }
    }

    if (selected) {
      const agent = agents[selected.name]
      if (agent && agent.tmuxSession === selfSession) {
        const selfMsg = `This is you (${selected.name}) - the flt TUI is running in this session.\n\nSelect another agent to view its output.`
        if (selfMsg !== this.lastLogContent) {
          this.lastLogContent = selfMsg
          if (this.applyLogContent(selfMsg)) changed = true
        }
      } else if (agent) {
        try {
          const layout = calculateLayout(this.state.termWidth, this.state.termHeight, this.state.agents, undefined, this.state.sidebarWidth)
          const paneHeight = Math.max(10, layout.logInnerHeight)

          // In auto-follow, still capture some context above the viewport so
          // opening ANSI sequences that start just off-screen are preserved.
          const content = stripOsc8(this.state.autoFollow
            ? capturePane(agent.tmuxSession, Math.max(1000, paneHeight * 6))
            : capturePane(agent.tmuxSession, Math.max(1000, paneHeight * 12)))
          if (content !== this.lastLogContent) {
            this.lastLogContent = content
            if (this.applyLogContent(content)) changed = true
          }
        } catch {
          const errorText = '[error reading pane]'
          if (this.lastLogContent !== errorText) {
            this.lastLogContent = errorText
            if (this.applyLogContent(errorText)) changed = true
          }
        }
      }
    }

    try {
      const inboxPath = getInboxPath()
      if (existsSync(inboxPath)) {
        const raw = readFileSync(inboxPath, 'utf-8')
        if (raw !== this.lastInboxRaw) {
          this.lastInboxRaw = raw
          this.state.inboxMessages = parseInbox(raw)
          changed = true
        }
      }
    } catch {
      // best effort
    }

    if (changed) {
      this.requestRender()
    }
  }

  private openWorkflowsModal(): void {
    this.state.workflowsModal = initialWorkflowModalState('all')
    this.setMode('workflows')
    this.requestRender()
  }

  private closeWorkflowsModal(): void {
    this.state.workflowsModal = null
    if (this.state.mode === 'workflows') {
      this.setMode('normal')
    } else {
      this.requestRender()
    }
  }

  private setWorkflowFilter(filter: WorkflowFilter): void {
    const modal = this.state.workflowsModal
    if (!modal || modal.drilldown) return
    modal.filter = filter
    modal.rows = loadWorkflowRows(filter)
    modal.selectedIndex = 0
    this.requestRender()
  }

  private workflowsSelectNext(): void {
    const modal = this.state.workflowsModal
    if (!modal || modal.drilldown || modal.rows.length === 0) return
    modal.selectedIndex = Math.min(modal.rows.length - 1, modal.selectedIndex + 1)
    this.requestRender()
  }

  private workflowsSelectPrev(): void {
    const modal = this.state.workflowsModal
    if (!modal || modal.drilldown || modal.rows.length === 0) return
    modal.selectedIndex = Math.max(0, modal.selectedIndex - 1)
    this.requestRender()
  }

  private openWorkflowDrilldown(): void {
    const modal = this.state.workflowsModal
    if (!modal || modal.drilldown) return
    // The render groups rows running-first then past (modal-workflows.ts:122-124).
    // selectedIndex indexes that combined list, NOT modal.rows (which is sorted
    // globally by startedAt desc). Mirror the same split here or the popup
    // shows the wrong run when the newest startedAt is past, not running.
    const running = modal.rows.filter(r => r.status === 'running')
    const past = modal.rows.filter(r => r.status !== 'running')
    const items = [...running, ...past]
    const row = items[modal.selectedIndex]
    if (!row) return
    modal.drilldown = getWorkflowHistory(row.id)
    modal.drilldownId = row.id
    modal.drilldownTitle = `${row.workflow} · ${row.id}`
    this.requestRender()
  }

  private closeWorkflowDrilldown(): void {
    const modal = this.state.workflowsModal
    if (!modal) return
    modal.drilldown = null
    modal.drilldownId = null
    modal.drilldownTitle = null
    this.requestRender()
  }

  private openGatesModal(): void {
    this.state.gatesModal = initialGatesModalState()
    openGatesWatcher(this.state.gatesModal, () => {
      this.requestRender()
    })
    this.setMode('gates')
    this.requestRender()
  }

  private closeGatesModal(): void {
    if (this.state.gatesModal) {
      closeGatesWatcher(this.state.gatesModal)
      this.state.gatesModal = null
    }
    if (this.state.mode === 'gates') {
      this.setMode('normal')
    } else {
      this.requestRender()
    }
  }

  private refreshGates(): void {
    const modal = this.state.gatesModal
    if (!modal) return
    cleanStaleGates()
    modal.rows = loadAllRows()
    this.requestRender()
  }

  private gatesKey(key: string): void {
    const modal = this.state.gatesModal
    if (!modal) return

    const actions: GatesActions = {
      approve: (runId, opts) => {
        workflowApprove(runId, opts).then(() => this.refreshGates()).catch(() => this.refreshGates())
      },
      reject: (runId, reason) => {
        workflowReject(runId, reason).then(() => this.refreshGates()).catch(() => this.refreshGates())
      },
      nodeRetry: (runId, nodeId) => {
        workflowNodeDecision('retry', runId, nodeId).then(() => this.refreshGates()).catch(() => this.refreshGates())
      },
      nodeSkip: (runId, nodeId) => {
        workflowNodeDecision('skip', runId, nodeId).then(() => this.refreshGates()).catch(() => this.refreshGates())
      },
      nodeAbort: (runId) => {
        workflowNodeDecision('abort', runId).then(() => this.refreshGates()).catch(() => this.refreshGates())
      },
      reconcileRetry: (runId) => {
        workflowReconcileDecision('retry-reconcile', runId).then(() => this.refreshGates()).catch(() => this.refreshGates())
      },
      reconcileAbort: (runId) => {
        workflowReconcileDecision('abort', runId).then(() => this.refreshGates()).catch(() => this.refreshGates())
      },
      pickCandidate: (runId, nodeId, candidate) => {
        workflowApprove(runId, { candidate, nodeId }).then(() => this.refreshGates()).catch(() => this.refreshGates())
      },
      cancelRun: (runId) => {
        workflowCancel(runId).then(() => this.refreshGates()).catch(() => this.refreshGates())
      },
      dismissBlocker: (_runDir) => {
        // No-op on disk — blockers live in artifacts/blocker_report.json,
        // not .gate-pending. Touching .gate-pending here would nuke any
        // concurrent gates pending on the same run. Modal-side dismiss
        // (visual hide) is a future enhancement.
        this.refreshGates()
      },
      refresh: () => this.refreshGates(),
    }

    const handled = handleGatesKey(modal, key, actions)
    if (!handled) {
      this.closeGatesModal()
    } else {
      this.requestRender()
    }
  }

  private openSpawnModal(rawCommand?: string): void {
    const adapters = listAdapters()
    this.state.modal = {
      type: 'spawn',
      title: 'Spawn Agent',
      fields: [
        { label: 'Name', value: '', cursor: 0, required: true },
        { label: 'CLI', value: '', cursor: 0, options: adapters, required: false },
        { label: 'Model', value: '', cursor: 0, required: false },
        { label: 'Preset', value: '', cursor: 0, options: this.presetNames(), required: false },
      ],
      activeField: 0,
      listItems: [],
      selectedIndex: 0,
      rawCommand,
    }
    this.requestRender()
  }

  private openKillModal(rawCommand?: string): void {
    const items: ModalListItem[] = this.state.agents.map(a => ({
      label: a.name,
      detail: `${a.cli}/${a.model} ${a.status}`,
    }))
    this.state.modal = {
      type: 'kill',
      title: 'Kill Agent',
      fields: [],
      activeField: 0,
      listItems: items,
      selectedIndex: 0,
      rawCommand,
    }
    this.requestRender()
  }

  private openPresetsModal(rawCommand?: string): void {
    const items: ModalListItem[] = this.presetItems()
    this.state.modal = {
      type: 'presets',
      title: 'Presets',
      fields: [],
      activeField: 0,
      listItems: items,
      selectedIndex: 0,
      rawCommand,
    }
    this.requestRender()
  }

  private presetNames(): string[] {
    try { return listPresets().map(p => p.name) } catch { return [] }
  }

  private presetItems(): ModalListItem[] {
    try {
      return listPresets().map(p => ({
        label: p.name,
        detail: `${p.cli}/${p.model}`,
      }))
    } catch { return [] }
  }

  private setModalField(fieldIndex: number, value: string, cursor: number): void {
    const modal = this.state.modal
    if (!modal || fieldIndex >= modal.fields.length) return
    modal.fields[fieldIndex].value = value
    modal.fields[fieldIndex].cursor = cursor
    modal.error = undefined
    this.requestRender()
  }

  private modalNextField(): void {
    const modal = this.state.modal
    if (!modal || modal.fields.length === 0) return
    modal.activeField = (modal.activeField + 1) % modal.fields.length
    this.requestRender()
  }

  private modalPrevField(): void {
    const modal = this.state.modal
    if (!modal || modal.fields.length === 0) return
    modal.activeField = (modal.activeField - 1 + modal.fields.length) % modal.fields.length
    this.requestRender()
  }

  private modalSelectUp(): void {
    const modal = this.state.modal
    if (!modal) return

    if (modal.listItems.length > 0) {
      modal.selectedIndex = Math.max(0, modal.selectedIndex - 1)
      this.requestRender()
      return
    }

    const field = modal.fields[modal.activeField]
    if (field?.options?.length) {
      const idx = field.options.indexOf(field.value)
      const prevIdx = idx <= 0 ? field.options.length - 1 : idx - 1
      field.value = field.options[prevIdx]
      field.cursor = field.value.length
      this.requestRender()
    }
  }

  private modalSelectDown(): void {
    const modal = this.state.modal
    if (!modal) return

    if (modal.listItems.length > 0) {
      modal.selectedIndex = Math.min(modal.listItems.length - 1, modal.selectedIndex + 1)
      this.requestRender()
      return
    }

    const field = modal.fields[modal.activeField]
    if (field?.options?.length) {
      const idx = field.options.indexOf(field.value)
      const nextIdx = idx < 0 || idx >= field.options.length - 1 ? 0 : idx + 1
      field.value = field.options[nextIdx]
      field.cursor = field.value.length
      this.requestRender()
    }
  }

  private submitModal(): void {
    const modal = this.state.modal
    if (!modal) return

    if (modal.type === 'spawn') {
      const name = modal.fields[0].value.trim()
      if (!name) {
        modal.error = 'Name is required'
        this.requestRender()
        return
      }
      const cli = modal.fields[1].value.trim() || undefined
      const model = modal.fields[2].value.trim() || undefined
      const preset = modal.fields[3].value.trim() || undefined
      this.state.modal = null
      void this.executeCommand(`spawn ${name}${cli ? ` --cli ${cli}` : ''}${model ? ` --model ${model}` : ''}${preset ? ` --preset ${preset}` : ''}`)
      return
    }

    if (modal.type === 'kill') {
      const agent = modal.listItems[modal.selectedIndex]
      if (!agent) return
      const name = agent.label
      this.state.modal = null
      void this.executeCommand(`kill ${name}`)
      return
    }

    if (modal.type === 'presets') {
      const preset = modal.listItems[modal.selectedIndex]
      if (!preset) return
      const name = preset.label
      this.openSpawnModal()
      const spawnModal = this.state.modal
      if (spawnModal) {
        const presetField = spawnModal.fields.find(f => f.label === 'Preset')
        if (presetField) {
          presetField.value = name
          presetField.cursor = name.length
        }
        this.requestRender()
      }
      return
    }
  }

  private cancelModal(): void {
    const modal = this.state.modal
    if (!modal) return
    const raw = modal.rawCommand
    this.state.modal = null
    if (raw) {
      this.openCommand(raw)
    } else {
      this.requestRender()
    }
  }

  private doRender(): void {
    this.state.termWidth = this.screen.cols
    this.state.termHeight = this.screen.rows
    renderLayout(this.screen, this.state)
    this.screen.flush()
  }

  private requestRender(): void {
    this.renderPending = true
    if (!this.renderFlushId) {
      this.renderFlushId = setImmediate(() => {
        this.renderFlushId = null
        if (this.renderPending) {
          this.renderPending = false
          this.doRender()
        }
      })
    }
  }

  private markActivity(): void {
    this.lastActivity = Date.now()
    if (!this.burstTimeout) {
      this.restartPolling()
    }
    if (this.burstTimeout) clearTimeout(this.burstTimeout)
    this.burstTimeout = setTimeout(() => {
      this.burstTimeout = null
      this.restartPolling()
    }, 2000)
  }
}
