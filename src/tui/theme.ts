import type { AgentView, Mode } from './types'

export const COLORS = {
  default: '',
  black: '30',
  red: '31',
  green: '32',
  yellow: '33',
  blue: '34',
  magenta: '35',
  cyan: '36',
  white: '37',
  gray: '90',
  brightRed: '91',
  brightGreen: '92',
  brightYellow: '93',
  brightBlue: '94',
  brightMagenta: '95',
  brightCyan: '96',
  brightWhite: '97',
} as const

export function fg(name: string | undefined): string {
  if (!name) return COLORS.default
  const mapped = (COLORS as Record<string, string>)[name]
  return mapped ?? COLORS.default
}

export function modeColor(mode: Mode): string {
  switch (mode) {
    case 'normal':
      return COLORS.green
    case 'log-focus':
      return COLORS.cyan
    case 'insert':
      return COLORS.yellow
    case 'command':
      return COLORS.magenta
    case 'inbox':
      return COLORS.blue
    default:
      return COLORS.white
  }
}

export function statusColor(status: AgentView['status']): string {
  switch (status) {
    case 'spawning':
      return COLORS.yellow
    case 'ready':
      return COLORS.green
    case 'running':
      return COLORS.yellow
    case 'idle':
      return COLORS.green
    case 'error':
    case 'rate-limited':
      return COLORS.red
    case 'exited':
    case 'unknown':
    default:
      return COLORS.gray
  }
}

export function statusSymbol(status: AgentView['status']): string {
  switch (status) {
    case 'spawning':
      return '◐'
    case 'ready':
      return '●'
    case 'running':
      return '▶'
    case 'idle':
      return '●'
    case 'exited':
      return '○'
    case 'error':
      return '✕'
    case 'rate-limited':
      return '⏸'
    case 'unknown':
    default:
      return '?'
  }
}
