import React from 'react'
import { Box, Text, useStdout } from 'ink'

const FLT_BANNER = [
  '    ██████  ████   █████   ',
  '   ███░░███░░███  ░░███    ',
  '  ░███ ░░░  ░███  ███████  ',
  ' ███████    ░███ ░░░███░   ',
  '░░░███░     ░███   ░███    ',
  '  ░███      ░███   ░███ ███',
  '  █████     █████  ░░█████ ',
  ' ░░░░░     ░░░░░    ░░░░░  ',
]

const BANNER_HEIGHT = FLT_BANNER.length + 2 // +2 for border

interface LogPaneProps {
  content: string
  focused: boolean
  scrollOffset: number
  searchQuery?: string
  autoFollow?: boolean
  insertMode?: boolean
}

export function LogPane({ content, focused, scrollOffset, searchQuery, autoFollow, insertMode }: LogPaneProps): React.ReactElement {
  const { stdout } = useStdout()
  const termHeight = stdout?.rows ?? 24
  const termWidth = stdout?.columns ?? 80
  const leftPanelWidth = Math.floor(termWidth * 0.28)
  const paneWidth = termWidth - leftPanelWidth - 2 // borders

  // Content area: total height minus banner panel, footer, outer borders
  const contentHeight = Math.max(4, termHeight - BANNER_HEIGHT - 5)

  const lines = content.split('\n')
  const startIdx = Math.max(0, scrollOffset)
  const endIdx = Math.min(lines.length, startIdx + contentHeight - 1) // -1 for scroll indicator
  const visibleLines = lines.slice(startIdx, endIdx)

  // Highlight search results
  const highlightedLines = visibleLines.map((line) => {
    if (!searchQuery || !line) return line
    const regex = new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
    return line.replace(regex, '\u001B[43m\u001B[30m$1\u001B[0m')
  })

  // Pad to fill content area
  const padCount = Math.max(0, contentHeight - 1 - highlightedLines.length)

  // Scroll indicator
  const totalLines = lines.length
  const viewableLines = contentHeight - 1
  const scrollPercent = totalLines <= viewableLines
    ? 100
    : Math.round((startIdx / Math.max(1, totalLines - viewableLines)) * 100)
  const followTag = autoFollow ? ' FOLLOW' : ''
  const scrollText = `${scrollPercent}%${followTag}`

  // Center banner lines within the pane width
  const innerWidth = Math.max(0, paneWidth - 4) // minus padding + border

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Banner panel */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="red"
        justifyContent="center"
        alignItems="center"
        paddingX={1}
      >
        {FLT_BANNER.map((line, idx) => (
          <Text key={`b-${idx}`} color="red" bold>{line}</Text>
        ))}
      </Box>

      {/* Log content panel */}
      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle={focused ? 'double' : 'round'}
        borderColor={insertMode ? 'yellow' : focused ? 'green' : 'gray'}
        paddingX={1}
        paddingY={0}
      >
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
    </Box>
  )
}
