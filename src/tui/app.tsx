import React, { useEffect } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { useTuiStore } from './store'
import { useFleetPoller } from './poller'
import { Layout } from './layout'
import { AgentList } from './components/agent-list'
import { LogPane } from './components/log-pane'
import { CommandBar } from './components/command-bar'
import { StatusBar } from './components/status-bar'
import { InboxPanel } from './components/inbox-panel'
import { parseCommand, enrichMessageWithFiles } from './command-parser'
import { send } from '../commands/send'
import { sendKeys, sendLiteral } from '../tmux'

export function App(): React.ReactElement {
  const [state, dispatch] = useTuiStore()
  const { stdout } = useStdout()

  useEffect(() => {
    const update = () => dispatch({ type: 'SET_TERM_SIZE', height: stdout?.rows ?? 24, width: stdout?.columns ?? 80 })
    update()
    stdout?.on('resize', update)
    return () => { stdout?.off('resize', update) }
  }, [stdout, dispatch])

  useFleetPoller(state, dispatch, state.agents[state.selectedIndex]?.name)

  const selectedAgent = state.agents[state.selectedIndex]

  useInput((input, key) => {
    // Insert mode — forward keystrokes to agent's tmux session
    if (state.mode === 'insert') {
      if (key.escape) {
        dispatch({ type: 'SET_MODE', mode: 'log-focus' })
        return
      }

      if (!selectedAgent) return
      const session = selectedAgent.tmuxSession

      if (key.return) {
        sendKeys(session, ['Enter'])
      } else if (key.backspace || key.delete) {
        sendKeys(session, ['BSpace'])
      } else if (key.tab) {
        sendKeys(session, ['Tab'])
      } else if (key.upArrow) {
        sendKeys(session, ['Up'])
      } else if (key.downArrow) {
        sendKeys(session, ['Down'])
      } else if (key.leftArrow) {
        sendKeys(session, ['Left'])
      } else if (key.rightArrow) {
        sendKeys(session, ['Right'])
      } else if (key.ctrl && input === 'c') {
        sendKeys(session, ['C-c'])
      } else if (key.ctrl && input === 'z') {
        sendKeys(session, ['C-z'])
      } else if (key.ctrl && input === 'l') {
        sendKeys(session, ['C-l'])
      } else if (input) {
        sendLiteral(session, input)
      }
      return
    }

    // Inbox mode
    if (state.mode === 'inbox') {
      if (key.escape) {
        dispatch({ type: 'SET_MODE', mode: 'normal' })
      } else if (input === 'r' && state.inboxMessages.length > 0) {
        const lastSender = state.inboxMessages[state.inboxMessages.length - 1].from
        dispatch({ type: 'SET_COMMAND_INPUT', input: `send ${lastSender} ` })
        dispatch({ type: 'SET_MODE', mode: 'command' })
      }
      return
    }

    // Normal mode
    if (state.mode === 'normal') {
      if (input === 'j') dispatch({ type: 'SELECT_NEXT' })
      else if (input === 'k') dispatch({ type: 'SELECT_PREV' })
      else if (input === ':') dispatch({ type: 'SET_MODE', mode: 'command' })
      else if (input === 'm') dispatch({ type: 'SET_MODE', mode: 'inbox' })
      else if (input === 'r' && selectedAgent) {
        dispatch({ type: 'SET_COMMAND_INPUT', input: `send ${selectedAgent.name} ` })
        dispatch({ type: 'SET_MODE', mode: 'command' })
      }
      else if (input === 'q') process.exit(0)
      else if (key.return || key.tab) dispatch({ type: 'SET_MODE', mode: 'log-focus' })
      return
    }

    // Log focus mode
    if (state.mode === 'log-focus') {
      if (input === 'i') {
        dispatch({ type: 'JUMP_LOG_BOTTOM' })
        dispatch({ type: 'SET_MODE', mode: 'insert' })
      }
      else if (input === 'j') dispatch({ type: 'SCROLL_LOG_DOWN' })
      else if (input === 'k') dispatch({ type: 'SCROLL_LOG_UP' })
      else if (key.ctrl && input === 'd') dispatch({ type: 'SCROLL_LOG_PAGE_DOWN' })
      else if (key.ctrl && input === 'u') dispatch({ type: 'SCROLL_LOG_PAGE_UP' })
      else if (input === 'G') dispatch({ type: 'JUMP_LOG_BOTTOM' })
      else if (input === 'g') dispatch({ type: 'JUMP_LOG_TOP' })
      else if (input === '/') dispatch({ type: 'SET_SEARCH_QUERY', query: '' })
      else if (input === 'r' && selectedAgent) {
        dispatch({ type: 'SET_COMMAND_INPUT', input: `send ${selectedAgent.name} ` })
        dispatch({ type: 'SET_MODE', mode: 'command' })
      }
      else if (key.escape) dispatch({ type: 'SET_MODE', mode: 'normal' })
      return
    }
  })

  const handleCommandSubmit = async (commandStr: string) => {
    const parsed = parseCommand(`:${commandStr}`)
    if (!parsed) {
      dispatch({ type: 'SET_MODE', mode: 'normal' })
      return
    }

    if (parsed.cmd === 'send' && parsed.args.length >= 2) {
      const target = parsed.args[0]
      const rawMessage = parsed.args.slice(1).join(' ')
      const message = enrichMessageWithFiles(rawMessage)
      try {
        await send({ target, message })
      } catch {}
    } else if (parsed.cmd === 'logs' && parsed.args.length >= 1) {
      const agentName = parsed.args[0]
      const idx = state.agents.findIndex((a) => a.name === agentName)
      if (idx !== -1) {
        dispatch({ type: 'SET_AGENTS', agents: state.agents })
      }
    }

    dispatch({ type: 'SET_MODE', mode: 'normal' })
  }

  return (
    <Box flexDirection="column" width="100%" height="100%">
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
          state.mode === 'inbox' ? (
            <InboxPanel
              messages={state.inboxMessages}
              onClose={() => dispatch({ type: 'SET_MODE', mode: 'normal' })}
              onReply={(name) => {
                dispatch({ type: 'SET_COMMAND_INPUT', input: `send ${name} ` })
                dispatch({ type: 'SET_MODE', mode: 'command' })
              }}
            />
          ) : selectedAgent ? (
            <LogPane
              content={state.logContent}
              focused={state.mode === 'log-focus' || state.mode === 'insert'}
              scrollOffset={state.logScrollOffset}
              searchQuery={state.searchQuery}
              autoFollow={state.autoFollow}
              insertMode={state.mode === 'insert'}
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
              initialValue={state.commandInput}
            />
            <StatusBar mode={state.mode} agentCount={state.agents.length} selectedAgent={selectedAgent?.name} />
          </Box>
        }
      />
    </Box>
  )
}
