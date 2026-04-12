import React from 'react'
import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'

interface SearchBarProps {
  query: string
  onChange: (query: string) => void
  onSubmit: () => void
  onCancel: () => void
}

export function SearchBar({ query, onChange, onSubmit, onCancel }: SearchBarProps): React.ReactElement {
  const handleSubmit = (value: string) => {
    onSubmit()
  }

  return (
    <Box flexDirection="row" width="100%" paddingX={1} paddingY={0}>
      <Text bold color="yellow">/</Text>
      <TextInput
        value={query}
        onChange={onChange}
        onSubmit={handleSubmit}
        placeholder="search..."
      />
    </Box>
  )
}
