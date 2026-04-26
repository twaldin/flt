import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
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

// Truecolor helper: rgb(r, g, b) -> '38;2;R;G;B'
function rgb(r: number, g: number, b: number): string {
  return `38;2;${r};${g};${b}`
}

// Background color helper: rgb(r, g, b) -> '48;2;R;G;B'
function bgRgb(r: number, g: number, b: number): string {
  return `48;2;${r};${g};${b}`
}

export type ThemeBackground = 'transparent' | string

export interface ThemeColors {
  background: ThemeBackground
  sidebarBorder: string
  sidebarTitle: string
  sidebarText: string
  sidebarSelected: string
  sidebarSelectedBg: string
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

type ThemeOverride = Partial<Omit<ThemeColors, 'statusMode'>> & {
  extends?: string
  statusMode?: Partial<Record<Mode, string>>
}

const MODE_KEYS: Mode[] = [
  'normal',
  'log-focus',
  'insert',
  'command',
  'inbox',
  'presets',
  'workflows',
  'kill-confirm',
  'shell',
]

function fltDir(): string {
  return `${process.env.HOME || homedir()}/.flt`
}

function normalizeBackground(bg: string): ThemeBackground {
  const trimmed = bg.trim()
  return trimmed === '' || trimmed === 'transparent' ? 'transparent' : trimmed
}

function parseThemeOverride(raw: unknown): ThemeOverride | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const source = raw as Record<string, unknown>
  const out: ThemeOverride = {}

  if (typeof source.extends === 'string') out.extends = source.extends

  if (typeof source.background === 'string') out.background = normalizeBackground(source.background)
  if (typeof source.sidebarBorder === 'string') out.sidebarBorder = source.sidebarBorder
  if (typeof source.sidebarTitle === 'string') out.sidebarTitle = source.sidebarTitle
  if (typeof source.sidebarText === 'string') out.sidebarText = source.sidebarText
  if (typeof source.sidebarSelected === 'string') out.sidebarSelected = source.sidebarSelected
  if (typeof source.sidebarSelectedBg === 'string') out.sidebarSelectedBg = source.sidebarSelectedBg
  if (typeof source.sidebarMuted === 'string') out.sidebarMuted = source.sidebarMuted
  if (typeof source.bannerBorder === 'string') out.bannerBorder = source.bannerBorder
  if (typeof source.bannerText === 'string') out.bannerText = source.bannerText
  if (typeof source.logBorder === 'string') out.logBorder = source.logBorder
  if (typeof source.logBorderInsert === 'string') out.logBorderInsert = source.logBorderInsert
  if (typeof source.logBorderFocus === 'string') out.logBorderFocus = source.logBorderFocus
  if (typeof source.commandPrefix === 'string') out.commandPrefix = source.commandPrefix
  if (typeof source.commandInput === 'string') out.commandInput = source.commandInput
  if (typeof source.commandHint === 'string') out.commandHint = source.commandHint
  if (typeof source.statusBg === 'string') out.statusBg = source.statusBg
  if (typeof source.statusText === 'string') out.statusText = source.statusText
  if (typeof source.statusIdle === 'string') out.statusIdle = source.statusIdle
  if (typeof source.statusRunning === 'string') out.statusRunning = source.statusRunning
  if (typeof source.statusError === 'string') out.statusError = source.statusError
  if (typeof source.statusSpawning === 'string') out.statusSpawning = source.statusSpawning

  if (source.statusMode && typeof source.statusMode === 'object' && !Array.isArray(source.statusMode)) {
    const modeSource = source.statusMode as Record<string, unknown>
    const modeOverrides: Partial<Record<Mode, string>> = {}
    for (const mode of MODE_KEYS) {
      const color = modeSource[mode]
      if (typeof color === 'string') modeOverrides[mode] = color
    }
    if (Object.keys(modeOverrides).length > 0) {
      out.statusMode = modeOverrides
    }
  }

  return out
}

