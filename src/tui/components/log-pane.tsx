import React from 'react'
import { Box, Text, useStdout } from 'ink'

const FLT_BANNER = [
  '  ╭─────────╮',
  '  │  f l t  │',
  '  ╰─────────╯',
]

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
  // Account for borders (2), footer (2), padding
  const windowHeight = Math.max(4, termHeight - 5)

  const lines = content.split('\n')
  const startIdx = Math.max(0, scrollOffset)
  const endIdx = Math.min(lines.length, startIdx + windowHeight - 1) // -1 for scroll indicator
  const visibleLines = lines.slice(startIdx, endIdx)

  // Highlight search results
  const highlightedLines = visibleLines.map((line) => {
    if (!searchQuery || !line) return line
    const regex = new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
    return line.replace(regex, '\u001B[43m\u001B[30m$1\u001B[0m')
  })

  // If content is shorter than the window, fill top with banner then blank lines
  const contentLines = highlightedLines.length
  const emptySlots = Math.max(0, windowHeight - 1 - contentLines) // -1 for scroll indicator

  const topFill: string[] = []
  if (emptySlots > 0) {
    // Add banner centered in the empty space
    if (emptySlots >= FLT_BANNER.length + 2) {
      const bannerStart = Math.floor((emptySlots - FLT_BANNER.length) / 2)
      for (let i = 0; i < emptySlots; i++) {
        const bannerIdx = i - bannerStart
        if (bannerIdx >= 0 && bannerIdx < FLT_BANNER.length) {
          topFill.push(FLT_BANNER[bannerIdx])
        } else {
          topFill.push('')
        }
      }
    } else {
      for (let i = 0; i < emptySlots; i++) {
        topFill.push('')
      }
    }
  }

  // Scroll indicator
  const totalLines = lines.length
  const scrollPercent = totalLines <= windowHeight - 1
    ? 100
    : Math.round((startIdx / Math.max(1, totalLines - (windowHeight - 1))) * 100)
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
      {topFill.map((line, idx) => (
        <Text key={`fill-${idx}`} dimColor>{line}</Text>
      ))}
      {highlightedLines.map((line, idx) => (
        <Text key={startIdx + idx} wrap="truncate">
          {line}
        </Text>
      ))}
      <Text dimColor>{scrollText}</Text>
    </Box>
  )
}
