import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'

interface CommandBarProps {
  visible: boolean
  onSubmit: (command: string) => void
  onCancel: () => void
  initialValue?: string
}

export function CommandBar({ visible, onSubmit, onCancel, initialValue }: CommandBarProps): React.ReactElement | null {
  const [input, setInput] = useState(initialValue || '')

  // Sync initialValue when command bar opens
  useEffect(() => {
    if (visible && initialValue) {
      setInput(initialValue)
    } else if (!visible) {
      setInput('')
    }
  }, [visible, initialValue])

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
