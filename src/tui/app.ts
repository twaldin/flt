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
import { capturePane, capturePaneVisible, flushBatchedKeys, hasSession, resizeWindow, sendKeysAsync, sendLiteralBatched } from '../tmux'
import { getInboxPath } from '../commands/init'
import { parseCommand, enrichMessageWithFiles } from './command-parser'
import { setupInput, type InputBindings, type TmuxInsertKey } from './input'
import { getKeybindsBanner } from './keybinds'
import { calculateLayout, renderLayout } from './panels'
import { Screen } from './screen'
import { getCurrentThemeName, getThemeBackground, getThemeNames, setTheme } from './theme'
import { getAsciiLogo } from './ascii'
import { createInitialState, type AgentView, type AppState, type InboxMessage, type Mode } from './types'

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
    // New format: [HH:MM:SS] [SENDER]: message
    const tagMatch = line.match(/^\[(\S+)\]\s+\[([^\]]+)\]:\s+(.+)$/)
    if (tagMatch) {
      messages.push({ timestamp: tagMatch[1], from: tagMatch[2], text: tagMatch[3].replace(/\\n/g, '\n') })
      continue
    }
    // Legacy format: [HH:MM:SS] sender: message
    const legacyMatch = line.match(/^\[(\S+)\]\s+(\S+):\s+(.+)$/)
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
  private lastInboxRaw = ''
  private lastSelectedName: string | undefined
  private lastStatusByAgent: Record<string, string> = {}
  private lastResizedDims: Record<string, { width: number; height: number }> = {}
  // Status detection moved to controller poller — these are no longer needed
  private bannerTimer: ReturnType<typeof setTimeout> | null = null
  private insertCaptureTimer: ReturnType<typeof setTimeout> | null = null
  private running = false

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
      quit: () => {
        this.stop()
        process.exit(0)
      },
      onResize: () => this.resize(process.stdout.columns ?? this.screen.cols, process.stdout.rows ?? this.screen.rows),
    }

    this.cleanupInput = setupInput(bindings)

    this.render()
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

    if (this.cleanupInput) {
      this.cleanupInput()
      this.cleanupInput = null
    }

    // Clean up typing indicator
    try { unlinkSync(join(homedir(), '.flt', 'typing')) } catch {}

    process.stdout.write('\x1b[0m\x1b[?25h\x1b[?1049l')
  }

  resize(cols: number, rows: number): void {
    this.screen.resize(cols, rows)
    this.state.termWidth = cols
    this.state.termHeight = rows

    if (this.state.autoFollow) {
      this.state.logScrollOffset = this.maxScroll(this.state.logContent)
    } else {
      this.state.logScrollOffset = Math.min(this.state.logScrollOffset, this.maxScroll(this.state.logContent))
    }

    this.render()
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
    this.render()
  }

  private openShell(): void {
    if (!hasSession(this.shellSession)) {
      const cwd = process.cwd()
      const { createSession } = require('../tmux') as typeof import('../tmux')
      createSession(this.shellSession, cwd, process.env.SHELL || 'zsh', {})
    }
    const layout = calculateLayout(this.state.termWidth, this.state.termHeight, this.state.agents)
    resizeWindow(this.shellSession, Math.max(20, layout.logInnerWidth), Math.max(5, layout.logInnerHeight))
    this.state.mode = 'shell'
    this.captureShell() // immediate capture so content shows right away
    this.restartPolling()
    this.render()
  }

  private closeShell(): void {
    this.state.mode = 'normal'
    this.lastLogContent = '' // force re-capture of agent content
    this.restartPolling()
    this.poll() // immediate refresh
    this.render()
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
        this.render()
      }
    } catch {}
  }

  private setKillConfirm(agentName: string): void {
    this.state.mode = 'kill-confirm'
    this.state.killConfirmAgent = agentName
    this.render()
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
        this.render()
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e)
        this.setBanner(`Kill failed: ${msg}`, 'red', 5000)
        this.render()
      })
  }

  private cancelKill(): void {
    this.state.mode = 'normal'
    this.state.killConfirmAgent = undefined
    this.render()
  }

  private openCommand(initial: string): void {
    this.state.mode = 'command'
    this.state.commandInput = initial
    this.state.commandCursor = initial.length
    this.restartPolling()
    this.render()
  }

  private setCommand(input: string, cursor: number): void {
    this.state.commandInput = input
    this.state.commandCursor = cursor
    this.render()
  }

  private selectPrev(): void {
    if (this.state.agents.length === 0) return
    this.state.selectedIndex = Math.max(0, this.state.selectedIndex - 1)
    this.lastLogContent = ''
    const selected = this.selectedAgent
    if (selected) delete this.state.notifications[selected.name]
    this.sidebarScrollSync()
    this.render()
  }

  private selectNext(): void {
    if (this.state.agents.length === 0) return
    this.state.selectedIndex = Math.min(this.state.agents.length - 1, this.state.selectedIndex + 1)
    this.lastLogContent = ''
    const selected = this.selectedAgent
    if (selected) delete this.state.notifications[selected.name]
    this.sidebarScrollSync()
    this.render()
  }

  private sidebarVisibleCount(): number {
    const layout = calculateLayout(this.state.termWidth, this.state.termHeight, this.state.agents)
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
    this.render()
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
    const layout = calculateLayout(this.state.termWidth, this.state.termHeight, this.state.agents)
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
      // Pre-capture the scrollback so offset is relative to the full content.
      const agent = this.selectedAgent
      if (agent) {
        try {
          const full = capturePane(agent.tmuxSession, Math.max(200, (this.state.termHeight - 5) * 3))
          this.state.logContent = full
          this.lastLogContent = full
          this.state.logScrollOffset = this.maxScroll(full)
        } catch {}
      }
    }
    this.state.logScrollOffset = Math.max(0, this.state.logScrollOffset - 1)
    this.state.autoFollow = false
    this.render()
  }

  private scrollLogDown(): void {
    const max = this.maxScroll(this.state.logContent)
    this.state.logScrollOffset = Math.min(max, this.state.logScrollOffset + 1)
    this.state.autoFollow = this.state.logScrollOffset >= max
    this.render()
  }

  private scrollLogPageUp(): void {
    if (this.state.autoFollow) {
      const agent = this.selectedAgent
      if (agent) {
        try {
          const full = capturePane(agent.tmuxSession, Math.max(200, (this.state.termHeight - 5) * 3))
          this.state.logContent = full
          this.lastLogContent = full
          this.state.logScrollOffset = this.maxScroll(full)
        } catch {}
      }
    }
    const page = Math.max(1, Math.floor(this.logViewHeight() / 2))
    this.state.logScrollOffset = Math.max(0, this.state.logScrollOffset - page)
    this.state.autoFollow = false
    this.render()
  }

  private scrollLogPageDown(): void {
    const max = this.maxScroll(this.state.logContent)
    const page = Math.max(1, Math.floor(this.logViewHeight() / 2))
    this.state.logScrollOffset = Math.min(max, this.state.logScrollOffset + page)
    this.state.autoFollow = this.state.logScrollOffset >= max
    this.render()
  }

  private jumpLogTop(): void {
    this.state.logScrollOffset = 0
    this.state.autoFollow = false
    this.render()
  }

  private jumpLogBottom(): void {
    this.state.logScrollOffset = this.maxScroll(this.state.logContent)
    this.state.autoFollow = true
    this.render()
  }

  private inboxMsgDown(): void {
    const max = Math.max(0, this.state.inboxMessages.length - 1)
    this.state.inboxSelectedMsg = Math.min(max, this.state.inboxSelectedMsg + 1)
    this.render()
  }

  private inboxMsgUp(): void {
    this.state.inboxSelectedMsg = Math.max(0, this.state.inboxSelectedMsg - 1)
    this.render()
  }

  private inboxDeleteCard(): void {
    const idx = this.state.inboxSelectedMsg
    if (idx < 0 || idx >= this.state.inboxMessages.length) return
    this.state.inboxMessages = this.state.inboxMessages.filter((_, i) => i !== idx)
    this.rewriteInbox()
    this.state.inboxSelectedMsg = Math.min(idx, Math.max(0, this.state.inboxMessages.length - 1))
    this.render()
  }

  private inboxClearAll(): void {
    this.state.inboxMessages = []
    this.rewriteInbox()
    this.state.inboxSelectedMsg = 0
    this.render()
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
    this.render()
  }

  private setBanner(text: string, color: string, clearAfterMs?: number): void {
    if (this.bannerTimer) {
      clearTimeout(this.bannerTimer)
      this.bannerTimer = null
    }

    this.state.banner = { text, color }
    this.render()

    if (clearAfterMs) {
      this.bannerTimer = setTimeout(() => {
        this.state.banner = null
        this.render()
      }, clearAfterMs)
    }
  }

  private clearBanner(): void {
    if (this.bannerTimer) {
      clearTimeout(this.bannerTimer)
      this.bannerTimer = null
    }
    this.state.banner = null
    this.render()
  }

  private submitCommand(input: string): void {
    const command = input.trim()
    this.state.mode = 'normal'
    this.restartPolling()
    this.render()

    if (!command) return

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

      spawn({ name, cli, preset, model, dir, bootstrap, persistent, worktree, parent })
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
        this.render()
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
    const selected = this.selectedAgent
    if (!selected || !text) return
    sendLiteralBatched(selected.tmuxSession, text)
    this.scheduleInsertCapture()
  }

  private sendInsertKey(key: TmuxInsertKey): void {
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
      // In insert mode we're always auto-following — capture visible pane only
      const raw = this.state.autoFollow
        ? capturePaneVisible(agent.tmuxSession)
        : capturePane(agent.tmuxSession, Math.max(200, (this.state.termHeight - 5) * 3))
      const content = stripOsc8(raw)
      if (content !== this.lastLogContent) {
        this.lastLogContent = content
        this.state.logContent = content
        if (this.state.autoFollow) {
          this.state.logScrollOffset = this.maxScroll(content)
        }
        this.render()
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
    const pollMs = this.state.mode === 'insert' ? 500 : 1000
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

    const agents = allAgents()
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
      if (changed) this.render()
      return
    }

    // Keep :presets list visible until user exits the presets view.
    if (this.state.mode === 'presets') {
      if (changed) this.render()
      return
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
          const layout = calculateLayout(this.state.termWidth, this.state.termHeight, this.state.agents)
          const paneWidth = Math.max(20, layout.logInnerWidth)
          const paneHeight = Math.max(10, layout.logInnerHeight)

          if (!isInsert) {
            const last = this.lastResizedDims[agent.tmuxSession]
            if (!last || last.width !== paneWidth || last.height !== paneHeight) {
              resizeWindow(agent.tmuxSession, paneWidth, paneHeight)
              this.lastResizedDims[agent.tmuxSession] = { width: paneWidth, height: paneHeight }
            }
          }

          // In auto-follow: capture only the visible pane (no scrollback).
          // This gives exactly paneHeight rows — a 1:1 match with the tmux pane.
          // When scrolled up: capture with scrollback for history.
          const content = stripOsc8(this.state.autoFollow
            ? capturePaneVisible(agent.tmuxSession)
            : capturePane(agent.tmuxSession, Math.max(200, paneHeight * 3)))
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
      this.render()
    }
  }

  render(): void {
    this.state.termWidth = this.screen.cols
    this.state.termHeight = this.screen.rows
    renderLayout(this.screen, this.state)
    this.screen.flush()
  }
}
