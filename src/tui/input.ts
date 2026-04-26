import { StringDecoder } from 'string_decoder'
import { getKeybindAction, type ConfigurableMode, type KeybindAction } from './keybinds'
import type { WorkflowFilter } from '../metrics-workflows'
import type { AgentView, AppState, CompletionItem, InboxMessage, Mode, ModalState } from './types'

export type TmuxInsertKey =
  | 'Enter'
  | 'BSpace'
  | 'Tab'
  | 'Up'
  | 'Down'
  | 'Left'
  | 'Right'
  | 'PPage'
  | 'NPage'
  | 'C-c'
  | 'M-BSpace'
  | 'C-u'
  | 'C-d'
  | 'M-d'
  | 'C-M-y'
  | 'C-M-e'

export type ParsedInputEvent =
  | { type: 'key'; key: string; raw: Buffer }
  | { type: 'text'; text: string; raw: Buffer }

export interface InputBindings {
  getState: () => AppState & { selectedAgent?: AgentView }
  getAgentNames: () => string[]
  getCliAdapters: () => string[]
  getPresetNames: () => string[]
  setMode: (mode: Mode) => void
  openCommand: (initial: string) => void
  setCommand: (input: string, cursor: number) => void
  selectNext: () => void
  selectPrev: () => void
  scrollLogUp: () => void
  scrollLogDown: () => void
  scrollLogPageUp: () => void
  scrollLogPageDown: () => void
  jumpLogTop: () => void
  jumpLogBottom: () => void
  inboxMsgDown: () => void
  inboxMsgUp: () => void
  inboxReply: () => void
  inboxDeleteCard: () => void
  inboxClearAll: () => void
  setSearchQuery: (query: string) => void
  submitCommand: (input: string) => void
  setKillConfirm: (agentName: string) => void
  confirmKill: () => void
  cancelKill: () => void
  toggleCollapse: () => void
  sendInsertText: (text: string) => void
  sendInsertKey: (key: TmuxInsertKey) => void
  flushInsert: () => void
  openShell: () => void
  closeShell: () => void
  sendShellText: (text: string) => void
  sendShellKey: (key: TmuxInsertKey) => void
  flushShell: () => void
  quit: () => void
  onResize?: () => void
  openSpawnModal: () => void
  openWorkflowsModal: () => void
  closeWorkflowsModal: () => void
  setWorkflowFilter: (filter: WorkflowFilter) => void
  workflowsSelectNext: () => void
  workflowsSelectPrev: () => void
  openWorkflowDrilldown: () => void
  closeWorkflowDrilldown: () => void
  setModalField: (fieldIndex: number, value: string, cursor: number) => void
  modalNextField: () => void
  modalPrevField: () => void
  modalSelectUp: () => void
  modalSelectDown: () => void
  submitModal: () => void
  cancelModal: () => void
  setCompletionPopup: (items: CompletionItem[], selectedIndex: number) => void
  setCompletionSelectedIndex: (index: number) => void
  closeCompletionPopup: () => void
}

const COMMANDS = ['send', 'logs', 'spawn', 'presets', 'kill', 'theme', 'ascii', 'keybinds', 'help']
const SPAWN_FLAGS = ['--cli', '--model', '--dir', '--preset', '--persistent', '--no-worktree', '--parent', '--skill', '--all-skills', '--no-model-resolve']
const PRESETS_ACTIONS = ['list', 'add', 'remove']
const PRESETS_ADD_FLAGS = ['--cli', '--model', '--description']

const COMMAND_DESCRIPTIONS: Record<string, string> = {
  send: 'Send message to agent',
  logs: 'View agent logs',
  spawn: 'Spawn a new agent',
  presets: 'Manage agent presets',
  kill: 'Kill an agent',
  theme: 'Change UI theme',
  ascii: 'Customize ASCII logo',
  keybinds: 'Show keybindings',
  help: 'Show help',
}

const FLAG_DESCRIPTIONS: Record<string, string> = {
  '--cli': 'CLI adapter',
  '--model': 'Model name',
  '--dir': 'Working directory',
  '--preset': 'Preset name',
  '--persistent': 'Keep alive',
  '--no-worktree': 'Skip worktree',
  '--parent': 'Parent agent',
  '--skill': 'Enable skill for this spawn',
  '--all-skills': 'Enable all skills',
  '--no-model-resolve': 'Disable model alias resolution',
}

const PRESET_ACTION_DESCRIPTIONS: Record<string, string> = {
  list: 'List all presets',
  add: 'Add new preset',
  remove: 'Remove preset',
}

// Load model suggestions from ~/.flt/models.json (user-configurable)
function loadModelSuggestions(): Record<string, string[]> {
  const defaults: Record<string, string[]> = {
    'claude-code': ['haiku', 'sonnet', 'opus[1m]', 'sonnet[1m]'],
    codex: ['gpt-5.3-codex', 'gpt-5.4-mini', 'gpt-5.4', 'o3', 'gpt-4.1'],
    gemini: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    opencode: ['gpt-5.3', 'gpt-5.4-mini', 'o3'],
    'swe-agent': ['sonnet', 'gpt-4.1'],
    pi: ['gpt-5.4', 'gpt-5.4-mini'],
  }
  try {
    const { readFileSync } = require('fs')
    const { join } = require('path')
    const home = process.env.HOME || require('os').homedir()
    const loaded = JSON.parse(readFileSync(join(home, '.flt', 'models.json'), 'utf-8'))
    return { ...defaults, ...loaded }
  } catch {
    return defaults
  }
}