function mergeTheme(base: ThemeColors, override: ThemeOverride | null): ThemeColors {
  if (!override) return base

  return {
    background: override.background ?? base.background,
    sidebarBorder: override.sidebarBorder ?? base.sidebarBorder,
    sidebarTitle: override.sidebarTitle ?? base.sidebarTitle,
    sidebarText: override.sidebarText ?? base.sidebarText,
    sidebarSelected: override.sidebarSelected ?? base.sidebarSelected,
    sidebarSelectedBg: override.sidebarSelectedBg ?? base.sidebarSelectedBg,
    sidebarMuted: override.sidebarMuted ?? base.sidebarMuted,
    bannerBorder: override.bannerBorder ?? base.bannerBorder,
    bannerText: override.bannerText ?? base.bannerText,
    logBorder: override.logBorder ?? base.logBorder,
    logBorderInsert: override.logBorderInsert ?? base.logBorderInsert,
    logBorderFocus: override.logBorderFocus ?? base.logBorderFocus,
    commandPrefix: override.commandPrefix ?? base.commandPrefix,
    commandInput: override.commandInput ?? base.commandInput,
    commandHint: override.commandHint ?? base.commandHint,
    statusBg: override.statusBg ?? base.statusBg,
    statusText: override.statusText ?? base.statusText,
    statusIdle: override.statusIdle ?? base.statusIdle,
    statusRunning: override.statusRunning ?? base.statusRunning,
    statusError: override.statusError ?? base.statusError,
    statusSpawning: override.statusSpawning ?? base.statusSpawning,
    statusMode: {
      ...base.statusMode,
      ...(override.statusMode ?? {}),
    },
  }
}

// --- Built-in Themes -------------------------------------------------

const DARK_THEME: ThemeColors = {
  background: bgRgb(30, 30, 30),
  sidebarBorder: ANSI_COLORS.cyan,
  sidebarTitle: ANSI_COLORS.white,
  sidebarText: ANSI_COLORS.cyan,
  sidebarSelected: rgb(30, 30, 30),
  sidebarSelectedBg: '46',
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
    insert: ANSI_COLORS.green,
    command: ANSI_COLORS.magenta,
    inbox: ANSI_COLORS.blue,
    presets: ANSI_COLORS.blue,
    workflows: ANSI_COLORS.blue,
    'kill-confirm': ANSI_COLORS.red,
    shell: ANSI_COLORS.brightCyan,
  },
}

const LIGHT_THEME: ThemeColors = {
  ...DARK_THEME,
  background: bgRgb(250, 250, 250),
  sidebarBorder: ANSI_COLORS.blue,
  sidebarTitle: ANSI_COLORS.black,
  sidebarText: ANSI_COLORS.blue,
  sidebarSelected: ANSI_COLORS.white,
  sidebarSelectedBg: '44',
  bannerText: ANSI_COLORS.red,
  commandPrefix: ANSI_COLORS.blue,
  commandInput: ANSI_COLORS.black,
  statusBg: ANSI_COLORS.white,
  statusText: ANSI_COLORS.black,
}

const MINIMAL_THEME: ThemeColors = {
  ...DARK_THEME,
  background: 'transparent',
  sidebarBorder: ANSI_COLORS.white,
  sidebarTitle: ANSI_COLORS.white,
  sidebarText: ANSI_COLORS.white,
  sidebarSelected: ANSI_COLORS.black,
  sidebarSelectedBg: '47',
  bannerBorder: ANSI_COLORS.white,
  bannerText: ANSI_COLORS.white,
  logBorderInsert: ANSI_COLORS.white,
  logBorderFocus: ANSI_COLORS.white,
  commandPrefix: ANSI_COLORS.white,
  statusMode: {
    normal: ANSI_COLORS.white,
    'log-focus': ANSI_COLORS.white,
    insert: ANSI_COLORS.green,
    command: ANSI_COLORS.white,
    inbox: ANSI_COLORS.white,
    presets: ANSI_COLORS.white,
    workflows: ANSI_COLORS.white,
    'kill-confirm': ANSI_COLORS.white,
    shell: ANSI_COLORS.brightCyan,
  },
}

