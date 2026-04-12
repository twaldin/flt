import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import type { AgentView, Mode } from './types'

// Standard ANSI 16-color codes
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

// Truecolor helper: rgb(r, g, b) → '38;2;R;G;B'
function rgb(r: number, g: number, b: number): string {
  return `38;2;${r};${g};${b}`
}

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
  statusIdle: string
  statusRunning: string
  statusError: string
  statusSpawning: string
  statusMode: Record<Mode, string>
}

// ─── Built-in Themes ──────────────────────────────────────────────

const DARK_THEME: ThemeColors = {
  sidebarBorder: ANSI_COLORS.cyan,
  sidebarTitle: ANSI_COLORS.white,
  sidebarText: ANSI_COLORS.gray,
  sidebarSelected: ANSI_COLORS.cyan,
  sidebarMuted: ANSI_COLORS.gray,
  bannerBorder: ANSI_COLORS.red,
  bannerText: ANSI_COLORS.red,
  logBorder: ANSI_COLORS.gray,
  logBorderInsert: ANSI_COLORS.yellow,
  logBorderFocus: ANSI_COLORS.green,
  commandPrefix: ANSI_COLORS.cyan,
  commandInput: ANSI_COLORS.white,
  commandHint: ANSI_COLORS.gray,
  statusBg: ANSI_COLORS.gray,
  statusText: ANSI_COLORS.white,
  statusIdle: ANSI_COLORS.green,
  statusRunning: ANSI_COLORS.yellow,
  statusError: ANSI_COLORS.red,
  statusSpawning: ANSI_COLORS.yellow,
  statusMode: {
    normal: ANSI_COLORS.green,
    'log-focus': ANSI_COLORS.cyan,
    insert: ANSI_COLORS.yellow,
    command: ANSI_COLORS.magenta,
    inbox: ANSI_COLORS.blue,
    'kill-confirm': ANSI_COLORS.red,
    shell: ANSI_COLORS.brightCyan,  },
}

const LIGHT_THEME: ThemeColors = {
  ...DARK_THEME,
  sidebarBorder: ANSI_COLORS.blue,
  sidebarTitle: ANSI_COLORS.black,
  sidebarText: ANSI_COLORS.black,
  sidebarSelected: ANSI_COLORS.blue,
  bannerText: ANSI_COLORS.red,
  commandPrefix: ANSI_COLORS.blue,
  commandInput: ANSI_COLORS.black,
  statusBg: ANSI_COLORS.white,
  statusText: ANSI_COLORS.black,
}

const MINIMAL_THEME: ThemeColors = {
  ...DARK_THEME,
  sidebarBorder: ANSI_COLORS.white,
  sidebarTitle: ANSI_COLORS.white,
  sidebarSelected: ANSI_COLORS.white,
  bannerBorder: ANSI_COLORS.white,
  bannerText: ANSI_COLORS.white,
  logBorderInsert: ANSI_COLORS.white,
  logBorderFocus: ANSI_COLORS.white,
  commandPrefix: ANSI_COLORS.white,
  statusMode: {
    normal: ANSI_COLORS.white,
    'log-focus': ANSI_COLORS.white,
    insert: ANSI_COLORS.white,
    command: ANSI_COLORS.white,
    inbox: ANSI_COLORS.white,
    'kill-confirm': ANSI_COLORS.white,
    shell: ANSI_COLORS.brightCyan,  },
}

// ─── Popular Colorschemes (Truecolor) ────────────────────────────

