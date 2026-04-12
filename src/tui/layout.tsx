import React from 'react'
import { Box, useStdout } from 'ink'

interface LayoutProps {
  left: React.ReactNode
  right: React.ReactNode
  footer?: React.ReactNode
}

export function Layout({ left, right, footer }: LayoutProps): React.ReactElement {
  const { stdout } = useStdout()
  const termWidth = stdout?.columns ?? 80
  const termHeight = stdout?.rows ?? 24
  const leftWidth = Math.floor(termWidth * 0.28)

  return (
    <Box flexDirection="column" width={termWidth} height={termHeight}>
      <Box flexGrow={1} flexDirection="row">
        <Box width={leftWidth} borderStyle="round" borderColor="cyan" flexDirection="column">
          {left}
        </Box>
        <Box flexGrow={1} flexDirection="column">
          {right}
        </Box>
      </Box>
      {footer && <Box width={termWidth}>{footer}</Box>}
    </Box>
  )
}