const CATPPUCCIN_MOCHA: ThemeColors = {
  ...DARK_THEME,
  background: bgRgb(30, 30, 46),
  sidebarBorder: rgb(137, 180, 250),
  sidebarTitle: rgb(205, 214, 244),
  sidebarText: rgb(137, 180, 250),
  sidebarSelected: rgb(30, 30, 46),
  sidebarSelectedBg: bgRgb(137, 180, 250),
  sidebarMuted: rgb(108, 112, 134),
  bannerBorder: rgb(243, 139, 168),
  bannerText: rgb(243, 139, 168),
  logBorder: rgb(88, 91, 112),
  logBorderInsert: rgb(249, 226, 175),
  logBorderFocus: rgb(166, 227, 161),
  commandPrefix: rgb(137, 180, 250),
  commandInput: rgb(205, 214, 244),
  commandHint: rgb(108, 112, 134),
  statusBg: rgb(49, 50, 68),
  statusText: rgb(205, 214, 244),
  statusIdle: rgb(166, 227, 161),
  statusRunning: rgb(249, 226, 175),
  statusError: rgb(243, 139, 168),
  statusSpawning: rgb(250, 179, 135),
  statusMode: {
    normal: rgb(166, 227, 161),
    'log-focus': rgb(137, 180, 250),
    insert: rgb(166, 227, 161),
    command: rgb(203, 166, 247),
    inbox: rgb(116, 199, 236),
    presets: rgb(116, 199, 236),
    workflows: rgb(116, 199, 236),
    'kill-confirm': rgb(243, 139, 168),
    shell: ANSI_COLORS.brightCyan,
  },
}

const GRUVBOX_DARK: ThemeColors = {
  ...DARK_THEME,
  background: bgRgb(40, 40, 40),
  sidebarBorder: rgb(69, 133, 136),
  sidebarTitle: rgb(235, 219, 178),
  sidebarText: rgb(69, 133, 136),
  sidebarSelected: rgb(40, 40, 40),
  sidebarSelectedBg: bgRgb(69, 133, 136),
  sidebarMuted: rgb(124, 111, 100),
  bannerBorder: rgb(204, 36, 29),
  bannerText: rgb(204, 36, 29),
  logBorder: rgb(80, 73, 69),
  logBorderInsert: rgb(215, 153, 33),
  logBorderFocus: rgb(152, 151, 26),
  commandPrefix: rgb(69, 133, 136),
  commandInput: rgb(235, 219, 178),
  commandHint: rgb(124, 111, 100),
  statusBg: rgb(60, 56, 54),
  statusText: rgb(235, 219, 178),
  statusIdle: rgb(152, 151, 26),
  statusRunning: rgb(215, 153, 33),
  statusError: rgb(204, 36, 29),
  statusSpawning: rgb(214, 93, 14),
  statusMode: {
    normal: rgb(152, 151, 26),
    'log-focus': rgb(69, 133, 136),
    insert: rgb(152, 151, 26),
    command: rgb(177, 98, 134),
    inbox: rgb(69, 133, 136),
    presets: rgb(69, 133, 136),
    workflows: rgb(69, 133, 136),
    'kill-confirm': rgb(204, 36, 29),
    shell: ANSI_COLORS.brightCyan,
  },
}

const TOKYO_NIGHT: ThemeColors = {
  ...DARK_THEME,
  background: bgRgb(26, 27, 38),
  sidebarBorder: rgb(122, 162, 247),
  sidebarTitle: rgb(192, 202, 245),
  sidebarText: rgb(122, 162, 247),
  sidebarSelected: rgb(26, 27, 38),
  sidebarSelectedBg: bgRgb(122, 162, 247),
  sidebarMuted: rgb(86, 95, 137),
  bannerBorder: rgb(247, 118, 142),
  bannerText: rgb(247, 118, 142),
  logBorder: rgb(61, 66, 91),
  logBorderInsert: rgb(224, 175, 104),
  logBorderFocus: rgb(158, 206, 106),
  commandPrefix: rgb(122, 162, 247),
  commandInput: rgb(192, 202, 245),
  commandHint: rgb(86, 95, 137),
  statusBg: rgb(36, 40, 59),
  statusText: rgb(192, 202, 245),
  statusIdle: rgb(158, 206, 106),
  statusRunning: rgb(224, 175, 104),
  statusError: rgb(247, 118, 142),
  statusSpawning: rgb(255, 158, 100),
  statusMode: {
    normal: rgb(158, 206, 106),
    'log-focus': rgb(122, 162, 247),
    insert: rgb(158, 206, 106),
    command: rgb(187, 154, 247),
    inbox: rgb(125, 207, 255),
    presets: rgb(125, 207, 255),
    workflows: rgb(125, 207, 255),
    'kill-confirm': rgb(247, 118, 142),
    shell: ANSI_COLORS.brightCyan,
  },
}

