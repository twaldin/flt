import React, { useEffect } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { useTuiStore } from './store'
import { useFleetPoller } from './poller'
import { Layout } from './layout'
import { AgentList } from './components/agent-list'
import { LogPane } from './components/log-pane'
import { CommandBar } from './components/command-bar'
import { StatusBar } from './components/status-bar'
import { getActionForKey } from './keybindings'
import { parseCommand } from './command-parser'
import { send } from '../commands/send'

export function App(): React.ReactElement {
  const [state, dispatch] = useTuiStore()
  const { stdout } = useStdout()

  // Keep termHeight in sync with actual terminal size
  useEffect(() => {
    const update = () => dispatch({ type: 'SET_TERM_HEIGHT', height: stdout?.rows ?? 24 })
    update()
    stdout?.on('resize', update)
    return () => { stdout?.off('resize', update) }
  }, [stdout, dispatch])

  useFleetPoller(state, dispatch, state.agents[state.selectedIndex]?.name)

  // Handle keyboard input via Ink's useInput hook
  useInput((input, key) => {
    if (state.mode === 'normal') {
      // Normal mode
      if (input === 'j') dispatch({ type: 'SELECT_NEXT' })
      else if (input === 'k') dispatch({ type: 'SELECT_PREV' })
      else if (input === ':') dispatch({ type: 'SET_MODE', mode: 'command' })
      else if (input === 'q') process.exit(0)
      else if (key.return) dispatch({ type: 'SET_MODE', mode: 'log-focus' })
    } else if (state.mode === 'log-focus') {
      // Log focus mode
      if (input === 'j') dispatch({ type: 'SCROLL_LOG_DOWN' })
      else if (input === 'k') dispatch({ type: 'SCROLL_LOG_UP' })
      else if (key.ctrl && input === 'd') dispatch({ type: 'SCROLL_LOG_PAGE_DOWN' })
      else if (key.ctrl && input === 'u') dispatch({ type: 'SCROLL_LOG_PAGE_UP' })
      else if (input === 'G') dispatch({ type: 'JUMP_LOG_BOTTOM' })
      else if (input === 'g') {
        // For 'gg' we'd need to track state, simpler to just jump to top
        dispatch({ type: 'JUMP_LOG_TOP' })
      }
      else if (input === '/') dispatch({ type: 'SET_SEARCH_QUERY', query: '' })
      else if (key.escape) dispatch({ type: 'SET_MODE', mode: 'normal' })
    }
  })

  const selectedAgent = state.agents[state.selectedIndex]

  const handleCommandSubmit = async (commandStr: string) => {
    const parsed = parseCommand(`:${commandStr}`)
    if (!parsed) {
      dispatch({ type: 'SET_MODE', mode: 'normal' })
      return
    }

    if (parsed.cmd === 'send' && parsed.args.length >= 2) {
      const target = parsed.args[0]
      const message = parsed.args.slice(1).join(' ')
      try {
        await send({ target, message })
      } catch (e) {
        console.error('Send failed:', e)
      }
    } else if (parsed.cmd === 'logs' && parsed.args.length >= 1) {
      // Find agent by name and select it
      const agentName = parsed.args[0]
      const idx = state.agents.findIndex((a) => a.name === agentName)
      if (idx !== -1) {
        dispatch({ type: 'SET_AGENTS', agents: state.agents })
        // Would need a SELECT_BY_NAME action, for now just use index
      }
    }

    dispatch({ type: 'SET_MODE', mode: 'normal' })
  }

  return (
    <Layout
      left={
        <AgentList
          agents={state.agents}
          selectedIndex={state.selectedIndex}
          onSelectPrev={() => dispatch({ type: 'SELECT_PREV' })}
          onSelectNext={() => dispatch({ type: 'SELECT_NEXT' })}
        />
      }
      right={
        selectedAgent ? (
          <LogPane
            content={state.logContent}
            focused={state.mode === 'log-focus'}
            scrollOffset={state.logScrollOffset}
            searchQuery={state.searchQuery}
          />
        ) : (
          <Box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center">
            <Text color="gray">No agent selected</Text>
          </Box>
        )
      }
      footer={
        <Box flexDirection="column" width="100%">
          <CommandBar
            visible={state.mode === 'command'}
            onSubmit={handleCommandSubmit}
            onCancel={() => dispatch({ type: 'SET_MODE', mode: 'normal' })}
          />
          <StatusBar mode={state.mode} agentCount={state.agents.length} selectedAgent={selectedAgent?.name} />
        </Box>
      }
    />
  )
}
