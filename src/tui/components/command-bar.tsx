import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'

interface CommandBarProps {
  active: boolean
  onSubmit: (command: string) => void
  onCancel: () => void
  initialValue?: string
  agentNames: string[]
  cliAdapters: string[]
}

const COMMANDS = ['send', 'logs', 'spawn', 'kill', 'theme', 'help']

const SPAWN_FLAGS = ['--cli', '--model', '--dir']

const MODEL_SUGGESTIONS: Record<string, string[]> = {
  'claude-code': ['haiku', 'sonnet', 'opus'],
  'codex': ['o3', 'o4-mini', 'gpt-4.1', 'gpt-5.4-mini'],
  'gemini': ['gemini-2.5-pro', 'gemini-2.5-flash'],
  'aider': ['sonnet', 'opus', 'gpt-4.1', 'o3'],
  'opencode': ['gpt-5.3', 'gpt-5.4-mini', 'o3'],
  'swe-agent': ['sonnet', 'gpt-4.1'],
}

interface CompletionResult {
  completions: string[]
  currentToken: string
}

function getCompletions(input: string, agentNames: string[], cliAdapters: string[]): CompletionResult {
  const parts = input.split(/\s+/)
  const empty: CompletionResult = { completions: [], currentToken: '' }

  // Completing the command name
  if (parts.length <= 1) {
    const prefix = parts[0] || ''
    return {
      completions: COMMANDS.filter(c => c.startsWith(prefix) && c !== prefix),
      currentToken: prefix,
    }
  }

  const cmd = parts[0]

  // send/logs/kill — complete agent name at position 2
  if (['send', 'logs', 'kill'].includes(cmd) && parts.length === 2) {
    const prefix = parts[1]
    return {
      completions: agentNames.filter(n => n.startsWith(prefix) && n !== prefix),
      currentToken: prefix,
    }
  }

  // spawn — rich context-aware completion
  if (cmd === 'spawn') {
    const lastPart = parts[parts.length - 1]
    const prevPart = parts.length >= 2 ? parts[parts.length - 2] : ''

    // Position 2: agent name (no completion, user types freely)
    if (parts.length === 2) return empty

    // After a flag that expects a value
    if (prevPart === '--cli') {
      return {
        completions: cliAdapters.filter(a => a.startsWith(lastPart) && a !== lastPart),
        currentToken: lastPart,
      }
    }

    if (prevPart === '--model') {
      // Find which CLI was selected to suggest relevant models
      const cliIdx = parts.indexOf('--cli')
      const selectedCli = cliIdx !== -1 && cliIdx + 1 < parts.length ? parts[cliIdx + 1] : ''
      const models = MODEL_SUGGESTIONS[selectedCli] || Object.values(MODEL_SUGGESTIONS).flat().filter((v, i, a) => a.indexOf(v) === i)
      return {
        completions: models.filter(m => m.startsWith(lastPart) && m !== lastPart),
        currentToken: lastPart,
      }
    }

    // Completing a flag name
    if (lastPart.startsWith('-')) {
      // Don't suggest flags that are already used
      const usedFlags = parts.filter(p => p.startsWith('--'))
      const available = SPAWN_FLAGS.filter(f => !usedFlags.includes(f) && f.startsWith(lastPart) && f !== lastPart)
      return { completions: available, currentToken: lastPart }
    }

    // After the name (position 3+), suggest flags if not mid-value
    if (prevPart !== '--dir') {
      const usedFlags = parts.filter(p => p.startsWith('--'))
      const available = SPAWN_FLAGS.filter(f => !usedFlags.includes(f))
      if (available.length > 0 && lastPart === '') {
        return { completions: available, currentToken: '' }
      }
    }
  }

  return empty
}

function applyCompletion(input: string, completion: string): string {
  const parts = input.split(/\s+/)
  if (parts.length <= 1) {
    return completion + ' '
  }
  parts[parts.length - 1] = completion
  return parts.join(' ') + ' '
}

export function CommandBar({ active, onSubmit, onCancel, initialValue, agentNames, cliAdapters }: CommandBarProps): React.ReactElement {
  const [input, setInput] = useState(initialValue || '')
  const [hint, setHint] = useState('')
  const [multiHint, setMultiHint] = useState('')

  useEffect(() => {
    if (active && initialValue) {
      setInput(initialValue)
    } else if (!active) {
      setInput('')
      setHint('')
      setMultiHint('')
    }
  }, [active, initialValue])

  // Update completion hint as user types
  useEffect(() => {
    if (!active) {
      setHint('')
      setMultiHint('')
      return
    }
    const { completions, currentToken } = getCompletions(input, agentNames, cliAdapters)
    if (completions.length === 1) {
      const remaining = completions[0].slice(currentToken.length)
      setHint(remaining)
      setMultiHint('')
    } else if (completions.length > 1 && completions.length <= 6) {
      setHint('')
      setMultiHint(completions.join(' | '))
    } else {
      setHint('')
      setMultiHint('')
    }
  }, [input, active, agentNames, cliAdapters])

  useInput((char, key) => {
    if (!active) return

    if (key.escape) {
      onCancel()
      return
    }

    if (key.return) {
      onSubmit(input)
      setInput('')
      setHint('')
      setMultiHint('')
      return
    }

    if (key.tab) {
      const { completions, currentToken } = getCompletions(input, agentNames, cliAdapters)
      if (completions.length === 1) {
        setInput(applyCompletion(input, completions[0]))
      } else if (completions.length > 1) {
        const prefix = commonPrefix(completions)
        if (prefix.length > currentToken.length) {
          const parts = input.split(/\s+/)
          parts[parts.length - 1] = prefix
          setInput(parts.join(' '))
        }
      }
      return
    }

    if (key.backspace || key.delete) {
      setInput(prev => prev.slice(0, -1))
      return
    }

    if (char && !key.ctrl && !key.meta) {
      setInput(prev => prev + char)
    }
  }, { isActive: active })

  return (
    <Box flexDirection="column" width="100%">
      <Box flexDirection="row" paddingX={1} paddingY={0} height={1}>
        <Text bold color={active ? 'cyan' : 'gray'}>:</Text>
        {active ? (
          <>
            <Text>{input}</Text>
            <Text dimColor>{hint}</Text>
            <Text color="cyan">█</Text>
          </>
        ) : (
          <Text dimColor>command...</Text>
        )}
      </Box>
      {active && multiHint ? (
        <Box paddingX={2} height={1}>
          <Text dimColor>{multiHint}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

function commonPrefix(strings: string[]): string {
  if (strings.length === 0) return ''
  let prefix = strings[0]
  for (let i = 1; i < strings.length; i++) {
    while (!strings[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1)
    }
  }
  return prefix
}
