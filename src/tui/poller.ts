import { useEffect } from 'react'
import { allAgents } from '../state'
import { hasSession, capturePane, resizeWindow } from '../tmux'
import { TuiState, TuiAction, AgentView } from './types'

export function useFleetPoller(
  state: TuiState,
  dispatch: (action: TuiAction) => void,
  selectedAgent: string | undefined
) {
  useEffect(() => {
    const interval = setInterval(() => {
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

      dispatch({
        type: 'SET_AGENTS',
        agents: agentViews,
      })

      // Capture pane for selected agent
      if (selectedAgent && agentViews.some(a => a.name === selectedAgent)) {
        const agent = agents[selectedAgent]
        if (agent) {
          try {
            // Resize the agent's tmux window to match the TUI log pane dimensions.
            // This makes the agent CLI wrap its output at the correct width.
            const leftPanelWidth = Math.floor(state.termWidth * 0.28)
            // Log pane width: total width minus left panel, minus borders (4 chars)
            const logPaneWidth = Math.max(40, state.termWidth - leftPanelWidth - 4)
            const logPaneHeight = Math.max(10, state.termHeight - 5)
            resizeWindow(agent.tmuxSession, logPaneWidth, logPaneHeight)

            // Capture enough lines to fill the view plus scrollback
            const content = capturePane(agent.tmuxSession, Math.max(200, logPaneHeight * 3))
            dispatch({ type: 'SET_LOG_CONTENT', content })
          } catch {
            dispatch({ type: 'SET_LOG_CONTENT', content: '[error reading pane]' })
          }
        }
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [state, dispatch, selectedAgent])
}