const NORD: ThemeColors = {
  ...DARK_THEME,
  background: bgRgb(46, 52, 64),
  sidebarBorder: rgb(136, 192, 208),
  sidebarTitle: rgb(236, 239, 244),
  sidebarText: rgb(136, 192, 208),
  sidebarSelected: rgb(46, 52, 64),
  sidebarSelectedBg: bgRgb(136, 192, 208),
  sidebarMuted: rgb(107, 112, 137),
  bannerBorder: rgb(191, 97, 106),
  bannerText: rgb(191, 97, 106),
  logBorder: rgb(76, 86, 106),
  logBorderInsert: rgb(235, 203, 139),
  logBorderFocus: rgb(163, 190, 140),
  commandPrefix: rgb(136, 192, 208),
  commandInput: rgb(236, 239, 244),
  commandHint: rgb(107, 112, 137),
  statusBg: rgb(59, 66, 82),
  statusText: rgb(236, 239, 244),
  statusIdle: rgb(163, 190, 140),
  statusRunning: rgb(235, 203, 139),
  statusError: rgb(191, 97, 106),
  statusSpawning: rgb(208, 135, 112),
  statusMode: {
    normal: rgb(163, 190, 140),
    'log-focus': rgb(136, 192, 208),
    insert: rgb(163, 190, 140),
    command: rgb(180, 142, 173),
    inbox: rgb(129, 161, 193),
    presets: rgb(129, 161, 193),
    workflows: rgb(129, 161, 193),
    'kill-confirm': rgb(191, 97, 106),
    shell: ANSI_COLORS.brightCyan,
  },
}

const DRACULA: ThemeColors = {
  ...DARK_THEME,
  background: bgRgb(40, 42, 54),
  sidebarBorder: rgb(139, 233, 253),
  sidebarTitle: rgb(248, 248, 242),
  sidebarText: rgb(139, 233, 253),
  sidebarSelected: rgb(40, 42, 54),
  sidebarSelectedBg: bgRgb(139, 233, 253),
  sidebarMuted: rgb(98, 114, 164),
  bannerBorder: rgb(255, 85, 85),
  bannerText: rgb(255, 85, 85),
  logBorder: rgb(68, 71, 90),
  logBorderInsert: rgb(241, 250, 140),
  logBorderFocus: rgb(80, 250, 123),
  commandPrefix: rgb(139, 233, 253),
  commandInput: rgb(248, 248, 242),
  commandHint: rgb(98, 114, 164),
  statusBg: rgb(40, 42, 54),
  statusText: rgb(248, 248, 242),
  statusIdle: rgb(80, 250, 123),
  statusRunning: rgb(241, 250, 140),
  statusError: rgb(255, 85, 85),
  statusSpawning: rgb(255, 184, 108),
  statusMode: {
    normal: rgb(80, 250, 123),
    'log-focus': rgb(139, 233, 253),
    insert: rgb(80, 250, 123),
    command: rgb(189, 147, 249),
    inbox: rgb(139, 233, 253),
    presets: rgb(139, 233, 253),
    workflows: rgb(139, 233, 253),
    'kill-confirm': rgb(255, 85, 85),
    shell: ANSI_COLORS.brightCyan,
  },
}

const ONE_DARK: ThemeColors = {
  ...DARK_THEME,
  background: bgRgb(40, 44, 52),
  sidebarBorder: rgb(97, 175, 239),
  sidebarTitle: rgb(171, 178, 191),
  sidebarText: rgb(97, 175, 239),
  sidebarSelected: rgb(40, 44, 52),
  sidebarSelectedBg: bgRgb(97, 175, 239),
  sidebarMuted: rgb(92, 99, 112),
  bannerBorder: rgb(224, 108, 117),
  bannerText: rgb(224, 108, 117),
  logBorder: rgb(62, 68, 81),
  logBorderInsert: rgb(229, 192, 123),
  logBorderFocus: rgb(152, 195, 121),
  commandPrefix: rgb(97, 175, 239),
  commandInput: rgb(171, 178, 191),
  commandHint: rgb(92, 99, 112),
  statusBg: rgb(40, 44, 52),
  statusText: rgb(171, 178, 191),
  statusIdle: rgb(152, 195, 121),
  statusRunning: rgb(229, 192, 123),
  statusError: rgb(224, 108, 117),
  statusSpawning: rgb(209, 154, 102),
  statusMode: {
    normal: rgb(152, 195, 121),
    'log-focus': rgb(97, 175, 239),
    insert: rgb(152, 195, 121),
    command: rgb(198, 120, 221),
    inbox: rgb(86, 182, 194),
    presets: rgb(86, 182, 194),
    workflows: rgb(86, 182, 194),
    'kill-confirm': rgb(224, 108, 117),
    shell: ANSI_COLORS.brightCyan,
  },
}

