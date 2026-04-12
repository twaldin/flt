import React from 'react'
import { render } from 'ink'
import { App } from './app'

export async function renderTui(): Promise<void> {
  const { unmount } = render(React.createElement(App))

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    unmount()
    process.exit(0)
  })

  // Keep alive until unmount
  await new Promise(() => {})
}
