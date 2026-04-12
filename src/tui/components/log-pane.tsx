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

// Banner is static — never changes, so memoize aggressively
const BannerPanel = React.memo(function BannerPanel() {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="red"
      justifyContent="center"
      alignItems="center"
      paddingX={1}
    >
      {FLT_BANNER.map((line, idx) => (
        <Text key={idx} color="red" bold>{line}</Text>
      ))}
    </Box>
  )
})

interface LogPaneProps {
  content: string
  focused: boolean
  scrollOffset: number
  searchQuery?: string
  autoFollow?: boolean
  insertMode?: boolean
  insertBuffer?: string
}

export const LogPane = React.memo(function LogPane({ content, focused, scrollOffset, searchQuery, autoFollow, insertMode, insertBuffer }: LogPaneProps): React.ReactElement {
  const { stdout } = useStdout()
  const termHeight = stdout?.rows ?? 24

  const contentHeight = Math.max(4, termHeight - BANNER_HEIGHT - 5)
  const viewableLines = contentHeight - 1

  const lines = content.split('\n')
  const startIdx = Math.max(0, scrollOffset)
  const endIdx = Math.min(lines.length, startIdx + viewableLines)
  const visibleLines = lines.slice(startIdx, endIdx)

  // Highlight search results
  const processedLines = visibleLines.map((line) => {
    const l = line || ' '
    if (!searchQuery || !l.trim()) return l
    const regex = new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
    return l.replace(regex, '\u001B[43m\u001B[30m$1\u001B[0m')
  })

  // Pad to fill content area then add scroll indicator — all as one string
  const padCount = Math.max(0, viewableLines - processedLines.length)
  const padLines = Array.from({ length: padCount }, () => ' ')

  const totalLines = lines.length
  const scrollPercent = totalLines <= viewableLines
    ? 100
    : Math.round((startIdx / Math.max(1, totalLines - viewableLines)) * 100)
  const scrollText = `${scrollPercent}%${autoFollow ? ' FOLLOW' : ''}`

  // Append optimistic insert buffer to the last line
  const displayLines = [...processedLines]
  if (insertBuffer && displayLines.length > 0) {
    displayLines[displayLines.length - 1] += insertBuffer
  } else if (insertBuffer) {
    displayLines.push(insertBuffer)
  }

  // Single text block — Ink diffs one node instead of hundreds
  const fullText = [...displayLines, ...padLines, scrollText].join('\n')

  return (
    <Box flexDirection="column" flexGrow={1}>
      <BannerPanel />
      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle={focused ? 'double' : 'round'}
        borderColor={insertMode ? 'yellow' : focused ? 'green' : 'gray'}
        paddingX={1}
        paddingY={0}
      >
        <Text wrap="truncate">{fullText}</Text>
      </Box>
    </Box>
  )
})
