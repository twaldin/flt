import React from 'react'
import { Box, Text } from 'ink'
import { Mode } from '../types'

interface StatusBarProps {
  mode: Mode
  agentCount: number
  selectedAgent?: string
}

const modeHints: Record<Mode, string> = {
  normal: 'j/k: select | ↵: focus log | r: reply | m: inbox | : command | q: quit',
  'log-focus': 'j/k: scroll | i: insert | r: reply | Ctrl-d/u: page | G: bottom | /: search | Esc: back',
  insert: 'typing into agent — Esc: exit insert mode',
  command: 'Enter: execute | Esc: cancel',
  inbox: 'r: reply to last | Esc: close',
  'spawn-wizard': 'Tab: next field | Ctrl-Enter: spawn',
  'kill-confirm': 'y: confirm | n/Esc: cancel',
}

const modeColors: Record<Mode, string> = {
  normal: 'green',
  'log-focus': 'cyan',
  insert: 'yellow',
  command: 'magenta',
  inbox: 'blue',
  'spawn-wizard': 'magenta',
  'kill-confirm': 'red',
}

export function StatusBar({ mode, agentCount, selectedAgent }: StatusBarProps): React.ReactElement {
  const hint = modeHints[mode] || ''
  const color = modeColors[mode] || 'white'

  return (
    <Box flexDirection="row" width="100%" paddingX={1} paddingY={0}>
      <Text color={color} bold>[{mode.toUpperCase()}]</Text>
      <Text dimColor> {hint} </Text>
      {selectedAgent && (
        <Text dimColor>| {selectedAgent} ({agentCount})</Text>
      )}
    </Box>
  )
}