const CATPPUCCIN_MOCHA: ThemeColors = {
  sidebarBorder: rgb(137, 180, 250),    // blue
  sidebarTitle: rgb(205, 214, 244),      // text
  sidebarText: rgb(166, 173, 200),       // subtext0
  sidebarSelected: rgb(137, 180, 250),   // blue
  sidebarMuted: rgb(108, 112, 134),      // overlay0
  bannerBorder: rgb(243, 139, 168),      // red
  bannerText: rgb(243, 139, 168),        // red
  logBorder: rgb(88, 91, 112),           // surface2
  logBorderInsert: rgb(249, 226, 175),   // yellow
  logBorderFocus: rgb(166, 227, 161),    // green
  commandPrefix: rgb(137, 180, 250),     // blue
  commandInput: rgb(205, 214, 244),      // text
  commandHint: rgb(108, 112, 134),       // overlay0
  statusBg: rgb(49, 50, 68),             // surface0
  statusText: rgb(205, 214, 244),        // text
  statusIdle: rgb(166, 227, 161),        // green
  statusRunning: rgb(249, 226, 175),     // yellow
  statusError: rgb(243, 139, 168),       // red
  statusSpawning: rgb(250, 179, 135),    // peach
  statusMode: {
    normal: rgb(166, 227, 161),          // green
    'log-focus': rgb(137, 180, 250),     // blue
    insert: rgb(249, 226, 175),          // yellow
    command: rgb(203, 166, 247),         // mauve
    inbox: rgb(116, 199, 236),           // sapphire
    'kill-confirm': rgb(243, 139, 168),  // red
    shell: ANSI_COLORS.brightCyan,  },
}

const GRUVBOX_DARK: ThemeColors = {
  sidebarBorder: rgb(69, 133, 136),      // aqua
  sidebarTitle: rgb(235, 219, 178),      // fg
  sidebarText: rgb(168, 153, 132),       // fg4
  sidebarSelected: rgb(69, 133, 136),    // aqua
  sidebarMuted: rgb(124, 111, 100),      // fg4
  bannerBorder: rgb(204, 36, 29),        // red
  bannerText: rgb(204, 36, 29),          // red
  logBorder: rgb(80, 73, 69),            // bg2
  logBorderInsert: rgb(215, 153, 33),    // yellow
  logBorderFocus: rgb(152, 151, 26),     // green
  commandPrefix: rgb(69, 133, 136),      // aqua
  commandInput: rgb(235, 219, 178),      // fg
  commandHint: rgb(124, 111, 100),       // fg4
  statusBg: rgb(60, 56, 54),             // bg1
  statusText: rgb(235, 219, 178),        // fg
  statusIdle: rgb(152, 151, 26),         // green
  statusRunning: rgb(215, 153, 33),      // yellow
  statusError: rgb(204, 36, 29),         // red
  statusSpawning: rgb(214, 93, 14),      // orange
  statusMode: {
    normal: rgb(152, 151, 26),           // green
    'log-focus': rgb(69, 133, 136),      // aqua
    insert: rgb(215, 153, 33),           // yellow
    command: rgb(177, 98, 134),          // purple
    inbox: rgb(69, 133, 136),            // aqua
    'kill-confirm': rgb(204, 36, 29),    // red
    shell: ANSI_COLORS.brightCyan,  },
}

const TOKYO_NIGHT: ThemeColors = {
  sidebarBorder: rgb(122, 162, 247),     // blue
  sidebarTitle: rgb(192, 202, 245),      // fg
  sidebarText: rgb(134, 150, 187),       // comment
  sidebarSelected: rgb(122, 162, 247),   // blue
  sidebarMuted: rgb(86, 95, 137),        // dark5
  bannerBorder: rgb(247, 118, 142),      // red
  bannerText: rgb(247, 118, 142),        // red
  logBorder: rgb(61, 66, 91),            // bg_highlight
  logBorderInsert: rgb(224, 175, 104),   // yellow
  logBorderFocus: rgb(158, 206, 106),    // green
  commandPrefix: rgb(122, 162, 247),     // blue
  commandInput: rgb(192, 202, 245),      // fg
  commandHint: rgb(86, 95, 137),         // dark5
  statusBg: rgb(36, 40, 59),             // bg_dark
  statusText: rgb(192, 202, 245),        // fg
  statusIdle: rgb(158, 206, 106),        // green
  statusRunning: rgb(224, 175, 104),     // yellow
  statusError: rgb(247, 118, 142),       // red
  statusSpawning: rgb(255, 158, 100),    // orange
  statusMode: {
    normal: rgb(158, 206, 106),          // green
    'log-focus': rgb(122, 162, 247),     // blue
    insert: rgb(224, 175, 104),          // yellow
    command: rgb(187, 154, 247),         // purple
    inbox: rgb(125, 207, 255),           // cyan
    'kill-confirm': rgb(247, 118, 142),  // red
    shell: ANSI_COLORS.brightCyan,  },
}

