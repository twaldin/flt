import { useEffect, useRef, useCallback } from 'react'
import { allAgents } from '../state'
import { hasSession, capturePane, resizeWindow } from '../tmux'
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
    const pane = capturePane(agentState.tmuxSession, 20)
    return adapter.detectStatus(pane)
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
  // Throttle renders in insert mode: capture fast, render slower
  const lastRenderTimeRef = useRef(0)

  stateRef.current = state
  dispatchRef.current = dispatch
  selectedRef.current = selectedAgent

  const poll = useCallback(() => {
    const st = stateRef.current
    const dp = dispatchRef.current
    const sel = selectedRef.current
    const isInsert = st.mode === 'insert'

    const agents = allAgents()
    const agentViews: AgentView[] = []

    for (const [name, agentState] of Object.entries(agents)) {
      const isRecent = Date.now() - new Date(agentState.spawnedAt).getTime() < 10000
      let status: string
      if (isRecent) {
        status = 'spawning'
      } else if (!hasSession(agentState.tmuxSession)) {
        status = 'exited'
      } else if (!isInsert) {
        // Use adapter's real status detection (idle/running/error/rate-limited)
        // Skip during insert mode to reduce execFileSync calls
        status = detectAgentStatus(agentState)
      } else {
        // In insert mode, keep last known status to avoid extra tmux calls
        const existing = st.agents.find(a => a.name === name)
        status = existing?.status ?? 'running'
      }

      agentViews.push({
        name,
        status: status as AgentView['status'],
        lastSeen: Date.now(),
        ...agentState,
      })
    }

    // Only dispatch if agents actually changed
    const hash = agentsHash(agentViews)
    if (hash !== lastAgentsHashRef.current) {
      lastAgentsHashRef.current = hash
      dp({ type: 'SET_AGENTS', agents: agentViews })
    }

    // Capture pane for selected agent
    if (sel && agentViews.some(a => a.name === sel)) {
      const agent = agents[sel]
      if (agent) {
        try {
          // Only resize on slow polls — not every 100ms in insert mode
          if (!isInsert) {
            const leftPanelWidth = Math.floor(st.termWidth * 0.28)
            const logPaneWidth = Math.max(40, st.termWidth - leftPanelWidth - 4)
            const logPaneHeight = Math.max(10, st.termHeight - 5)
            resizeWindow(agent.tmuxSession, logPaneWidth, logPaneHeight)
          }

          const content = capturePane(agent.tmuxSession, Math.max(200, (st.termHeight - 5) * 3))

          // Only dispatch if content changed
          if (content !== lastContentRef.current) {
            lastContentRef.current = content

            // In insert mode, throttle renders to ~250ms to prevent flicker
            if (isInsert) {
              const now = Date.now()
              if (now - lastRenderTimeRef.current >= 250) {
                lastRenderTimeRef.current = now
                dp({ type: 'SET_LOG_CONTENT', content })
              }
            } else {
              dp({ type: 'SET_LOG_CONTENT', content })
            }
          }
        } catch {
          if (lastContentRef.current !== '[error reading pane]') {
            lastContentRef.current = '[error reading pane]'
            dp({ type: 'SET_LOG_CONTENT', content: '[error reading pane]' })
          }
        }
      }
    }

    // Read inbox (only on slow poll)
    if (!isInsert) {
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
    }
  }, [])

  useEffect(() => {
    const pollMs = state.mode === 'insert' ? 100 : 1000
    const interval = setInterval(poll, pollMs)
    poll()
    return () => clearInterval(interval)
  }, [state.mode === 'insert', poll])

  useEffect(() => {
    lastContentRef.current = ''
    lastRenderTimeRef.current = 0
  }, [selectedAgent])
}