const MODEL_SUGGESTIONS = loadModelSuggestions()

function fuzzyMatch(text: string, query: string): boolean {
  let ti = 0
  const tl = text.toLowerCase()
  const ql = query.toLowerCase()
  for (let qi = 0; qi < ql.length; qi++) {
    const idx = tl.indexOf(ql[qi], ti)
    if (idx === -1) return false
    ti = idx + 1
  }
  return true
}

function matchCandidates(candidates: string[], prefix: string): string[] {
  if (!prefix) return candidates.filter(c => c !== prefix)
  const exact = candidates.filter(c => c.startsWith(prefix) && c !== prefix)
  const fuzzy = candidates.filter(c => !c.startsWith(prefix) && c !== prefix && fuzzyMatch(c, prefix))
  return [...exact, ...fuzzy]
}

const completionRecency = new Map<string, number>()

function sortCompletionItems(items: CompletionItem[], prefix: string): void {
  items.sort((a, b) => {
    const ra = a.value.toLowerCase().startsWith(prefix.toLowerCase()) ? 0 : 1
    const rb = b.value.toLowerCase().startsWith(prefix.toLowerCase()) ? 0 : 1
    if (ra !== rb) return ra - rb
    const ta = completionRecency.get(a.value) ?? 0
    const tb = completionRecency.get(b.value) ?? 0
    if (ta !== tb) return tb - ta
    return a.value.localeCompare(b.value)
  })
}

function toItems(values: string[], label?: string, descriptions?: Record<string, string>): CompletionItem[] {
  return values.map(v => ({ value: v, label, description: descriptions?.[v] }))
}

interface CompletionResult {
  items: CompletionItem[]
  currentToken: string
}

function listSkillNames(): string[] {
  const { existsSync, readdirSync, lstatSync } = require('fs') as typeof import('fs')
  const { join } = require('path') as typeof import('path')
  const home = process.env.HOME || require('os').homedir()
  const roots = [join(process.cwd(), '.flt', 'skills'), join(home, '.flt', 'skills')]
  const names = new Set<string>()

  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root)) {
      const p = join(root, entry)
      try {
        if (!lstatSync(p).isDirectory()) continue
      } catch {
        continue
      }
      if (existsSync(join(p, 'SKILL.md'))) names.add(entry)
    }
  }

  return Array.from(names).sort((a, b) => a.localeCompare(b))
}

function parseInboxSender(messages: InboxMessage[]): string | undefined {
  if (messages.length === 0) return undefined
  return messages[messages.length - 1].from
}

function commonPrefix(strings: string[]): string {
  if (strings.length === 0) return ''
  let prefix = strings[0]
  for (let i = 1; i < strings.length; i += 1) {
    while (!strings[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1)
      if (!prefix) return ''
    }
  }
  return prefix
}

