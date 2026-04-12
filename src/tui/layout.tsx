import React from 'react'
import { Box } from 'ink'

interface LayoutProps {
  left: React.ReactNode
  right: React.ReactNode
  footer?: React.ReactNode
}

export function Layout({ left, right, footer }: LayoutProps): React.ReactElement {
  return (
    <Box flexDirection="column" width={100} height={30}>
      <Box flexGrow={1} flexDirection="row">
        <Box width={30} borderStyle="round" borderColor="cyan">
          {left}
        </Box>
        <Box flexGrow={1}>
          {right}
        </Box>
      </Box>
      {footer && <Box>{footer}</Box>}
    </Box>
  )
}
