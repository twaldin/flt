import React from 'react'
import { Box, Text } from 'ink'
import { AgentView } from '../types'

interface AgentRowProps {
  agent: AgentView
  selected: boolean
  onSelect: () => void
}

const statusColors: Record<string, string> = {
  spawning: 'yellow',
  ready: 'green',
  running: 'green',
  exited: 'gray',
  error: 'red',
}

const statusSymbols: Record<string, string> = {
  spawning: '◐',
  ready: '●',
  running: '●',
  exited: '○',
  error: '✕',
}

export function AgentRow({ agent, selected, onSelect }: AgentRowProps): React.ReactElement {
  const statusColor = statusColors[agent.status] || 'white'
  const statusSymbol = statusSymbols[agent.status] || '?'
  const prefix = selected ? '> ' : '  '
  const bg = selected ? 'cyan' : undefined

  return (
    <Box key={agent.name} width="100%" paddingY={0}>
      <Text backgroundColor={bg}>
        {prefix}
        <Text color={statusColor}>{statusSymbol}</Text>
        {' '}
        <Text bold={selected}>{agent.name}</Text>
      </Text>
    </Box>
  )
}