const NORD: ThemeColors = {
  sidebarBorder: rgb(136, 192, 208),     // frost
  sidebarTitle: rgb(236, 239, 244),      // snow storm
  sidebarText: rgb(216, 222, 233),       // snow storm
  sidebarSelected: rgb(136, 192, 208),   // frost
  sidebarMuted: rgb(107, 112, 137),      // polar night
  bannerBorder: rgb(191, 97, 106),       // aurora red
  bannerText: rgb(191, 97, 106),         // aurora red
  logBorder: rgb(76, 86, 106),           // polar night
  logBorderInsert: rgb(235, 203, 139),   // aurora yellow
  logBorderFocus: rgb(163, 190, 140),    // aurora green
  commandPrefix: rgb(136, 192, 208),     // frost
  commandInput: rgb(236, 239, 244),      // snow storm
  commandHint: rgb(107, 112, 137),       // polar night
  statusBg: rgb(59, 66, 82),             // polar night
  statusText: rgb(236, 239, 244),        // snow storm
  statusIdle: rgb(163, 190, 140),        // aurora green
  statusRunning: rgb(235, 203, 139),     // aurora yellow
  statusError: rgb(191, 97, 106),        // aurora red
  statusSpawning: rgb(208, 135, 112),    // aurora orange
  statusMode: {
    normal: rgb(163, 190, 140),          // green
    'log-focus': rgb(136, 192, 208),     // frost
    insert: rgb(235, 203, 139),          // yellow
    command: rgb(180, 142, 173),         // purple
    inbox: rgb(129, 161, 193),           // frost dark
    'kill-confirm': rgb(191, 97, 106),   // red
    shell: ANSI_COLORS.brightCyan,  },
}

const DRACULA: ThemeColors = {
  sidebarBorder: rgb(139, 233, 253),     // cyan
  sidebarTitle: rgb(248, 248, 242),      // fg
  sidebarText: rgb(189, 147, 249),       // purple
  sidebarSelected: rgb(139, 233, 253),   // cyan
  sidebarMuted: rgb(98, 114, 164),       // comment
  bannerBorder: rgb(255, 85, 85),        // red
  bannerText: rgb(255, 85, 85),          // red
  logBorder: rgb(68, 71, 90),            // current line
  logBorderInsert: rgb(241, 250, 140),   // yellow
  logBorderFocus: rgb(80, 250, 123),     // green
  commandPrefix: rgb(139, 233, 253),     // cyan
  commandInput: rgb(248, 248, 242),      // fg
  commandHint: rgb(98, 114, 164),        // comment
  statusBg: rgb(40, 42, 54),             // bg
  statusText: rgb(248, 248, 242),        // fg
  statusIdle: rgb(80, 250, 123),         // green
  statusRunning: rgb(241, 250, 140),     // yellow
  statusError: rgb(255, 85, 85),         // red
  statusSpawning: rgb(255, 184, 108),    // orange
  statusMode: {
    normal: rgb(80, 250, 123),           // green
    'log-focus': rgb(139, 233, 253),     // cyan
    insert: rgb(241, 250, 140),          // yellow
    command: rgb(189, 147, 249),         // purple
    inbox: rgb(139, 233, 253),           // cyan
    'kill-confirm': rgb(255, 85, 85),    // red
    shell: ANSI_COLORS.brightCyan,  },
}

