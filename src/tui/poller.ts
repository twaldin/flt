import { useEffect, useRef, useCallback } from 'react'
import { allAgents } from '../state'
import { hasSession, capturePane, resizeWindow } from '../tmux'
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

// Stable hash for comparing agent lists without deep equality
function agentsHash(agents: AgentView[]): string {
  return agents.map(a => `${a.name}:${a.status}:${a.cli}:${a.model}`).join('|')
}

export function useFleetPoller(
  state: TuiState,
  dispatch: (action: TuiAction) => void,
  selectedAgent: string | undefined
) {
  // Use refs so the interval callback always has current values
  // without needing to re-create the interval
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

    for (const [name, agentState] of Object.entries(agents)) {
      const isRecent = Date.now() - new Date(agentState.spawnedAt).getTime() < 10000
      const status = isRecent ? 'spawning' : hasSession(agentState.tmuxSession) ? 'running' : 'exited'

      agentViews.push({
        name,
        status: status as 'spawning' | 'ready' | 'running' | 'exited' | 'error',
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
          const leftPanelWidth = Math.floor(st.termWidth * 0.28)
          const logPaneWidth = Math.max(40, st.termWidth - leftPanelWidth - 4)
          const logPaneHeight = Math.max(10, st.termHeight - 5)
          resizeWindow(agent.tmuxSession, logPaneWidth, logPaneHeight)

          const content = capturePane(agent.tmuxSession, Math.max(200, logPaneHeight * 3))
          // Only dispatch if content actually changed
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

    // Read inbox (only on slow poll, not every 100ms)
    if (st.mode !== 'insert') {
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

  // Set up interval — only recreate when poll rate changes
  useEffect(() => {
    const pollMs = state.mode === 'insert' ? 100 : 1000
    const interval = setInterval(poll, pollMs)
    // Run immediately on mount and mode change
    poll()
    return () => clearInterval(interval)
  }, [state.mode === 'insert', poll])

  // Reset content cache when selected agent changes
  useEffect(() => {
    lastContentRef.current = ''
  }, [selectedAgent])
}
