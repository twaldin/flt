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

function formatAge(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime()
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

function shortenPath(p: string): string {
  const home = process.env.HOME || ''
  if (home && p.startsWith(home)) return '~' + p.slice(home.length)
  // Shorten long tmp paths
  if (p.includes('/T/flt-wt-')) {
    const match = p.match(/flt-wt-(.+)$/)
    if (match) return `wt:${match[1]}`
  }
  return p
}

export function AgentRow({ agent, selected }: AgentRowProps): React.ReactElement {
  const statusColor = statusColors[agent.status] || 'white'
  const statusSymbol = statusSymbols[agent.status] || '?'
  const prefix = selected ? '▸ ' : '  '
  const age = formatAge(agent.spawnedAt)
  const dir = shortenPath(agent.dir)

  return (
    <Box flexDirection="column" paddingY={0} width="100%">
      <Text>
        {prefix}
        <Text color={statusColor}>{statusSymbol}</Text>
        {' '}
        <Text bold={selected} color={selected ? 'cyan' : undefined}>{agent.name}</Text>
        <Text dimColor> {age}</Text>
      </Text>
      <Text dimColor>
        {'    '}
        {agent.cli}/{agent.model}
      </Text>
      <Text dimColor>
        {'    '}
        {dir}
      </Text>
    </Box>
  )
}
