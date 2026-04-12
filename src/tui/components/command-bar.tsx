import React, { useState } from 'react'
import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'

interface CommandBarProps {
  visible: boolean
  onSubmit: (command: string) => void
  onCancel: () => void
}

export function CommandBar({ visible, onSubmit, onCancel }: CommandBarProps): React.ReactElement | null {
  const [input, setInput] = useState('')

  if (!visible) {
    return null
  }

  const handleSubmit = (value: string) => {
    onSubmit(value)
    setInput('')
  }

  return (
    <Box flexDirection="row" width="100%" paddingX={1} paddingY={0}>
      <Text bold color="cyan">:</Text>
      <TextInput
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        placeholder="command..."
      />
    </Box>
  )
}
