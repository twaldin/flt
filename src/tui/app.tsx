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
import { spawnSync } from 'child_process'
import { execSync } from 'child_process'
import { listAdapters } from '../adapters/registry'
import { spawn } from '../commands/spawn'
import { kill } from '../commands/kill'

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

  // Direct tmux attach for insert mode — completely bypasses Ink for native typing
  const attachToAgent = (session: string) => {
    // Release stdin from Ink so tmux can use it
    const wasRaw = process.stdin.isRaw
    process.stdin.setRawMode(false)
    process.stdin.pause()

    // Exit Ink's alternate screen buffer, show cursor
    process.stdout.write('\x1b[?1049l\x1b[?25h')
    process.stdout.write(`\r\n  Attached to ${session}. Detach with your tmux prefix + d\r\n\r\n`)

    // Block everything — user types directly in tmux with zero latency
    try {
      execSync(`tmux attach-session -t '${session}'`, {
        stdio: 'inherit',
        env: { ...process.env, TMUX: '' },
      })
    } catch {
      // tmux attach returns non-zero if session dies during attach
    }

    // User detached — reclaim stdin for Ink
    process.stdin.resume()
    if (wasRaw) process.stdin.setRawMode(true)

    // Re-enter Ink's alternate screen, hide cursor
    process.stdout.write('\x1b[?1049h\x1b[?25l')

    // Force re-render with fresh content
    dispatch({ type: 'SET_MODE', mode: 'log-focus' })
  }

  useInput((input, key) => {
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
      if (input === 'i' && selectedAgent) {
        attachToAgent(selectedAgent.tmuxSession)
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
    } else if (parsed.cmd === 'spawn' && parsed.args.length >= 1) {
      // Parse: spawn <name> --cli <cli> --model <model> --dir <dir> <bootstrap...>
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
          // Everything else is bootstrap message
          messageTokens.push(spawnArgs[i])
          i++
        }
      }

      const bootstrap = messageTokens.join(' ') || undefined
      dispatch({ type: 'SET_BANNER', banner: { text: `Spawning ${name} (${cli}/${model || 'default'})...`, color: 'yellow' } })
      // Timeout: clear banner after 65s if spawn hangs
      const bannerTimeout = setTimeout(() => {
        dispatch({ type: 'SET_BANNER', banner: { text: `Spawn ${name}: still waiting (check flt logs ${name})`, color: 'yellow' } })
      }, 65000)
      spawn({ name, cli, model, dir, bootstrap })
        .then(() => {
          clearTimeout(bannerTimeout)
          dispatch({ type: 'SET_BANNER', banner: { text: `Spawned ${name}`, color: 'green' } })
          setTimeout(() => dispatch({ type: 'SET_BANNER', banner: null }), 3000)
        })
        .catch((e: Error) => {
          clearTimeout(bannerTimeout)
          dispatch({ type: 'SET_BANNER', banner: { text: `Spawn failed: ${e.message}`, color: 'red' } })
          setTimeout(() => dispatch({ type: 'SET_BANNER', banner: null }), 5000)
        })
    } else if (parsed.cmd === 'kill' && parsed.args.length >= 1) {
      const name = parsed.args[0]
      try {
        kill({ name })
        dispatch({ type: 'SET_BANNER', banner: { text: `Killed ${name}`, color: 'green' } })
        setTimeout(() => dispatch({ type: 'SET_BANNER', banner: null }), 3000)
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        dispatch({ type: 'SET_BANNER', banner: { text: `Kill failed: ${msg}`, color: 'red' } })
        setTimeout(() => dispatch({ type: 'SET_BANNER', banner: null }), 5000)
      }
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
              focused={state.mode === 'log-focus'}
              scrollOffset={state.logScrollOffset}
              searchQuery={state.searchQuery}
              autoFollow={state.autoFollow}
            />
          ) : (
            <Box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center">
              <Text color="gray">No agent selected</Text>
            </Box>
          )
        }
        footer={
          <Box flexDirection="column" width="100%">
            {state.banner && (
              <Box paddingX={1} height={1}>
                <Text color={state.banner.color} bold>{state.banner.text}</Text>
              </Box>
            )}
            <CommandBar
              active={state.mode === 'command'}
              onSubmit={handleCommandSubmit}
              onCancel={() => dispatch({ type: 'SET_MODE', mode: 'normal' })}
              initialValue={state.commandInput}
              agentNames={state.agents.map(a => a.name)}
              cliAdapters={listAdapters()}
            />
            <StatusBar mode={state.mode} agentCount={state.agents.length} selectedAgent={selectedAgent?.name} />
          </Box>
        }
      />
    </Box>
  )
}
