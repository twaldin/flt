import React from 'react'
import { Box, Text, useStdout } from 'ink'
import { InboxMessage } from '../types'

interface InboxPanelProps {
  messages: InboxMessage[]
  onClose: () => void
  onReply: (agentName: string) => void
}

export function InboxPanel({ messages, onClose, onReply }: InboxPanelProps): React.ReactElement {
  const { stdout } = useStdout()
  const termWidth = stdout?.columns ?? 80
  const termHeight = stdout?.rows ?? 24
  const panelWidth = Math.min(70, termWidth - 10)
  const panelHeight = Math.min(20, termHeight - 6)

  const recent = messages.slice(-panelHeight + 2) // leave room for header + footer

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="blue"
      width={panelWidth}
      height={panelHeight}
      paddingX={1}
    >
      <Text bold color="blue">Inbox ({messages.length} messages)</Text>
      <Text dimColor>{'─'.repeat(panelWidth - 4)}</Text>
      {recent.length === 0 ? (
        <Text dimColor>No messages yet</Text>
      ) : (
        recent.map((msg, idx) => (
          <Text key={idx} wrap="truncate">
            <Text dimColor>[{msg.timestamp}]</Text>
            {' '}
            <Text color="cyan" bold>{msg.from}</Text>
            <Text>: {msg.text}</Text>
          </Text>
        ))
      )}
      <Box flexGrow={1} />
      <Text dimColor>[r] reply to last sender  [Esc] close</Text>
    </Box>
  )
}
