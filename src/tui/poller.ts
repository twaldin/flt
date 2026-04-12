import { useEffect, useRef } from 'react'
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

export function useFleetPoller(
  state: TuiState,
  dispatch: (action: TuiAction) => void,
  selectedAgent: string | undefined
) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // 100ms in insert mode for responsive typing, 1000ms otherwise
    const pollMs = state.mode === 'insert' ? 100 : 1000

    if (intervalRef.current) clearInterval(intervalRef.current)

    intervalRef.current = setInterval(() => {
      const agents = allAgents()
      const agentViews: AgentView[] = []

      for (const [name, agentState] of Object.entries(agents)) {
        const hasExistingStatus = state.agents.find(a => a.name === name)
        const isRecent = Date.now() - new Date(agentState.spawnedAt).getTime() < 10000
        const status = isRecent ? 'spawning' : hasSession(agentState.tmuxSession) ? 'running' : 'exited'

        agentViews.push({
          name,
          status: status as 'spawning' | 'ready' | 'running' | 'exited' | 'error',
          lastSeen: hasExistingStatus?.lastSeen || Date.now(),
          ...agentState,
        })
      }

      dispatch({ type: 'SET_AGENTS', agents: agentViews })

      // Capture pane for selected agent
      if (selectedAgent && agentViews.some(a => a.name === selectedAgent)) {
        const agent = agents[selectedAgent]
        if (agent) {
          try {
            const leftPanelWidth = Math.floor(state.termWidth * 0.28)
            const logPaneWidth = Math.max(40, state.termWidth - leftPanelWidth - 4)
            const logPaneHeight = Math.max(10, state.termHeight - 5)
            resizeWindow(agent.tmuxSession, logPaneWidth, logPaneHeight)

            const content = capturePane(agent.tmuxSession, Math.max(200, logPaneHeight * 3))
            dispatch({ type: 'SET_LOG_CONTENT', content })
          } catch {
            dispatch({ type: 'SET_LOG_CONTENT', content: '[error reading pane]' })
          }
        }
      }

      // Read inbox (only on slow poll, not every 100ms)
      if (state.mode !== 'insert') {
        try {
          const inboxPath = getInboxPath()
          if (existsSync(inboxPath)) {
            const raw = readFileSync(inboxPath, 'utf-8')
            const messages = parseInbox(raw)
            dispatch({ type: 'SET_INBOX', messages })
          }
        } catch {}
      }
    }, pollMs)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [state.mode, state.termWidth, state.termHeight, selectedAgent])
}
