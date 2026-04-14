import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { Mode } from './types'

export type ConfigurableMode = Exclude<Mode, 'insert' | 'shell'>

export type KeybindAction =
  | 'selectNext'
  | 'selectPrev'
  | 'openCommand'
  | 'openSpawn'
  | 'killConfirm'
  | 'openInbox'
  | 'reply'
  | 'openShell'
  | 'quit'
  | 'focusLog'
  | 'toggleCollapse'
  | 'enterInsert'
  | 'scrollDown'
  | 'scrollUp'
  | 'jumpBottom'
  | 'jumpTop'
  | 'search'
  | 'back'
  | 'pageDown'
  | 'pageUp'
  | 'msgDown'
  | 'msgUp'
  | 'delete'
  | 'clearAll'
  | 'execute'
  | 'complete'
  | 'cancel'
  | 'confirm'
  | 'backspace'

export type ModeKeybinds = Record<string, string>
export type KeybindConfig = Record<ConfigurableMode, ModeKeybinds>

const MODE_ORDER: ConfigurableMode[] = ['normal', 'log-focus', 'inbox', 'command', 'kill-confirm', 'presets']

const SPECIAL_KEY_NAMES: Record<string, string> = {
  enter: 'Enter',
  tab: 'Tab',
  'shift-tab': 'Shift-Tab',
  escape: 'Escape',
  backspace: 'Backspace',
  'shift-enter': 'Shift-Enter',
  'ctrl-d': 'Ctrl-d',
  'ctrl-u': 'Ctrl-u',
  'alt-backspace': 'Alt-Backspace',
  'alt-d': 'Alt-d',
}

const ACTION_LABELS: Record<KeybindAction, string> = {
  selectNext: 'select',
  selectPrev: 'select',
  openCommand: 'cmd',
  openSpawn: 'spawn',
  killConfirm: 'kill',
  openInbox: 'inbox',
  reply: 'reply',
  openShell: 'shell',
  quit: 'quit',
  focusLog: 'focus',
  toggleCollapse: 'collapse',
  enterInsert: 'insert',
  scrollDown: 'scroll',
  scrollUp: 'scroll',
  jumpBottom: 'bottom/top',
  jumpTop: 'bottom/top',
  search: 'search',
  back: 'back',
  pageDown: 'page',
  pageUp: 'page',
  msgDown: 'select',
  msgUp: 'select',
  delete: 'delete',
  clearAll: 'clear all',
  execute: 'execute',
  complete: 'complete',
  cancel: 'cancel',
  confirm: 'confirm',
  backspace: 'backspace',
}

const PAIR_GROUPS: Array<{ a: KeybindAction; b: KeybindAction; label: string }> = [
  { a: 'selectNext', b: 'selectPrev', label: 'select' },
  { a: 'scrollDown', b: 'scrollUp', label: 'scroll' },
  { a: 'pageDown', b: 'pageUp', label: 'page' },
  { a: 'jumpBottom', b: 'jumpTop', label: 'bottom/top' },
  { a: 'msgDown', b: 'msgUp', label: 'select' },
]

const STATIC_MODE_HINTS: Record<Extract<Mode, 'insert' | 'shell'>, string> = {
  insert: 'typing to agent | Ctrl-c interrupt | Esc exit',
  shell: 'typing in shell | Esc close',
}

const KEYBIND_ACTION_SET: ReadonlySet<string> = new Set<string>([
  'selectNext',
  'selectPrev',
  'openCommand',
  'openSpawn',
  'killConfirm',
  'openInbox',
  'reply',
  'openShell',
  'quit',
  'focusLog',
  'toggleCollapse',
  'enterInsert',
  'scrollDown',
  'scrollUp',
  'jumpBottom',
  'jumpTop',
  'search',
  'back',
  'pageDown',
  'pageUp',
  'msgDown',
  'msgUp',
  'delete',
  'clearAll',
  'execute',
  'complete',
  'cancel',
  'confirm',
  'backspace',
])

