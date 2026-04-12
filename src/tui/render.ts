import React from 'react'
import { render } from 'ink'
import { App } from './app'

export async function renderTui(): Promise<void> {
  const { waitUntilExit, unmount } = render(React.createElement(App), {
    fullscreen: true,
  })

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    unmount()
    process.exit(0)
  })

  await waitUntilExit()
}
