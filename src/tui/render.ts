import React from 'react'
import { render } from 'ink'
import { App } from './app'

/**
 * Wrap stdout with synchronized output (DEC private mode 2026).
 * Modern terminals (iTerm2, WezTerm, Ghostty, kitty) batch all writes
 * between the begin/end markers into a single frame — eliminates flicker.
 */
function enableSynchronizedOutput(): void {
  const originalWrite = process.stdout.write.bind(process.stdout)
  let syncing = false

  process.stdout.write = function (data: any, ...args: any[]): boolean {
    if (!syncing) {
      syncing = true
      originalWrite('\x1b[?2026h') // begin synchronized update
      process.nextTick(() => {
        originalWrite('\x1b[?2026l') // end synchronized update
        syncing = false
      })
    }
    return originalWrite(data, ...args)
  } as typeof process.stdout.write
}

export async function renderTui(): Promise<void> {
  enableSynchronizedOutput()

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
