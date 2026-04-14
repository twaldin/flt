/**
 * Parse TUI commands like `:send agent message`
 */

export interface ParsedCommand {
  cmd: string
  args: string[]
  raw: string
}

/**
 * Parse a command line starting with ':'
 * Examples:
 *   `:send agent hello` -> { cmd: 'send', args: ['agent', 'hello'] }
 *   `:logs agent-1` -> { cmd: 'logs', args: ['agent-1'] }
 */
export function parseCommand(line: string): ParsedCommand | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith(':')) {
    return null
  }

  const withoutColon = trimmed.slice(1).trim()
  if (!withoutColon) {
    return null
  }

  const parts = withoutColon.split(/\s+/)
  const cmd = parts[0]
  const args = parts.slice(1)

  return { cmd, args, raw: trimmed }
}

/**
 * Validate a command is recognized
 */
export function isValidCommand(cmd: string): boolean {
  const valid = ['send', 'logs', 'spawn', 'presets', 'kill', 'theme', 'ascii', 'keybinds', 'help', '!']
  return valid.includes(cmd)
}

/**
 * Detect file paths in a message (from drag-and-drop) and wrap them
 * so the receiving agent knows to read the file.
 * Paths starting with / or ~/ get wrapped: "Read this file: /path/to/file"
 */
export function enrichMessageWithFiles(message: string): string {
  // If the entire message is just a file path, wrap it
  const trimmed = message.trim()
  if (/^(\/|~\/)\S+$/.test(trimmed)) {
    return `Read this file: ${trimmed}`
  }
  return message
}