const SOLARIZED_DARK: ThemeColors = {
  ...DARK_THEME,
  background: bgRgb(0, 43, 54),
  sidebarBorder: rgb(38, 139, 210),
  sidebarTitle: rgb(131, 148, 150),
  sidebarText: rgb(42, 161, 152),
  sidebarSelected: rgb(0, 43, 54),
  sidebarSelectedBg: bgRgb(42, 161, 152),
  sidebarMuted: rgb(88, 110, 117),
  bannerBorder: rgb(220, 50, 47),
  bannerText: rgb(220, 50, 47),
  logBorder: rgb(88, 110, 117),
  logBorderInsert: rgb(181, 137, 0),
  logBorderFocus: rgb(133, 153, 0),
  commandPrefix: rgb(38, 139, 210),
  commandInput: rgb(147, 161, 161),
  commandHint: rgb(88, 110, 117),
  statusBg: rgb(7, 54, 66),
  statusText: rgb(147, 161, 161),
  statusIdle: rgb(133, 153, 0),
  statusRunning: rgb(181, 137, 0),
  statusError: rgb(220, 50, 47),
  statusSpawning: rgb(203, 75, 22),
  statusMode: {
    normal: rgb(133, 153, 0),
    'log-focus': rgb(38, 139, 210),
    insert: rgb(133, 153, 0),
    command: rgb(108, 113, 196),
    inbox: rgb(42, 161, 152),
    presets: rgb(42, 161, 152),
    workflows: rgb(42, 161, 152),
    'kill-confirm': rgb(220, 50, 47),
    shell: ANSI_COLORS.brightCyan,
  },
}

const SOLARIZED_LIGHT: ThemeColors = {
  ...LIGHT_THEME,
  background: bgRgb(253, 246, 227),
  sidebarBorder: rgb(38, 139, 210),
  sidebarTitle: rgb(88, 110, 117),
  sidebarText: rgb(42, 161, 152),
  sidebarSelected: rgb(253, 246, 227),
  sidebarSelectedBg: bgRgb(38, 139, 210),
  sidebarMuted: rgb(147, 161, 161),
  bannerBorder: rgb(220, 50, 47),
  bannerText: rgb(220, 50, 47),
  logBorder: rgb(147, 161, 161),
  logBorderInsert: rgb(181, 137, 0),
  logBorderFocus: rgb(133, 153, 0),
  commandPrefix: rgb(38, 139, 210),
  commandInput: rgb(88, 110, 117),
  commandHint: rgb(147, 161, 161),
  statusBg: rgb(238, 232, 213),
  statusText: rgb(88, 110, 117),
  statusIdle: rgb(133, 153, 0),
  statusRunning: rgb(181, 137, 0),
  statusError: rgb(220, 50, 47),
  statusSpawning: rgb(203, 75, 22),
  statusMode: {
    normal: rgb(133, 153, 0),
    'log-focus': rgb(38, 139, 210),
    insert: rgb(133, 153, 0),
    command: rgb(108, 113, 196),
    inbox: rgb(42, 161, 152),
    presets: rgb(42, 161, 152),
    workflows: rgb(42, 161, 152),
    'kill-confirm': rgb(220, 50, 47),
    shell: ANSI_COLORS.brightCyan,
  },
}

const MONOKAI: ThemeColors = {
  ...DARK_THEME,
  background: bgRgb(39, 40, 34),
  sidebarBorder: rgb(102, 217, 239),
  sidebarTitle: rgb(248, 248, 242),
  sidebarText: rgb(166, 226, 46),
  sidebarSelected: rgb(39, 40, 34),
  sidebarSelectedBg: bgRgb(249, 38, 114),
  sidebarMuted: rgb(117, 113, 94),
  bannerBorder: rgb(249, 38, 114),
  bannerText: rgb(249, 38, 114),
  logBorder: rgb(117, 113, 94),
  logBorderInsert: rgb(230, 219, 116),
  logBorderFocus: rgb(166, 226, 46),
  commandPrefix: rgb(102, 217, 239),
  commandInput: rgb(248, 248, 242),
  commandHint: rgb(117, 113, 94),
  statusBg: rgb(62, 61, 50),
  statusText: rgb(248, 248, 242),
  statusIdle: rgb(166, 226, 46),
  statusRunning: rgb(230, 219, 116),
  statusError: rgb(249, 38, 114),
  statusSpawning: rgb(253, 151, 31),
  statusMode: {
    normal: rgb(166, 226, 46),
    'log-focus': rgb(102, 217, 239),
    insert: rgb(166, 226, 46),
    command: rgb(174, 129, 255),
    inbox: rgb(102, 217, 239),
    presets: rgb(102, 217, 239),
    workflows: rgb(102, 217, 239),
    'kill-confirm': rgb(249, 38, 114),
    shell: ANSI_COLORS.brightCyan,
  },
}

