import React from 'react'
import { Box, Text } from 'ink'

interface LogPaneProps {
  content: string
  focused: boolean
  scrollOffset: number
  searchQuery?: string
}

export function LogPane({ content, focused, scrollOffset, searchQuery }: LogPaneProps): React.ReactElement {
  const lines = content.split('\n')
  const windowHeight = 20
  const startIdx = Math.max(0, scrollOffset)
  const endIdx = Math.min(lines.length, startIdx + windowHeight)
  const visibleLines = lines.slice(startIdx, endIdx)

  const scrollPercent = lines.length > 0 ? Math.round((startIdx / lines.length) * 100) : 0

  // Highlight search results
  const highlightedLines = visibleLines.map((line) => {
    if (!searchQuery || !line) return line
    const regex = new RegExp(`(${searchQuery})`, 'gi')
    return line.replace(regex, '\u001B[43m\u001B[30m$1\u001B[0m')
  })

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      borderStyle={focused ? 'double' : 'round'}
      borderColor={focused ? 'green' : 'gray'}
      paddingX={1}
      paddingY={0}
    >
      {highlightedLines.length === 0 ? (
        <Text color="gray">No output</Text>
      ) : (
        <>
          {highlightedLines.map((line, idx) => (
            <Text key={startIdx + idx} wrap="truncate">
              {line}
            </Text>
          ))}
          <Text dimColor>
            {scrollPercent}%
          </Text>
        </>
      )}
    </Box>
  )
}