export const DEFAULT_KEYBINDS: KeybindConfig = {
  normal: {
    j: 'selectNext',
    k: 'selectPrev',
    ':': 'openCommand',
    s: 'openSpawn',
    K: 'killConfirm',
    m: 'openInbox',
    r: 'reply',
    t: 'openShell',
    q: 'quit',
    Enter: 'focusLog',
    Tab: 'focusLog',
    'Shift-Enter': 'toggleCollapse',
  },
  'log-focus': {
    i: 'enterInsert',
    j: 'scrollDown',
    k: 'scrollUp',
    G: 'jumpBottom',
    g: 'jumpTop',
    '/': 'search',
    r: 'reply',
    Escape: 'back',
    'Ctrl-d': 'pageDown',
    'Ctrl-u': 'pageUp',
  },
  inbox: {
    j: 'msgDown',
    k: 'msgUp',
    r: 'reply',
    d: 'delete',
    D: 'clearAll',
    Escape: 'back',
  },
  command: {
    Enter: 'execute',
    Tab: 'complete',
    'Shift-Tab': 'complete',
    Escape: 'cancel',
    Backspace: 'backspace',
  },
  'kill-confirm': {
    y: 'confirm',
    n: 'cancel',
    Escape: 'cancel',
  },
  presets: {
    ':': 'openCommand',
    Escape: 'back',
  },
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeKeyName(key: string): string {
  const trimmed = key.trim()
  if (!trimmed) return ''
  if (trimmed.length === 1) return trimmed

  const lower = trimmed.toLowerCase()
  return SPECIAL_KEY_NAMES[lower] ?? trimmed
}

function normalizeModeKeybinds(input: unknown): ModeKeybinds {
  if (!isObject(input)) return {}

  const out: ModeKeybinds = {}
  for (const [rawKey, rawAction] of Object.entries(input)) {
    if (typeof rawAction !== 'string') continue
    const key = normalizeKeyName(rawKey)
    if (!key) continue
    out[key] = rawAction
  }
  return out
}

function loadUserKeybindOverrides(): Partial<KeybindConfig> {
  try {
    const home = process.env.HOME || homedir()
    const path = join(home, '.flt', 'keybinds.json')
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    if (!isObject(parsed)) return {}

    const overrides: Partial<KeybindConfig> = {}
    for (const mode of MODE_ORDER) {
      overrides[mode] = normalizeModeKeybinds(parsed[mode])
    }
    return overrides
  } catch {
    return {}
  }
}

function mergeKeybinds(defaults: KeybindConfig, overrides: Partial<KeybindConfig>): KeybindConfig {
  return {
    normal: { ...defaults.normal, ...(overrides.normal ?? {}) },
    'log-focus': { ...defaults['log-focus'], ...(overrides['log-focus'] ?? {}) },
    inbox: { ...defaults.inbox, ...(overrides.inbox ?? {}) },
    command: { ...defaults.command, ...(overrides.command ?? {}) },
    'kill-confirm': { ...defaults['kill-confirm'], ...(overrides['kill-confirm'] ?? {}) },
    presets: { ...defaults.presets, ...(overrides.presets ?? {}) },
  }
}

let mergedKeybinds: KeybindConfig | null = null

function getMergedKeybinds(): KeybindConfig {
  if (!mergedKeybinds) {
    mergedKeybinds = mergeKeybinds(DEFAULT_KEYBINDS, loadUserKeybindOverrides())
  }
  return mergedKeybinds
}

export function getKeybinds(): KeybindConfig {
  return getMergedKeybinds()
}

export function reloadKeybinds(): void {
  mergedKeybinds = null
}

export function isConfigurableMode(mode: Mode): mode is ConfigurableMode {
  return mode !== 'insert' && mode !== 'shell'
}

export function getKeybindAction(mode: Mode, key: string): KeybindAction | undefined {
  if (!isConfigurableMode(mode)) return undefined
  const canonical = normalizeKeyName(key)
  if (!canonical) return undefined
  const action = getMergedKeybinds()[mode][canonical]
  if (!KEYBIND_ACTION_SET.has(action)) return undefined
  return action as KeybindAction
}

function buildModeHint(modeKeybinds: ModeKeybinds): string {
  const entries = Object.entries(modeKeybinds)
  const actionKeys = new Map<string, string[]>()

  for (const [key, action] of entries) {
    const keys = actionKeys.get(action)
    if (keys) keys.push(key)
    else actionKeys.set(action, [key])
  }

  const consumed = new Set<string>()
  const parts: string[] = []

  for (const pair of PAIR_GROUPS) {
    const aKeys = actionKeys.get(pair.a)
    const bKeys = actionKeys.get(pair.b)
    if (!aKeys || !bKeys || aKeys.length === 0 || bKeys.length === 0) continue

    const aKey = aKeys[0]
    const bKey = bKeys[0]
    consumed.add(`${aKey}\u0000${pair.a}`)
    consumed.add(`${bKey}\u0000${pair.b}`)
    parts.push(`${aKey}/${bKey} ${pair.label}`)
  }

  for (const [key, action] of entries) {
    if (consumed.has(`${key}\u0000${action}`)) continue
    const label = KEYBIND_ACTION_SET.has(action)
      ? ACTION_LABELS[action as KeybindAction]
      : action
    parts.push(`${key} ${label}`)
  }

  return parts.join(' | ')
}

export function getModeHint(mode: Mode): string {
  if (mode === 'insert' || mode === 'shell') {
    return STATIC_MODE_HINTS[mode]
  }
  return buildModeHint(getMergedKeybinds()[mode])
}

export function getModeKeybinds(mode: Mode): ModeKeybinds {
  if (!isConfigurableMode(mode)) return {}
  return getMergedKeybinds()[mode]
}

export function getKeybindsBanner(mode: Mode): string {
  const hint = getModeHint(mode)
  return `${mode} keybinds: ${hint || 'none configured'}`
}