const ROSE_PINE: ThemeColors = {
  ...DARK_THEME,
  background: bgRgb(25, 23, 36),
  sidebarBorder: rgb(156, 207, 216),
  sidebarTitle: rgb(224, 222, 244),
  sidebarText: rgb(156, 207, 216),
  sidebarSelected: rgb(25, 23, 36),
  sidebarSelectedBg: bgRgb(196, 167, 231),
  sidebarMuted: rgb(110, 106, 134),
  bannerBorder: rgb(235, 111, 146),
  bannerText: rgb(235, 111, 146),
  logBorder: rgb(64, 61, 82),
  logBorderInsert: rgb(246, 193, 119),
  logBorderFocus: rgb(156, 207, 216),
  commandPrefix: rgb(196, 167, 231),
  commandInput: rgb(224, 222, 244),
  commandHint: rgb(110, 106, 134),
  statusBg: rgb(31, 29, 46),
  statusText: rgb(224, 222, 244),
  statusIdle: rgb(156, 207, 216),
  statusRunning: rgb(246, 193, 119),
  statusError: rgb(235, 111, 146),
  statusSpawning: rgb(234, 154, 151),
  statusMode: {
    normal: rgb(156, 207, 216),
    'log-focus': rgb(196, 167, 231),
    insert: rgb(156, 207, 216),
    command: rgb(196, 167, 231),
    inbox: rgb(156, 207, 216),
    presets: rgb(156, 207, 216),
    workflows: rgb(156, 207, 216),
    'kill-confirm': rgb(235, 111, 146),
    shell: ANSI_COLORS.brightCyan,
  },
}

const EVERFOREST: ThemeColors = {
  ...DARK_THEME,
  background: bgRgb(45, 53, 38),
  sidebarBorder: rgb(131, 165, 152),
  sidebarTitle: rgb(211, 198, 170),
  sidebarText: rgb(131, 165, 152),
  sidebarSelected: rgb(45, 53, 38),
  sidebarSelectedBg: bgRgb(163, 190, 140),
  sidebarMuted: rgb(122, 128, 106),
  bannerBorder: rgb(230, 126, 128),
  bannerText: rgb(230, 126, 128),
  logBorder: rgb(85, 89, 72),
  logBorderInsert: rgb(219, 188, 127),
  logBorderFocus: rgb(163, 190, 140),
  commandPrefix: rgb(131, 165, 152),
  commandInput: rgb(211, 198, 170),
  commandHint: rgb(122, 128, 106),
  statusBg: rgb(52, 60, 46),
  statusText: rgb(211, 198, 170),
  statusIdle: rgb(163, 190, 140),
  statusRunning: rgb(219, 188, 127),
  statusError: rgb(230, 126, 128),
  statusSpawning: rgb(230, 165, 132),
  statusMode: {
    normal: rgb(163, 190, 140),
    'log-focus': rgb(131, 165, 152),
    insert: rgb(163, 190, 140),
    command: rgb(214, 153, 182),
    inbox: rgb(131, 165, 152),
    presets: rgb(131, 165, 152),
    workflows: rgb(131, 165, 152),
    'kill-confirm': rgb(230, 126, 128),
    shell: ANSI_COLORS.brightCyan,
  },
}

