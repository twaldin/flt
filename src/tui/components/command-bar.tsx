import React, { useState, useEffect, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'

interface CommandBarProps {
  active: boolean
  onSubmit: (command: string) => void
  onCancel: () => void
  initialValue?: string
  agentNames: string[]
}

const COMMANDS = ['send', 'logs', 'spawn', 'kill', 'theme', 'help']

function getCompletions(input: string, agentNames: string[]): string[] {
  const parts = input.split(/\s+/)

  // Completing the command name
  if (parts.length <= 1) {
    const prefix = parts[0] || ''
    return COMMANDS.filter(c => c.startsWith(prefix) && c !== prefix)
  }

  const cmd = parts[0]

  // Completing agent name for send/logs/kill
  if (['send', 'logs', 'kill'].includes(cmd) && parts.length === 2) {
    const prefix = parts[1]
    return agentNames.filter(n => n.startsWith(prefix) && n !== prefix)
  }

  return []
}

function applyCompletion(input: string, completion: string): string {
  const parts = input.split(/\s+/)
  if (parts.length <= 1) {
    // Replace command
    return completion + ' '
  }
  // Replace last token
  parts[parts.length - 1] = completion
  return parts.join(' ') + ' '
}

export function CommandBar({ active, onSubmit, onCancel, initialValue, agentNames }: CommandBarProps): React.ReactElement {
  const [input, setInput] = useState(initialValue || '')
  const [hint, setHint] = useState('')

  // Sync initialValue when command bar activates
  useEffect(() => {
    if (active && initialValue) {
      setInput(initialValue)
    } else if (!active) {
      setInput('')
      setHint('')
    }
  }, [active, initialValue])

  // Update completion hint as user types
  useEffect(() => {
    if (!active) {
      setHint('')
      return
    }
    const completions = getCompletions(input, agentNames)
    if (completions.length === 1) {
      // Show the remaining part of the completion as a dim hint
      const parts = input.split(/\s+/)
      const currentToken = parts[parts.length - 1] || ''
      const remaining = completions[0].slice(currentToken.length)
      setHint(remaining)
    } else {
      setHint('')
    }
  }, [input, active, agentNames])

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
      return
    }

    if (key.tab) {
      // Apply completion
      const completions = getCompletions(input, agentNames)
      if (completions.length === 1) {
        setInput(applyCompletion(input, completions[0]))
      } else if (completions.length > 1) {
        // Find common prefix
        const prefix = commonPrefix(completions)
        const parts = input.split(/\s+/)
        const currentToken = parts[parts.length - 1] || ''
        if (prefix.length > currentToken.length) {
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
    <Box flexDirection="row" width="100%" paddingX={1} paddingY={0} height={1}>
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
