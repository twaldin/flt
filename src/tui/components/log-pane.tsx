import React from 'react'
import { Box, Text, useStdout } from 'ink'

const FLT_BANNER = [
  '',
  '   ad88 88        ',
  '  d8"   88   ,d   ',
  '  88    88   88   ',
  'MM88MMM 88 MM88MMM',
  '  88    88   88   ',
  '  88    88   88   ',
  '  88    88   88,  ',
  '  88    88   "Y888',
  '',
]

const BANNER_HEIGHT = FLT_BANNER.length

interface LogPaneProps {
  content: string
  focused: boolean
  scrollOffset: number
  searchQuery?: string
  autoFollow?: boolean
}

export function LogPane({ content, focused, scrollOffset, searchQuery, autoFollow }: LogPaneProps): React.ReactElement {
  const { stdout } = useStdout()
  const termHeight = stdout?.rows ?? 24
  // Account for outer border (2), footer (2)
  const windowHeight = Math.max(4, termHeight - 5)
  // Reserve: banner + 1 for scroll indicator
  const contentHeight = windowHeight - BANNER_HEIGHT - 1

  const lines = content.split('\n')
  const startIdx = Math.max(0, scrollOffset)
  const endIdx = Math.min(lines.length, startIdx + contentHeight)
  const visibleLines = lines.slice(startIdx, endIdx)

  // Highlight search results
  const highlightedLines = visibleLines.map((line) => {
    if (!searchQuery || !line) return line
    const regex = new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
    return line.replace(regex, '\u001B[43m\u001B[30m$1\u001B[0m')
  })

  // Pad content lines to fill the content area so scroll indicator stays at bottom
  const padCount = Math.max(0, contentHeight - highlightedLines.length)

  // Scroll indicator
  const totalLines = lines.length
  const scrollPercent = totalLines <= contentHeight
    ? 100
    : Math.round((startIdx / Math.max(1, totalLines - contentHeight)) * 100)
  const followTag = autoFollow ? ' FOLLOW' : ''
  const scrollText = `${scrollPercent}%${followTag}`

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      borderStyle={focused ? 'double' : 'round'}
      borderColor={focused ? 'green' : 'gray'}
      paddingX={1}
      paddingY={0}
    >
      {FLT_BANNER.map((line, idx) => (
        <Text key={`banner-${idx}`} dimColor>{line || ' '}</Text>
      ))}
      {highlightedLines.map((line, idx) => (
        <Text key={`line-${startIdx + idx}`} wrap="truncate">
          {line || ' '}
        </Text>
      ))}
      {Array.from({ length: padCount }, (_, i) => (
        <Text key={`pad-${i}`}>{' '}</Text>
      ))}
      <Text dimColor>{scrollText}</Text>
    </Box>
  )
}