const KANAGAWA: ThemeColors = {
  ...DARK_THEME,
  background: bgRgb(31, 31, 40),
  sidebarBorder: rgb(122, 162, 247),
  sidebarTitle: rgb(220, 215, 186),
  sidebarText: rgb(125, 196, 228),
  sidebarSelected: rgb(31, 31, 40),
  sidebarSelectedBg: bgRgb(149, 127, 184),
  sidebarMuted: rgb(114, 117, 146),
  bannerBorder: rgb(228, 104, 118),
  bannerText: rgb(228, 104, 118),
  logBorder: rgb(54, 58, 79),
  logBorderInsert: rgb(223, 188, 110),
  logBorderFocus: rgb(152, 187, 108),
  commandPrefix: rgb(122, 162, 247),
  commandInput: rgb(220, 215, 186),
  commandHint: rgb(114, 117, 146),
  statusBg: rgb(42, 46, 66),
  statusText: rgb(220, 215, 186),
  statusIdle: rgb(152, 187, 108),
  statusRunning: rgb(223, 188, 110),
  statusError: rgb(228, 104, 118),
  statusSpawning: rgb(255, 160, 102),
  statusMode: {
    normal: rgb(152, 187, 108),
    'log-focus': rgb(122, 162, 247),
    insert: rgb(152, 187, 108),
    command: rgb(149, 127, 184),
    inbox: rgb(125, 196, 228),
    presets: rgb(125, 196, 228),
    workflows: rgb(125, 196, 228),
    'kill-confirm': rgb(228, 104, 118),
    shell: ANSI_COLORS.brightCyan,
  },
}

// Uses the terminal's own 16 ANSI color slots — follows whatever terminal theme is active.
const BASE16: ThemeColors = {
  background: 'transparent',
  sidebarBorder: ANSI_COLORS.cyan,
  sidebarTitle: ANSI_COLORS.brightWhite,
  sidebarText: ANSI_COLORS.cyan,
  sidebarSelected: ANSI_COLORS.black,
  sidebarSelectedBg: '46',
  sidebarMuted: ANSI_COLORS.gray,
  bannerBorder: ANSI_COLORS.red,
  bannerText: ANSI_COLORS.red,
  logBorder: ANSI_COLORS.gray,
  logBorderInsert: ANSI_COLORS.yellow,
  logBorderFocus: ANSI_COLORS.brightGreen,
  commandPrefix: ANSI_COLORS.brightCyan,
  commandInput: ANSI_COLORS.brightWhite,
  commandHint: ANSI_COLORS.gray,
  statusBg: ANSI_COLORS.gray,
  statusText: ANSI_COLORS.brightWhite,
  statusIdle: ANSI_COLORS.brightGreen,
  statusRunning: ANSI_COLORS.brightYellow,
  statusError: ANSI_COLORS.red,
  statusSpawning: ANSI_COLORS.yellow,
  statusMode: {
    normal: ANSI_COLORS.brightGreen,
    'log-focus': ANSI_COLORS.cyan,
    insert: ANSI_COLORS.brightGreen,
    command: ANSI_COLORS.magenta,
    inbox: ANSI_COLORS.blue,
    presets: ANSI_COLORS.blue,
    workflows: ANSI_COLORS.blue,
    'kill-confirm': ANSI_COLORS.red,
    shell: ANSI_COLORS.brightCyan,
  },
}

const BUILT_IN_THEMES: Record<string, ThemeColors> = {
  dark: DARK_THEME,
  light: LIGHT_THEME,
  minimal: MINIMAL_THEME,
  'base16': BASE16,
  catppuccin: CATPPUCCIN_MOCHA,
  gruvbox: GRUVBOX_DARK,
  'tokyo-night': TOKYO_NIGHT,
  nord: NORD,
  dracula: DRACULA,
  'one-dark': ONE_DARK,
  'solarized-dark': SOLARIZED_DARK,
  'solarized-light': SOLARIZED_LIGHT,
  monokai: MONOKAI,
  'rose-pine': ROSE_PINE,
  everforest: EVERFOREST,
  kanagawa: KANAGAWA,
}

let currentThemeName = 'dark'
let currentTheme: ThemeColors = DARK_THEME
let themeCatalog: Record<string, ThemeColors> = { ...BUILT_IN_THEMES }
let themeNames: string[] = Object.keys(themeCatalog).sort()
let legacyThemeOverride: ThemeOverride | null = null

function readThemeOverride(path: string): ThemeOverride | null {
  try {
    if (!existsSync(path)) return null
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    return parseThemeOverride(parsed)
  } catch {
    return null
  }
}

function loadLegacyThemeOverride(): ThemeOverride | null {
  return readThemeOverride(join(fltDir(), 'theme.json'))
}

function loadUserThemeOverrides(): Record<string, ThemeOverride> {
  const out: Record<string, ThemeOverride> = {}
  const dir = join(fltDir(), 'themes')
  try {
    if (!existsSync(dir)) return out
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      if (!entry.name.endsWith('.json')) continue
      const themeName = entry.name.slice(0, -'.json'.length)
      if (!themeName) continue
      const parsed = readThemeOverride(join(dir, entry.name))
      if (parsed) out[themeName] = parsed
    }
  } catch {
    // best effort
  }
  return out
}

