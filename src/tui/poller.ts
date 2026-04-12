import { useEffect } from 'react'
import { allAgents, loadState } from '../state'
import { hasSession, capturePane } from '../tmux'
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
            const content = capturePane(agent.tmuxSession, 100)
            dispatch({ type: 'SET_LOG_CONTENT', content })
          } catch (e) {
            dispatch({ type: 'SET_LOG_CONTENT', content: '[error reading pane]' })
          }
        }
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [state, dispatch, selectedAgent])
}