function getCompletions(
  input: string,
  agentNames: string[],
  cliAdapters: string[],
  presetNames: string[],
): CompletionResult {
  const parts = input.split(/\s+/)
  const empty: CompletionResult = { items: [], currentToken: '' }

  if (parts.length <= 1) {
    const prefix = parts[0] || ''
    const matched = matchCandidates(COMMANDS, prefix)
    return {
      items: toItems(matched, 'cmd', COMMAND_DESCRIPTIONS),
      currentToken: prefix,
    }
  }

  const cmd = parts[0]

  if (['send', 'logs', 'kill'].includes(cmd) && parts.length === 2) {
    const prefix = parts[1] || ''
    const matched = matchCandidates(agentNames, prefix)
    return {
      items: toItems(matched, 'agent'),
      currentToken: prefix,
    }
  }

  if (cmd === 'theme' && parts.length === 2) {
    const { getThemeNames } = require('./theme')
    const names: string[] = getThemeNames()
    const prefix = parts[1] || ''
    const matched = matchCandidates(names, prefix)
    return {
      items: toItems(matched, 'theme'),
      currentToken: prefix,
    }
  }

  if (cmd === 'spawn') {
    const lastPart = parts[parts.length - 1] || ''
    const prevPart = parts.length >= 2 ? parts[parts.length - 2] : ''

    if (parts.length === 2) return empty

    if (prevPart === '--cli' || prevPart === '-c') {
      const matched = matchCandidates(cliAdapters, lastPart)
      return { items: toItems(matched, 'cli'), currentToken: lastPart }
    }

    if (prevPart === '--model' || prevPart === '-m') {
      const cliIdx = parts.indexOf('--cli')
      const selectedCli = cliIdx !== -1 && cliIdx + 1 < parts.length ? parts[cliIdx + 1] : ''
      const models = MODEL_SUGGESTIONS[selectedCli]
        ?? Array.from(new Set(Object.values(MODEL_SUGGESTIONS).flat()))
      const matched = matchCandidates(models, lastPart)
      return { items: toItems(matched, 'model'), currentToken: lastPart }
    }

    if (prevPart === '--preset' || prevPart === '-p') {
      const matched = matchCandidates(presetNames, lastPart)
      return { items: toItems(matched, 'preset'), currentToken: lastPart }
    }

    if (prevPart === '--skill') {
      const matched = matchCandidates(listSkillNames(), lastPart)
      return { items: toItems(matched, 'skill'), currentToken: lastPart }
    }

    if (lastPart.startsWith('-')) {
      const usedFlags = parts.filter((p) => p.startsWith('--'))
      const available = SPAWN_FLAGS.filter((f) => !usedFlags.includes(f))
      const matched = matchCandidates(available, lastPart)
      return { items: toItems(matched, 'flag', FLAG_DESCRIPTIONS), currentToken: lastPart }
    }

    if (prevPart !== '--dir') {
      const usedFlags = parts.filter((p) => p.startsWith('--'))
      const available = SPAWN_FLAGS.filter((f) => !usedFlags.includes(f))
      if (available.length > 0 && lastPart === '') {
        return { items: toItems(available, 'flag', FLAG_DESCRIPTIONS), currentToken: '' }
      }
    }
  }

  if (cmd === 'presets') {
    const lastPart = parts[parts.length - 1] || ''
    const prevPart = parts.length >= 2 ? parts[parts.length - 2] : ''

    if (parts.length === 2) {
      const prefix = parts[1] || ''
      const matched = matchCandidates(PRESETS_ACTIONS, prefix)
      return {
        items: toItems(matched, 'action', PRESET_ACTION_DESCRIPTIONS),
        currentToken: prefix,
      }
    }

    const action = parts[1]
    if (action === 'remove' && parts.length === 3) {
      const matched = matchCandidates(presetNames, lastPart)
      return { items: toItems(matched, 'preset'), currentToken: lastPart }
    }

    if (action === 'add') {
      if (prevPart === '--cli' || prevPart === '-c') {
        const matched = matchCandidates(cliAdapters, lastPart)
        return { items: toItems(matched, 'cli'), currentToken: lastPart }
      }

      if (prevPart === '--model') {
        const cliIdx = parts.indexOf('--cli')
        const selectedCli = cliIdx !== -1 && cliIdx + 1 < parts.length ? parts[cliIdx + 1] : ''
        const models = MODEL_SUGGESTIONS[selectedCli]
          ?? Array.from(new Set(Object.values(MODEL_SUGGESTIONS).flat()))
        const matched = matchCandidates(models, lastPart)
        return { items: toItems(matched, 'model'), currentToken: lastPart }
      }

      if (lastPart.startsWith('-')) {
        const usedFlags = parts.filter((p) => p.startsWith('--'))
        const available = PRESETS_ADD_FLAGS.filter((f) => !usedFlags.includes(f))
        const matched = matchCandidates(available, lastPart)
        return { items: toItems(matched, 'flag', FLAG_DESCRIPTIONS), currentToken: lastPart }
      }
    }
  }

  return empty
}

function applySingleCompletion(input: string, completion: string): string {
  const parts = input.split(/\s+/)
  if (parts.length <= 1) return `${completion} `
  parts[parts.length - 1] = completion
  return `${parts.join(' ')} `
}

export function getCompletionHint(
  input: string,
  agentNames: string[],
  cliAdapters: string[],
  presetNames: string[] = [],
): { hint: string; multiHint: string } {
  const { items, currentToken } = getCompletions(input, agentNames, cliAdapters, presetNames)
  if (items.length === 1) {
    return { hint: items[0].value.slice(currentToken.length), multiHint: '' }
  }
  if (items.length > 1 && items.length <= 6) {
    return { hint: '', multiHint: items.map(i => i.value).join(' | ') }
  }
  return { hint: '', multiHint: '' }
}

export function getCompletionItems(
  input: string,
  agentNames: string[],
  cliAdapters: string[],
  presetNames: string[],
): CompletionItem[] {
  const { items, currentToken } = getCompletions(input, agentNames, cliAdapters, presetNames)
  sortCompletionItems(items, currentToken)
  return items
}

function isControlByte(byte: number): boolean {
  return byte < 0x20 || byte === 0x7f
}

function isCsiFinal(byte: number): boolean {
  return byte >= 0x40 && byte <= 0x7e
}

