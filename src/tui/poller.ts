import { useEffect, useRef, useCallback } from 'react'
import { allAgents } from '../state'
import { hasSession, capturePane, resizeWindow, sendKeys } from '../tmux'
import { resolveAdapter } from '../adapters/registry'
import { readFileSync, existsSync } from 'fs'
import { TuiState, TuiAction, AgentView, InboxMessage } from './types'
import { getInboxPath } from '../commands/init'

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
  return agents.map(a => `${a.name}:${a.status}:${a.cli}:${a.model}`).join('|')
}

function detectAgentStatus(agentState: { cli: string; tmuxSession: string }): string {
  try {
    const adapter = resolveAdapter(agentState.cli)
    const pane = capturePane(agentState.tmuxSession, 30)
    const status = adapter.detectStatus(pane)

    // Auto-approve permission dialogs — send Enter to unblock
    if (status === 'dialog') {
      const keys = adapter.handleDialog(pane)
      if (keys) {
        sendKeys(agentState.tmuxSession, keys)
      } else {
        sendKeys(agentState.tmuxSession, ['Enter'])
      }
      return 'running'
    }

    return status
  } catch {
    return 'unknown'
  }
}

export function useFleetPoller(
  state: TuiState,
  dispatch: (action: TuiAction) => void,
  selectedAgent: string | undefined
) {
  const stateRef = useRef(state)
  const dispatchRef = useRef(dispatch)
  const selectedRef = useRef(selectedAgent)
  const lastContentRef = useRef('')
  const lastAgentsHashRef = useRef('')
  const lastInboxRef = useRef('')

  stateRef.current = state
  dispatchRef.current = dispatch
  selectedRef.current = selectedAgent

  const poll = useCallback(() => {
    const st = stateRef.current
    const dp = dispatchRef.current
    const sel = selectedRef.current

    const agents = allAgents()
    const agentViews: AgentView[] = []

    const isInsert = st.mode === 'insert'

    for (const [name, agentState] of Object.entries(agents)) {
      const isRecent = Date.now() - new Date(agentState.spawnedAt).getTime() < 10000
      let status: string
      if (isRecent) {
        status = 'spawning'
      } else if (!hasSession(agentState.tmuxSession)) {
        status = 'exited'
      } else if (isInsert) {
        // Skip expensive detectStatus during insert mode
        const existing = st.agents.find(a => a.name === name)
        status = existing?.status ?? 'running'
      } else {
        status = detectAgentStatus(agentState)
      }

      agentViews.push({
        name,
        status: status as AgentView['status'],
        lastSeen: Date.now(),
        ...agentState,
      })
    }

    const hash = agentsHash(agentViews)
    if (hash !== lastAgentsHashRef.current) {
      lastAgentsHashRef.current = hash
      dp({ type: 'SET_AGENTS', agents: agentViews })
    }

    // Detect our own session — can't capture the TUI's own pane
    const selfName = process.env.FLT_AGENT_NAME
    const selfSession = selfName ? `flt-${selfName}` : null

    if (sel && agentViews.some(a => a.name === sel)) {
      const agent = agents[sel]
      if (agent && agent.tmuxSession === selfSession) {
        const selfMsg = `This is you (${sel}) — the flt TUI is running in this session.\n\nSelect another agent to view its output.`
        if (lastContentRef.current !== selfMsg) {
          lastContentRef.current = selfMsg
          dp({ type: 'SET_LOG_CONTENT', content: selfMsg })
        }
      } else if (agent) {
        try {
          const logPaneHeight = Math.max(10, st.termHeight - 5)
          if (!isInsert) {
            const leftPanelWidth = Math.floor(st.termWidth * 0.28)
            const logPaneWidth = Math.max(40, st.termWidth - leftPanelWidth - 4)
            resizeWindow(agent.tmuxSession, logPaneWidth, logPaneHeight)
          }

          const content = capturePane(agent.tmuxSession, Math.max(200, logPaneHeight * 3))
          if (content !== lastContentRef.current) {
            lastContentRef.current = content
            dp({ type: 'SET_LOG_CONTENT', content })
          }
        } catch {
          if (lastContentRef.current !== '[error reading pane]') {
            lastContentRef.current = '[error reading pane]'
            dp({ type: 'SET_LOG_CONTENT', content: '[error reading pane]' })
          }
        }
      }
    }

    try {
      const inboxPath = getInboxPath()
      if (existsSync(inboxPath)) {
        const raw = readFileSync(inboxPath, 'utf-8')
        if (raw !== lastInboxRef.current) {
          lastInboxRef.current = raw
          dp({ type: 'SET_INBOX', messages: parseInbox(raw) })
        }
      }
    } catch {}
  }, [])

  useEffect(() => {
    // In insert mode, capture at 500ms. Optimistic buffer gives instant
    // visual feedback; capture replaces it with real content.
    const pollMs = state.mode === 'insert' ? 500 : 1000
    const interval = setInterval(poll, pollMs)
    poll()
    return () => clearInterval(interval)
  }, [state.mode === 'insert', poll])

  useEffect(() => {
    lastContentRef.current = ''
  }, [selectedAgent])
}