function resolveNamedTheme(
  name: string,
  overrides: Record<string, ThemeOverride>,
  cache: Record<string, ThemeColors>,
  visiting: Set<string>,
): ThemeColors | null {
  const builtIn = BUILT_IN_THEMES[name]
  if (builtIn) return builtIn

  const cached = cache[name]
  if (cached) return cached

  const override = overrides[name]
  if (!override) return null
  if (visiting.has(name)) return null

  visiting.add(name)
  try {
    const baseName = override.extends
    const baseTheme = baseName
      ? (resolveNamedTheme(baseName, overrides, cache, visiting) ?? DARK_THEME)
      : DARK_THEME

    const resolved = mergeTheme(baseTheme, override)
    cache[name] = resolved
    return resolved
  } finally {
    visiting.delete(name)
  }
}

function refreshThemeCatalog(): void {
  const userOverrides = loadUserThemeOverrides()
  const resolvedUsers: Record<string, ThemeColors> = {}
  const visiting = new Set<string>()

  for (const name of Object.keys(userOverrides)) {
    if (BUILT_IN_THEMES[name]) continue
    const resolved = resolveNamedTheme(name, userOverrides, resolvedUsers, visiting)
    if (resolved) resolvedUsers[name] = resolved
  }

  themeCatalog = {
    ...BUILT_IN_THEMES,
    ...resolvedUsers,
  }
  themeNames = Object.keys(themeCatalog).sort()
  legacyThemeOverride = loadLegacyThemeOverride()
}

function persistThemeName(name: string): void {
  try {
    const dir = fltDir()
    mkdirSync(dir, { recursive: true })
    const configPath = join(dir, 'config.json')
    let config: Record<string, unknown> = {}
    if (existsSync(configPath)) {
      config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>
    }
    config.theme = name
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
  } catch {
    // best effort
  }
}

function loadPersistedThemeName(): string | null {
  try {
    const configPath = join(fltDir(), 'config.json')
    if (!existsSync(configPath)) return null
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>
    return typeof config.theme === 'string' ? config.theme : null
  } catch {
    return null
  }
}

export function getThemeNames(): string[] {
  refreshThemeCatalog()
  return [...themeNames]
}

export function setTheme(name: string): boolean {
  refreshThemeCatalog()
  const baseTheme = themeCatalog[name]
  if (!baseTheme) return false

  currentThemeName = name
  currentTheme = mergeTheme(baseTheme, legacyThemeOverride)
  persistThemeName(name)
  return true
}

export function getTheme(): ThemeColors {
  return currentTheme
}

export function getCurrentThemeName(): string {
  return currentThemeName
}

export function backgroundToSgr(background: ThemeBackground): string {
  return background === 'transparent' ? '' : background
}

export function getThemeBackground(): string {
  return backgroundToSgr(getTheme().background)
}

// Initialize from config/theme files.
{
  refreshThemeCatalog()

  let initialThemeName = 'dark'
  const persisted = loadPersistedThemeName()
  if (persisted && themeCatalog[persisted]) {
    initialThemeName = persisted
  }

  // Legacy ~/.flt/theme.json compatibility:
  // if it specified `extends`, it controls the startup base theme.
  const legacy = legacyThemeOverride
  if (legacy && typeof legacy.extends === 'string' && themeCatalog[legacy.extends]) {
    initialThemeName = legacy.extends
  }

  currentThemeName = initialThemeName
  currentTheme = mergeTheme(themeCatalog[initialThemeName] ?? DARK_THEME, legacyThemeOverride)
}

export const COLORS = ANSI_COLORS

export function fg(name: string | undefined): string {
  if (!name) return COLORS.default
  // Support both named colors and raw ANSI codes (for example '38;2;R;G;B').
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
    case 'exited':
    case 'unknown':
      return COLORS.gray
    default:
      return theme.sidebarText
  }
}

export function statusSymbol(status: AgentView['status']): string {
  switch (status) {
    case 'running':
      return '▶'
    case 'idle':
    case 'ready':
      return '⏸'
    case 'exited':
      return '○'
    case 'spawning':
    case 'unknown':
    default:
      return '?'
  }
}
