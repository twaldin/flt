import React from 'react'
import { Box, Text } from 'ink'
import { AgentView } from '../types'
import { AgentRow } from './agent-row'

interface AgentListProps {
  agents: AgentView[]
  selectedIndex: number
  onSelectPrev: () => void
  onSelectNext: () => void
}

export function AgentList({ agents, selectedIndex }: AgentListProps): React.ReactElement {
  return (
    <Box flexDirection="column" width="100%">
      <Text bold>Agents ({agents.length})</Text>
      {agents.length === 0 && <Text color="gray">No agents</Text>}
      {agents.map((agent, idx) => (
        <AgentRow key={agent.name} agent={agent} selected={idx === selectedIndex} onSelect={() => {}} />
      ))}
    </Box>
  )
}
