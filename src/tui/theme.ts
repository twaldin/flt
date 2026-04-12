import { existsSync, readFileSync } from 'fs'
import type { AgentView, Mode } from './types'

export const ANSI_COLORS = {
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

export interface ThemeColors {
  sidebarBorder: string
  sidebarTitle: string
  sidebarText: string
  sidebarSelected: string
  sidebarMuted: string
  bannerBorder: string
  bannerText: string
  logBorder: string
  logBorderInsert: string
  logBorderFocus: string
  commandPrefix: string
  commandInput: string
  commandHint: string
  statusBg: string
  statusText: string
  statusMode: Record<Mode, string>
}

const DARK_THEME: ThemeColors = {
  sidebarBorder: ANSI_COLORS.cyan,
  sidebarTitle: ANSI_COLORS.white,
  sidebarText: ANSI_COLORS.gray,
  sidebarSelected: ANSI_COLORS.cyan,
  sidebarMuted: ANSI_COLORS.gray,
  bannerBorder: ANSI_COLORS.red,
  bannerText: ANSI_COLORS.white,
  logBorder: ANSI_COLORS.gray,
  logBorderInsert: ANSI_COLORS.yellow,
  logBorderFocus: ANSI_COLORS.green,
  commandPrefix: ANSI_COLORS.cyan,
  commandInput: ANSI_COLORS.white,
  commandHint: ANSI_COLORS.gray,
  statusBg: ANSI_COLORS.gray,
  statusText: ANSI_COLORS.white,
  statusMode: {
    normal: ANSI_COLORS.green,
    'log-focus': ANSI_COLORS.cyan,
    insert: ANSI_COLORS.yellow,
    command: ANSI_COLORS.magenta,
    inbox: ANSI_COLORS.blue,
  },
}

const LIGHT_THEME: ThemeColors = {
  sidebarBorder: ANSI_COLORS.blue,
  sidebarTitle: ANSI_COLORS.black,
  sidebarText: ANSI_COLORS.black,
  sidebarSelected: ANSI_COLORS.blue,
  sidebarMuted: ANSI_COLORS.gray,
  bannerBorder: ANSI_COLORS.red,
  bannerText: ANSI_COLORS.black,
  logBorder: ANSI_COLORS.gray,
  logBorderInsert: ANSI_COLORS.brightYellow,
  logBorderFocus: ANSI_COLORS.brightGreen,
  commandPrefix: ANSI_COLORS.blue,
  commandInput: ANSI_COLORS.black,
  commandHint: ANSI_COLORS.gray,
  statusBg: ANSI_COLORS.white,
  statusText: ANSI_COLORS.black,
  statusMode: {
    normal: ANSI_COLORS.green,
    'log-focus': ANSI_COLORS.blue,
    insert: ANSI_COLORS.brightYellow,
    command: ANSI_COLORS.magenta,
    inbox: ANSI_COLORS.brightBlue,
  },
}

const MINIMAL_THEME: ThemeColors = {
  sidebarBorder: ANSI_COLORS.white,
  sidebarTitle: ANSI_COLORS.white,
  sidebarText: ANSI_COLORS.gray,
  sidebarSelected: ANSI_COLORS.white,
  sidebarMuted: ANSI_COLORS.gray,
  bannerBorder: ANSI_COLORS.white,
  bannerText: ANSI_COLORS.white,
  logBorder: ANSI_COLORS.gray,
  logBorderInsert: ANSI_COLORS.white,
  logBorderFocus: ANSI_COLORS.white,
  commandPrefix: ANSI_COLORS.white,
  commandInput: ANSI_COLORS.white,
  commandHint: ANSI_COLORS.gray,
  statusBg: ANSI_COLORS.default,
  statusText: ANSI_COLORS.white,
  statusMode: {
    normal: ANSI_COLORS.white,
    'log-focus': ANSI_COLORS.white,
    insert: ANSI_COLORS.white,
    command: ANSI_COLORS.white,
    inbox: ANSI_COLORS.white,
  },
}

const BUILT_IN_THEMES: Record<string, ThemeColors> = {
  dark: DARK_THEME,
  light: LIGHT_THEME,
  minimal: MINIMAL_THEME,
}

let currentThemeName = 'dark'
let currentTheme = DARK_THEME

function loadUserTheme(): Partial<ThemeColors> | null {
  try {
    const themeFile = `${process.env.HOME || '~'}/.flt/theme.json`
    if (!existsSync(themeFile)) return null
    const content = readFileSync(themeFile, 'utf-8')
    return JSON.parse(content) as Partial<ThemeColors>
  } catch {
    return null
  }
}

export function getThemeNames(): string[] {
  return Object.keys(BUILT_IN_THEMES)
}

export function setTheme(name: string): boolean {
  if (!BUILT_IN_THEMES[name]) return false
  currentThemeName = name
  const base = BUILT_IN_THEMES[name]
  const userOverrides = loadUserTheme()
  currentTheme = { ...base, ...userOverrides }
  return true
}

export function getTheme(): ThemeColors {
  return currentTheme
}

export function getCurrentThemeName(): string {
  return currentThemeName
}

// Initialize theme on module load
{
  const userOverrides = loadUserTheme()
  if (userOverrides) {
    currentTheme = { ...DARK_THEME, ...userOverrides }
  }
}

export const COLORS = ANSI_COLORS

export function fg(name: string | undefined): string {
  if (!name) return COLORS.default
  const mapped = (COLORS as Record<string, string>)[name]
  return mapped ?? COLORS.default
}

export function modeColor(mode: Mode): string {
  return getTheme().statusMode[mode]
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
