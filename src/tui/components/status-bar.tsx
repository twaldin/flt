import React from 'react'
import { Box, Text } from 'ink'
import { Mode } from '../types'

interface StatusBarProps {
  mode: Mode
  agentCount: number
  selectedAgent?: string
}

const modeHints: Record<Mode, string> = {
  normal: 'j/k: select | ↵: focus log | : command | q: quit',
  'log-focus': 'j/k: scroll | Ctrl-d/u: page | G/gg: bottom/top | /: search | Esc: back',
  command: 'Enter: execute | Esc: cancel',
  'spawn-wizard': 'Tab: next field | Ctrl-Enter: spawn',
  'kill-confirm': 'y: confirm | n/Esc: cancel',
}

export function StatusBar({ mode, agentCount, selectedAgent }: StatusBarProps): React.ReactElement {
  const hint = modeHints[mode] || ''

  return (
    <Box flexDirection="row" width="100%" paddingX={1} paddingY={0} borderTop borderColor="gray">
      <Text dimColor>[{mode}]</Text>
      <Text> {hint} </Text>
      {selectedAgent && (
        <Text dimColor>
          | {selectedAgent} ({agentCount})
        </Text>
      )}
    </Box>
  )
}
