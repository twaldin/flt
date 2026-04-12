import { existsSync, readFileSync } from 'fs'
import { resolveAdapter, listAdapters } from '../adapters/registry'
import { kill } from '../commands/kill'
import { send } from '../commands/send'
import { spawn } from '../commands/spawn'
import { allAgents, type AgentState } from '../state'
import { capturePane, flushBatchedKeys, hasSession, resizeWindow, sendKeysAsync, sendLiteralBatched } from '../tmux'
import { getInboxPath } from '../commands/init'
import { parseCommand, enrichMessageWithFiles } from './command-parser'
import { setupInput, type InputBindings, type TmuxInsertKey } from './input'
import { calculateLayout, renderLayout } from './panels'
import { Screen } from './screen'
import { createInitialState, type AgentView, type AppState, type InboxMessage, type Mode } from './types'

function parseInbox(content: string): InboxMessage[] {
  const messages: InboxMessage[] = []
  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    const match = line.match(/^\[(\S+)\]\s+(\S+):\s+(.+)$/)
    if (match) {
      messages.push({ timestamp: match[1], from: match[2], text: match[3] })
    }
  }
  return messages
}

function agentsHash(agents: AgentView[]): string {
  return agents.map((a) => `${a.name}:${a.status}:${a.cli}:${a.model}`).join('|')
}

function detectAgentStatus(agentState: AgentState): AgentView['status'] {
  try {
    const adapter = resolveAdapter(agentState.cli)
    const pane = capturePane(agentState.tmuxSession, 20)
    return adapter.detectStatus(pane)
  } catch {
    return 'unknown'
  }
}

export class App {
  screen: Screen
  state: AppState

  private pollTimer: ReturnType<typeof setInterval> | null = null
  private cleanupInput: (() => void) | null = null

  private lastAgentsHash = ''
  private lastLogContent = ''
  private lastInboxRaw = ''
  private lastSelectedName: string | undefined
  private bannerTimer: ReturnType<typeof setTimeout> | null = null
  private running = false

  constructor() {
    const cols = process.stdout.columns ?? 80
    const rows = process.stdout.rows ?? 24
    this.screen = new Screen(cols, rows)
    this.state = createInitialState(cols, rows)
  }

  start(): void {
    if (this.running) return
    this.running = true

    process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H')

    const bindings: InputBindings = {
      getState: () => ({ ...this.state, selectedAgent: this.selectedAgent }),
      getAgentNames: () => this.state.agents.map((a) => a.name),
      getCliAdapters: () => listAdapters(),
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
      setSearchQuery: (query) => this.setSearchQuery(query),
      submitCommand: (input) => this.submitCommand(input),
      sendInsertText: (text) => this.sendInsertText(text),
      sendInsertKey: (key) => this.sendInsertKey(key),
      flushInsert: () => this.flushInsert(),
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
    if (this.state.mode === mode) return
    this.state.mode = mode
    this.restartPolling()
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
    this.render()
  }

  private selectNext(): void {
    if (this.state.agents.length === 0) return
    this.state.selectedIndex = Math.min(this.state.agents.length - 1, this.state.selectedIndex + 1)
    this.lastLogContent = ''
    this.render()
  }

  private logViewHeight(): number {
    const layout = calculateLayout(this.state.termWidth, this.state.termHeight)
    return Math.max(1, layout.logInnerHeight - 1)
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
      let cli = 'claude-code'
      let model: string | undefined
      let dir: string | undefined
      const messageTokens: string[] = []

      let i = 1
      while (i < spawnArgs.length) {
        if (spawnArgs[i] === '--cli' && i + 1 < spawnArgs.length) {
          cli = spawnArgs[i + 1]
          i += 2
        } else if (spawnArgs[i] === '--model' && i + 1 < spawnArgs.length) {
          model = spawnArgs[i + 1]
          i += 2
        } else if (spawnArgs[i] === '--dir' && i + 1 < spawnArgs.length) {
          const raw = spawnArgs[i + 1]
          dir = raw.startsWith('~/') ? raw.replace('~', process.env.HOME || '') : raw
          i += 2
        } else {
          messageTokens.push(spawnArgs[i])
          i += 1
        }
      }

      const bootstrap = messageTokens.join(' ') || undefined
      this.setBanner(`Spawning ${name} (${cli}/${model || 'default'})...`, 'yellow')

      const staleTimer = setTimeout(() => {
        this.setBanner(`Spawn ${name}: still waiting (check flt logs ${name})`, 'yellow')
      }, 65000)

      spawn({ name, cli, model, dir, bootstrap })
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
        kill({ name })
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

    if (parsed.cmd === 'help') {
      this.setBanner('Commands: send, logs, spawn, kill, theme, help', 'cyan', 4000)
      return
    }

    if (parsed.cmd === 'theme') {
      this.setBanner('Theme command is reserved in TUI v2', 'yellow', 3000)
      return
    }

    this.setBanner(`Unknown command: ${parsed.cmd}`, 'red', 3000)
  }

  private sendInsertText(text: string): void {
    const selected = this.selectedAgent
    if (!selected || !text) return
    sendLiteralBatched(selected.tmuxSession, text)
  }

  private sendInsertKey(key: TmuxInsertKey): void {
    const selected = this.selectedAgent
    if (!selected) return
    sendKeysAsync(selected.tmuxSession, [key])
  }

  private flushInsert(): void {
    const selected = this.selectedAgent
    if (!selected) return
    flushBatchedKeys(selected.tmuxSession)
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

    for (const [name, agentState] of Object.entries(agents)) {
      const isRecent = Date.now() - new Date(agentState.spawnedAt).getTime() < 10000
      let status: AgentView['status']

      if (isRecent) {
        status = 'spawning'
      } else if (!hasSession(agentState.tmuxSession)) {
        status = 'exited'
      } else if (isInsert) {
        const existing = this.state.agents.find((a) => a.name === name)
        status = existing?.status ?? 'running'
      } else {
        status = detectAgentStatus(agentState)
      }

      nextViews.push({
        name,
        status,
        lastSeen: Date.now(),
        ...agentState,
      })
    }

    if (this.applyAgents(nextViews)) changed = true

    const selected = this.selectedAgent
    if (selected?.name !== this.lastSelectedName) {
      this.lastSelectedName = selected?.name
      this.lastLogContent = ''
    }

    const selfName = process.env.FLT_AGENT_NAME
    const selfSession = selfName ? `flt-${selfName}` : null

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
          const layout = calculateLayout(this.state.termWidth, this.state.termHeight)
          const paneWidth = Math.max(20, layout.logInnerWidth)
          const paneHeight = Math.max(10, layout.logInnerHeight)

          if (!isInsert) {
            resizeWindow(agent.tmuxSession, paneWidth, paneHeight)
          }

          const content = capturePane(agent.tmuxSession, Math.max(200, paneHeight * 3))
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
