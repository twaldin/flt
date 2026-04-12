import React from 'react'
import { render } from 'ink'
import { App } from './app'

export async function renderTui(): Promise<void> {
  // Enter alternate screen buffer manually
  process.stdout.write('\x1b[?1049h\x1b[H\x1b[2J')

  // Use Ink in NON-fullscreen mode. Ink will update in-place using
  // cursor movement (move up + clear line) instead of clearing the
  // entire screen on every render. Much less flicker.
  const { waitUntilExit, unmount } = render(React.createElement(App))

  process.on('SIGINT', () => {
    unmount()
    // Exit alternate screen buffer
    process.stdout.write('\x1b[?1049l')
    process.exit(0)
  })

  await waitUntilExit()
  process.stdout.write('\x1b[?1049l')
}