const ONE_DARK: ThemeColors = {
  sidebarBorder: rgb(97, 175, 239),      // blue
  sidebarTitle: rgb(171, 178, 191),      // fg
  sidebarText: rgb(92, 99, 112),         // comment
  sidebarSelected: rgb(97, 175, 239),    // blue
  sidebarMuted: rgb(92, 99, 112),        // comment
  bannerBorder: rgb(224, 108, 117),      // red
  bannerText: rgb(224, 108, 117),        // red
  logBorder: rgb(62, 68, 81),            // gutter
  logBorderInsert: rgb(229, 192, 123),   // yellow
  logBorderFocus: rgb(152, 195, 121),    // green
  commandPrefix: rgb(97, 175, 239),      // blue
  commandInput: rgb(171, 178, 191),      // fg
  commandHint: rgb(92, 99, 112),         // comment
  statusBg: rgb(40, 44, 52),             // bg
  statusText: rgb(171, 178, 191),        // fg
  statusIdle: rgb(152, 195, 121),        // green
  statusRunning: rgb(229, 192, 123),     // yellow
  statusError: rgb(224, 108, 117),       // red
  statusSpawning: rgb(209, 154, 102),    // dark yellow
  statusMode: {
    normal: rgb(152, 195, 121),          // green
    'log-focus': rgb(97, 175, 239),      // blue
    insert: rgb(229, 192, 123),          // yellow
    command: rgb(198, 120, 221),         // magenta
    inbox: rgb(86, 182, 194),            // cyan
    'kill-confirm': rgb(224, 108, 117),  // red
    shell: ANSI_COLORS.brightCyan,  },
}

// ─── Theme Registry ──────────────────────────────────────────────

const BUILT_IN_THEMES: Record<string, ThemeColors> = {
  dark: DARK_THEME,
  light: LIGHT_THEME,
  minimal: MINIMAL_THEME,
  catppuccin: CATPPUCCIN_MOCHA,
  gruvbox: GRUVBOX_DARK,
  'tokyo-night': TOKYO_NIGHT,
  nord: NORD,
  dracula: DRACULA,
  'one-dark': ONE_DARK,
}

let currentThemeName = 'dark'
let currentTheme: ThemeColors = DARK_THEME

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

function persistThemeName(name: string): void {
  try {
    const dir = `${process.env.HOME || '~'}/.flt`
    mkdirSync(dir, { recursive: true })
    const configPath = `${dir}/config.json`
    let config: Record<string, unknown> = {}
    if (existsSync(configPath)) {
      config = JSON.parse(readFileSync(configPath, 'utf-8'))
    }
    config.theme = name
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
  } catch {}
}

function loadPersistedThemeName(): string | null {
  try {
    const configPath = `${process.env.HOME || '~'}/.flt/config.json`
    if (!existsSync(configPath)) return null
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    return typeof config.theme === 'string' ? config.theme : null
  } catch {
    return null
  }
}

export function setTheme(name: string): boolean {
  if (!BUILT_IN_THEMES[name]) return false
  currentThemeName = name
  const base = BUILT_IN_THEMES[name]
  const userOverrides = loadUserTheme()
  currentTheme = userOverrides ? { ...base, ...userOverrides } : base
  persistThemeName(name)
  return true
}

export function getTheme(): ThemeColors {
  return currentTheme
}

export function getCurrentThemeName(): string {
  return currentThemeName
}

// Initialize: load persisted theme, then apply user overrides
{
  const persisted = loadPersistedThemeName()
  if (persisted && BUILT_IN_THEMES[persisted]) {
    currentThemeName = persisted
    currentTheme = BUILT_IN_THEMES[persisted]
  }

  try {
    const themeFile = `${process.env.HOME || '~'}/.flt/theme.json`
    if (existsSync(themeFile)) {
      const content = JSON.parse(readFileSync(themeFile, 'utf-8'))
      if (content.extends && BUILT_IN_THEMES[content.extends]) {
        setTheme(content.extends)
      } else {
        currentTheme = { ...DARK_THEME, ...content }
      }
    }
  } catch {}
}

export const COLORS = ANSI_COLORS

export function fg(name: string | undefined): string {
  if (!name) return COLORS.default
  // Support both named colors and raw ANSI codes (e.g. '38;2;R;G;B')
  if (name.includes(';')) return name
  const mapped = (COLORS as Record<string, string>)[name]
  return mapped ?? COLORS.default
}

export function modeColor(mode: Mode): string {
  return getTheme().statusMode[mode] ?? COLORS.default
}

export function statusColor(status: AgentView['status']): string {
  const theme = getTheme()
  switch (status) {
    case 'spawning':
      return theme.statusSpawning
    case 'ready':
    case 'idle':
      return theme.statusIdle
    case 'running':
      return theme.statusRunning
    case 'error':
    case 'rate-limited':
      return theme.statusError
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