export class RawKeyParser {
  private decoder = new StringDecoder('utf8')
  private pendingEscape: Buffer | null = null
  private escapeTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly onEvent: (event: ParsedInputEvent) => void,
    private readonly escapeTimeoutMs = 50,
  ) {}

  feed(buf: Buffer): void {
    let data = buf

    if (this.pendingEscape) {
      this.clearEscapeTimer()
      data = Buffer.concat([this.pendingEscape, buf])
      this.pendingEscape = null
    }

    this.parseBuffer(data)
  }

  flushPendingEscape(): void {
    if (!this.pendingEscape) return

    const pending = this.pendingEscape
    this.pendingEscape = null
    this.clearEscapeTimer()

    this.onEvent({ type: 'key', key: 'escape', raw: Buffer.from([0x1b]) })

    if (pending.length > 1) {
      this.parseBuffer(pending.subarray(1))
    }
  }

  dispose(): void {
    this.clearEscapeTimer()
  }

  private clearEscapeTimer(): void {
    if (this.escapeTimer) {
      clearTimeout(this.escapeTimer)
      this.escapeTimer = null
    }
  }

  private armEscapeTimer(): void {
    this.clearEscapeTimer()
    this.escapeTimer = setTimeout(() => {
      this.flushPendingEscape()
    }, this.escapeTimeoutMs)
  }

  private parseBuffer(buf: Buffer): void {
    let i = 0

    while (i < buf.length) {
      const byte = buf[i]

      if (byte === 0x1b) {
        if (i + 1 >= buf.length) {
          this.pendingEscape = buf.subarray(i)
          this.armEscapeTimer()
          return
        }

        // OSC sequence: \x1b] ... ST — skip it entirely (file drops, clipboard, etc.)
        if (buf[i + 1] === 0x5d) {
          let j = i + 2
          while (j < buf.length) {
            // String Terminator: \x1b\\ or \x07
            if (buf[j] === 0x07) { j += 1; break }
            if (buf[j] === 0x1b && j + 1 < buf.length && buf[j + 1] === 0x5c) { j += 2; break }
            j += 1
          }
          if (j >= buf.length && buf[buf.length - 1] !== 0x07) {
            // Incomplete OSC — drop it, don't hang
            i = buf.length
            continue
          }
          i = j
          continue
        }

        // Option+Backspace: \x1b\x7f → delete word
        if (buf[i + 1] === 0x7f) {
          this.onEvent({ type: 'key', key: 'alt-backspace', raw: buf.subarray(i, i + 2) })
          i += 2
          continue
        }

        // Option+d: \x1b d → delete word forward (common in shells)
        if (buf[i + 1] === 0x64) {
          this.onEvent({ type: 'key', key: 'alt-d', raw: buf.subarray(i, i + 2) })
          i += 2
          continue
        }

        if (buf[i + 1] === 0x5b) {
          if (i + 2 >= buf.length) {
            this.pendingEscape = buf.subarray(i)
            this.armEscapeTimer()
            return
          }

          // Bracketed paste: \x1b[200~ ... \x1b[201~
          // Extract the pasted text and emit as a single text event
          if (i + 5 < buf.length && buf.subarray(i, i + 6).toString() === '\x1b[200~') {
            const pasteStart = i + 6
            const endMarker = '\x1b[201~'
            const endIdx = buf.indexOf(endMarker, pasteStart)
            if (endIdx !== -1) {
              const pastedText = buf.subarray(pasteStart, endIdx).toString('utf8')
              if (pastedText) {
                this.onEvent({ type: 'text', text: pastedText, raw: buf.subarray(pasteStart, endIdx) })
              }
              i = endIdx + endMarker.length
            } else {
              // Incomplete paste — emit what we have
              const pastedText = buf.subarray(pasteStart).toString('utf8')
              if (pastedText) {
                this.onEvent({ type: 'text', text: pastedText, raw: buf.subarray(pasteStart) })
              }
              i = buf.length
            }
            continue
          }

          const direct = buf[i + 2]
          const directMap: Record<number, string> = {
            0x41: 'up',
            0x42: 'down',
            0x43: 'right',
            0x44: 'left',
            0x5a: 'shift-tab',
          }

          if (directMap[direct]) {
            this.onEvent({ type: 'key', key: directMap[direct], raw: buf.subarray(i, i + 3) })
            i += 3
            continue
          }

          let j = i + 2
          while (j < buf.length && !isCsiFinal(buf[j])) {
            j += 1
          }

          if (j >= buf.length) {
            this.pendingEscape = buf.subarray(i)
            this.armEscapeTimer()
            return
          }

          const seq = buf.subarray(i, j + 1)
          const seqText = seq.toString('utf8')
          if (/^\x1b\[[0-9;]*A$/.test(seqText)) this.onEvent({ type: 'key', key: 'up', raw: seq })
          else if (/^\x1b\[[0-9;]*B$/.test(seqText)) this.onEvent({ type: 'key', key: 'down', raw: seq })
          else if (/^\x1b\[[0-9;]*C$/.test(seqText)) this.onEvent({ type: 'key', key: 'right', raw: seq })
          else if (/^\x1b\[[0-9;]*D$/.test(seqText)) this.onEvent({ type: 'key', key: 'left', raw: seq })
          else if (/^\x1b\[<\d+;\d+;\d+[mM]$/.test(seqText)) {
            const m = seqText.match(/^\x1b\[<(\d+);\d+;\d+([mM])$/)
            if (m) {
              const btn = parseInt(m[1], 10)
              const released = m[2] === 'm'
              if (!released && btn === 64) this.onEvent({ type: 'key', key: 'wheel-up', raw: seq })
              else if (!released && btn === 65) this.onEvent({ type: 'key', key: 'wheel-down', raw: seq })
            }
          }
          else if (/^\x1b\[[0-9;:]*u$/.test(seqText)) {
            // Kitty keyboard protocol / CSI u: \x1b[<codepoint>u or \x1b[<codepoint>;<modifiers>u
            // Ghostty and other modern terminals send keys in this format
            // Note: some implementations use : as separator within groups
            const params = seqText.slice(2, -1) // strip \x1b[ and u
            const codepoint = parseInt(params.split(/[;:]/)[0], 10)
            if (codepoint && !isNaN(codepoint)) {
              if (codepoint === 13) {
                // Check for shift modifier (modifier value 2 = 1+shift in kitty protocol)
                const modStr = params.split(/[;:]/)[1]
                const mod = modStr ? parseInt(modStr, 10) : 1
                const isShift = (mod & 2) !== 0
                this.onEvent({ type: 'key', key: isShift ? 'shift-enter' : 'enter', raw: seq })
              }
              else if (codepoint === 9) this.onEvent({ type: 'key', key: 'tab', raw: seq })
              else if (codepoint === 27) this.onEvent({ type: 'key', key: 'escape', raw: seq })
              else if (codepoint === 127) this.onEvent({ type: 'key', key: 'backspace', raw: seq })
              else if (codepoint >= 32) {
                this.onEvent({ type: 'text', text: String.fromCodePoint(codepoint), raw: seq })
              }
            }
          }
          else if (/^\x1b\[[0-9;]*~$/.test(seqText)) {
            // VT-style function keys: \x1b[3~ = Delete, \x1b[5~ = PgUp, etc.
            const num = parseInt(seqText.slice(2, -1).split(';')[0], 10)
            if (num === 3) this.onEvent({ type: 'key', key: 'backspace', raw: seq })
          }
          // Catch-all: any unrecognized CSI sequence — don't drop it silently.
          // In insert mode especially, try to extract useful text from it.
          else {
            // Try to decode as CSI u variant with different final byte
            const finalByte = seqText[seqText.length - 1]
            const params = seqText.slice(2, -1)
            const codepoint = parseInt(params.split(';')[0], 10)
            if (codepoint >= 32 && codepoint < 127 && !isNaN(codepoint)) {
              this.onEvent({ type: 'text', text: String.fromCodePoint(codepoint), raw: seq })
            }
          }

          i = j + 1
          continue
        }

        this.onEvent({ type: 'key', key: 'escape', raw: Buffer.from([0x1b]) })
        i += 1
        continue
      }

      if (isControlByte(byte)) {
        if (byte === 0x0d || byte === 0x0a) this.onEvent({ type: 'key', key: 'enter', raw: buf.subarray(i, i + 1) })
        else if (byte === 0x09) this.onEvent({ type: 'key', key: 'tab', raw: buf.subarray(i, i + 1) })
        else if (byte === 0x7f) this.onEvent({ type: 'key', key: 'backspace', raw: buf.subarray(i, i + 1) })
        else if (byte === 0x03) this.onEvent({ type: 'key', key: 'ctrl-c', raw: buf.subarray(i, i + 1) })
        else if (byte === 0x04) this.onEvent({ type: 'key', key: 'ctrl-d', raw: buf.subarray(i, i + 1) })
        else if (byte === 0x15) this.onEvent({ type: 'key', key: 'ctrl-u', raw: buf.subarray(i, i + 1) })
        i += 1
        continue
      }

      const start = i
      while (i < buf.length && buf[i] !== 0x1b && !isControlByte(buf[i])) {
        i += 1
      }

      const textBytes = buf.subarray(start, i)
      const text = this.decoder.write(textBytes)
      if (text) {
        this.onEvent({ type: 'text', text, raw: textBytes })
      }
    }
  }
}

function appendCommandText(bindings: InputBindings, text: string): void {
  const state = bindings.getState()
  const next = state.commandInput + text
  bindings.setCommand(next, next.length)
}

function backspaceCommand(bindings: InputBindings): void {
  const state = bindings.getState()
  if (!state.commandInput) return
  const next = state.commandInput.slice(0, -1)
  bindings.setCommand(next, next.length)
}

function tabCompleteCommand(bindings: InputBindings, reverse: boolean): void {
  const state = bindings.getState()

  if (state.completionItems.length > 1) {
    const len = state.completionItems.length
    const dir = reverse ? -1 : 1
    const next = (state.completionSelectedIndex + dir + len) % len
    bindings.setCompletionSelectedIndex(next)
    return
  }

  const items = getCompletionItems(
    state.commandInput,
    bindings.getAgentNames(),
    bindings.getCliAdapters(),
    bindings.getPresetNames(),
  )

  if (items.length === 1) {
    const next = applySingleCompletion(state.commandInput, items[0].value)
    completionRecency.set(items[0].value, Date.now())
    bindings.closeCompletionPopup()
    bindings.setCommand(next, next.length)
    return
  }

  if (items.length > 1) {
    const idx = reverse ? items.length - 1 : 0
    bindings.setCompletionPopup(items, idx)
  }
}

function executeKeybindAction(mode: ConfigurableMode, action: KeybindAction, bindings: InputBindings): void {
  const state = bindings.getState()
  const selected = state.selectedAgent

  // Opencode keeps its own in-app scroll viewport (separate from tmux scrollback).
  // In log-focus mode, route common scroll actions to opencode itself so j/k and
  // ctrl-u/ctrl-d move inside opencode's current view instead of only moving flt's
  // capture offset.
  if (mode === 'log-focus' && selected?.cli === 'opencode') {
    if (action === 'scrollDown') {
      bindings.sendInsertKey('C-M-e')
      return
    }
    if (action === 'scrollUp') {
      bindings.sendInsertKey('C-M-y')
      return
    }
    if (action === 'pageDown') {
      bindings.flushInsert()
      bindings.sendInsertKey('NPage')
      return
    }
    if (action === 'pageUp') {
      bindings.flushInsert()
      bindings.sendInsertKey('PPage')
      return
    }
  }

  if (action === 'selectNext') {
    if (mode === 'workflows') bindings.workflowsSelectNext()
    else bindings.selectNext()
  }
  else if (action === 'selectPrev') {
    if (mode === 'workflows') bindings.workflowsSelectPrev()
    else bindings.selectPrev()
  }
  else if (action === 'openCommand') bindings.openCommand('')
  else if (action === 'openSpawn') bindings.openSpawnModal()
  else if (action === 'openWorkflows') bindings.openWorkflowsModal()
  else if (action === 'killConfirm' && state.selectedAgent) bindings.setKillConfirm(state.selectedAgent.name)
  else if (action === 'openInbox') bindings.setMode('inbox')
  else if (action === 'reply') {
    if (mode === 'inbox') {
      bindings.inboxReply()
    } else if (state.selectedAgent) {
      bindings.openCommand(`send ${state.selectedAgent.name} `)
    }
  } else if (action === 'openShell') bindings.openShell()
  else if (action === 'quit') bindings.quit()
  else if (action === 'focusLog') bindings.setMode('log-focus')
  else if (action === 'toggleCollapse') bindings.toggleCollapse()
  else if (action === 'enterInsert' && state.selectedAgent) {
    bindings.jumpLogBottom()
    bindings.setMode('insert')
  } else if (action === 'scrollDown') bindings.scrollLogDown()
  else if (action === 'scrollUp') bindings.scrollLogUp()
  else if (action === 'jumpBottom') bindings.jumpLogBottom()
  else if (action === 'jumpTop') bindings.jumpLogTop()
  else if (action === 'search') bindings.setSearchQuery('')
  else if (action === 'back') {
    if (mode === 'workflows') {
      const workflows = state.workflowsModal
      if (workflows?.drilldown) bindings.closeWorkflowDrilldown()
      else bindings.closeWorkflowsModal()
    } else {
      bindings.setMode('normal')
    }
  }
  else if (action === 'pageDown') bindings.scrollLogPageDown()
  else if (action === 'pageUp') bindings.scrollLogPageUp()
  else if (action === 'msgDown') bindings.inboxMsgDown()
  else if (action === 'msgUp') bindings.inboxMsgUp()
  else if (action === 'delete') bindings.inboxDeleteCard()
  else if (action === 'clearAll') bindings.inboxClearAll()
  else if (action === 'execute') {
    if (mode === 'command' && state.completionItems.length > 0) {
      const item = state.completionItems[state.completionSelectedIndex]
      const next = applySingleCompletion(state.commandInput, item.value)
      completionRecency.set(item.value, Date.now())
      bindings.closeCompletionPopup()
      bindings.setCommand(next, next.length)
    } else {
      const command = state.commandInput
      bindings.setCommand('', 0)
      bindings.submitCommand(command)
    }
  } else if (action === 'complete') tabCompleteCommand(bindings, false)
  else if (action === 'completeReverse') tabCompleteCommand(bindings, true)
  else if (action === 'completionUp') {
    if (state.completionItems.length > 1) {
      const next = Math.max(0, state.completionSelectedIndex - 1)
      bindings.setCompletionSelectedIndex(next)
    }
  } else if (action === 'completionDown') {
    if (state.completionItems.length > 1) {
      const next = Math.min(state.completionItems.length - 1, state.completionSelectedIndex + 1)
      bindings.setCompletionSelectedIndex(next)
    }
  } else if (action === 'cancel') {
    if (mode === 'kill-confirm') {
      bindings.cancelKill()
    } else if (mode === 'command') {
      if (state.completionItems.length > 0) {
        bindings.closeCompletionPopup()
      } else {
        bindings.setCommand('', 0)
        bindings.setMode('normal')
      }
    } else {
      bindings.setMode('normal')
    }
  } else if (action === 'confirm') {
    if (mode === 'workflows') bindings.openWorkflowDrilldown()
    else bindings.confirmKill()
  } else if (action === 'workflowsAll') bindings.setWorkflowFilter('all')
  else if (action === 'workflowsRunning') bindings.setWorkflowFilter('running')
  else if (action === 'workflowsCompleted') bindings.setWorkflowFilter('completed')
  else if (action === 'workflowsFailed') bindings.setWorkflowFilter('failed')
  else if (action === 'backspace') backspaceCommand(bindings)
}

function handleModalKey(event: Extract<ParsedInputEvent, { type: 'key' }>, bindings: InputBindings): void {
  const state = bindings.getState()
  const modal = state.modal
  if (!modal) return

  if (event.key === 'escape') {
    bindings.cancelModal()
    return
  }
  if (event.key === 'enter') {
    bindings.submitModal()
    return
  }

  // List mode (kill/presets)
  if (modal.listItems.length > 0 && modal.fields.length === 0) {
    if (event.key === 'up') { bindings.modalSelectUp(); return }
    if (event.key === 'down') { bindings.modalSelectDown(); return }
    if (modal.type === 'presets' && event.key === 'a') {
      bindings.cancelModal()
      bindings.openCommand('presets add ')
      return
    }
    if (modal.type === 'presets' && event.key === 'd') {
      bindings.submitModal()
      return
    }
    return
  }

  // Form mode (spawn)
  if (event.key === 'tab') { bindings.modalNextField(); return }
  if (event.key === 'shift-tab') { bindings.modalPrevField(); return }
  if (event.key === 'up') {
    const field = modal.fields[modal.activeField]
    if (field?.options?.length) { bindings.modalSelectUp(); return }
    bindings.modalPrevField(); return
  }
  if (event.key === 'down') {
    const field = modal.fields[modal.activeField]
    if (field?.options?.length) { bindings.modalSelectDown(); return }
    bindings.modalNextField(); return
  }
  if (event.key === 'backspace') {
    const field = modal.fields[modal.activeField]
    if (field && field.cursor > 0) {
      const before = field.value.slice(0, field.cursor - 1)
      const after = field.value.slice(field.cursor)
      const next = before + after
      bindings.setModalField(modal.activeField, next, field.cursor - 1)
    }
    return
  }
  if (event.key === 'ctrl-u') {
    const field = modal.fields[modal.activeField]
    if (field) {
      const after = field.value.slice(field.cursor)
      bindings.setModalField(modal.activeField, after, 0)
    }
    return
  }
}

function handleModalText(event: Extract<ParsedInputEvent, { type: 'text' }>, bindings: InputBindings): void {
  const modal = bindings.getState().modal
  if (!modal) return

  // List-mode hotkeys that arrive as plain text events.
  if (modal.listItems.length > 0 && modal.fields.length === 0) {
    const ch = event.text.trim().toLowerCase()
    if (modal.type === 'presets' && ch === 'a') {
      bindings.cancelModal()
      bindings.openCommand('presets add ')
      return
    }
    if (modal.type === 'presets' && ch === 'd') {
      const selected = modal.listItems[modal.selectedIndex]
      if (selected) {
        bindings.cancelModal()
        bindings.openCommand(`presets remove ${selected.label}`)
      }
      return
    }
    return
  }

  if (modal.fields.length === 0) return

  const field = modal.fields[modal.activeField]
  if (!field) return

  const before = field.value.slice(0, field.cursor)
  const after = field.value.slice(field.cursor)
  const next = before + event.text + after
  bindings.setModalField(modal.activeField, next, field.cursor + event.text.length)
}

function handleConfigurableKey(mode: ConfigurableMode, key: string, bindings: InputBindings): void {
  const action = getKeybindAction(mode, key)
  if (!action) return
  executeKeybindAction(mode, action, bindings)
}

function handleNormalChar(char: string, bindings: InputBindings): void {
  handleConfigurableKey('normal', char, bindings)
}

function handleLogFocusChar(char: string, bindings: InputBindings): void {
  handleConfigurableKey('log-focus', char, bindings)
}

function handleInboxChar(char: string, bindings: InputBindings): void {
  handleConfigurableKey('inbox', char, bindings)
}

function handlePresetsChar(char: string, bindings: InputBindings): void {
  handleConfigurableKey('presets', char, bindings)
}

function handleWorkflowsChar(char: string, bindings: InputBindings): void {
  handleConfigurableKey('workflows', char, bindings)
}

function handleSpecialKey(event: Extract<ParsedInputEvent, { type: 'key' }>, bindings: InputBindings): void {
  const state = bindings.getState()

  if (state.mode === 'insert') {
    if (event.key === 'escape') {
      bindings.flushInsert()
      const prev = state.previousMode
      bindings.setMode(prev === 'normal' || prev === 'log-focus' ? prev : 'normal')
    } else if (event.key === 'enter') {
      bindings.flushInsert()
      bindings.sendInsertKey('Enter')
    } else if (event.key === 'backspace') {
      bindings.flushInsert()
      bindings.sendInsertKey('BSpace')
    } else if (event.key === 'tab') {
      bindings.flushInsert()
      bindings.sendInsertKey('Tab')
    } else if (event.key === 'up') {
      bindings.sendInsertKey('Up')
    } else if (event.key === 'down') {
      bindings.sendInsertKey('Down')
    } else if (event.key === 'left') {
      bindings.sendInsertKey('Left')
    } else if (event.key === 'right') {
      bindings.sendInsertKey('Right')
    } else if (event.key === 'alt-backspace') {
      bindings.flushInsert()
      bindings.sendInsertKey('M-BSpace')
    } else if (event.key === 'alt-d') {
      bindings.flushInsert()
      bindings.sendInsertKey('M-d')
    } else if (event.key === 'ctrl-u') {
      bindings.flushInsert()
      bindings.sendInsertKey('C-u')
    } else if (event.key === 'ctrl-d') {
      bindings.flushInsert()
      bindings.sendInsertKey('C-d')
    } else if (event.key === 'ctrl-c') {
      // Send Escape to agent (interrupt generation) instead of SIGINT (kills process)
      bindings.flushInsert()
      bindings.sendInsertKey('Escape')
    }
    return
  }

  if (state.mode === 'shell') {
    if (event.key === 'escape') {
      bindings.flushShell()
      bindings.closeShell()
    } else if (event.key === 'enter') {
      bindings.flushShell()
      bindings.sendShellKey('Enter')
    } else if (event.key === 'backspace') {
      bindings.flushShell()
      bindings.sendShellKey('BSpace')
    } else if (event.key === 'tab') {
      bindings.flushShell()
      bindings.sendShellKey('Tab')
    } else if (event.key === 'up') {
      bindings.sendShellKey('Up')
    } else if (event.key === 'down') {
      bindings.sendShellKey('Down')
    } else if (event.key === 'left') {
      bindings.sendShellKey('Left')
    } else if (event.key === 'right') {
      bindings.sendShellKey('Right')
    } else if (event.key === 'alt-backspace') {
      bindings.flushShell()
      bindings.sendShellKey('M-BSpace')
    } else if (event.key === 'alt-d') {
      bindings.flushShell()
      bindings.sendShellKey('M-d')
    } else if (event.key === 'ctrl-u') {
      bindings.flushShell()
      bindings.sendShellKey('C-u')
    } else if (event.key === 'ctrl-c') {
      bindings.flushShell()
      bindings.sendShellKey('C-c')
    }
    return
  }

  if (state.mode === 'command') {
    handleConfigurableKey('command', event.key, bindings)
    return
  }

  if (state.mode === 'kill-confirm') {
    handleConfigurableKey('kill-confirm', event.key, bindings)
    return
  }

  if (state.mode === 'normal') {
    handleConfigurableKey('normal', event.key, bindings)
    return
  }

  if (state.mode === 'log-focus') {
    const selected = state.selectedAgent
    if (selected?.cli === 'opencode') {
      if (event.key === 'wheel-up') {
        bindings.sendInsertKey('C-M-y')
        return
      }
      if (event.key === 'wheel-down') {
        bindings.sendInsertKey('C-M-e')
        return
      }
    }
    handleConfigurableKey('log-focus', event.key, bindings)
    return
  }

  if (state.mode === 'inbox') {
    handleConfigurableKey('inbox', event.key, bindings)
    return
  }

  if (state.mode === 'presets') {
    handleConfigurableKey('presets', event.key, bindings)
    return
  }

  if (state.mode === 'workflows') {
    handleConfigurableKey('workflows', event.key, bindings)
  }
}

function handleText(event: Extract<ParsedInputEvent, { type: 'text' }>, bindings: InputBindings): void {
  const state = bindings.getState()

  if (state.mode === 'insert') {
    bindings.sendInsertText(event.text)
    return
  }

  if (state.mode === 'shell') {
    bindings.sendShellText(event.text)
    return
  }

  if (state.mode === 'kill-confirm') {
    for (const key of event.text) {
      const action = getKeybindAction('kill-confirm', key) ?? getKeybindAction('kill-confirm', key.toLowerCase())
      if (!action) continue
      executeKeybindAction('kill-confirm', action, bindings)
    }
    return
  }

  if (state.mode === 'command') {
    appendCommandText(bindings, event.text)
    return
  }

  // File path pasted in normal/log-focus → open :send <agent> <path>
  if ((state.mode === 'normal' || state.mode === 'log-focus') && event.text.length > 3) {
    const trimmed = event.text.trim()
    if (trimmed.startsWith('/') || trimmed.startsWith('~')) {
      const agent = state.selectedAgent?.name ?? ''
      bindings.openCommand(`send ${agent} ${trimmed}`)
      return
    }
  }

  for (const char of event.text) {
    if (state.mode === 'normal') {
      handleNormalChar(char, bindings)
    } else if (state.mode === 'log-focus') {
      handleLogFocusChar(char, bindings)
    } else if (state.mode === 'inbox') {
      handleInboxChar(char, bindings)
    } else if (state.mode === 'presets') {
      handlePresetsChar(char, bindings)
    } else if (state.mode === 'workflows') {
      handleWorkflowsChar(char, bindings)
    }
  }
}

export function handleInputEvent(event: ParsedInputEvent, bindings: InputBindings): void {
  const state = bindings.getState()
  if (state.modal) {
    if (event.type === 'key') handleModalKey(event, bindings)
    else handleModalText(event, bindings)
    return
  }
  if (event.type === 'key') handleSpecialKey(event, bindings)
  else handleText(event, bindings)
}

export function setupInput(bindings: InputBindings): () => void {
  const parser = new RawKeyParser((event) => {
    handleInputEvent(event, bindings)
  })

  const onData = (buf: Buffer): void => {
    parser.feed(buf)
  }

  const onResize = (): void => {
    bindings.onResize?.()
  }

  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(true)
  }

  process.stdin.resume()
  process.stdin.on('data', onData)
  process.stdout.on('resize', onResize)

  return () => {
    parser.dispose()
    process.stdin.off('data', onData)
    process.stdout.off('resize', onResize)

    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(false)
    }
  }
}
