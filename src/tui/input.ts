import { StringDecoder } from 'string_decoder'
import type { AgentView, AppState, InboxMessage, Mode } from './types'

export type TmuxInsertKey = 'Enter' | 'BSpace' | 'Tab' | 'Up' | 'Down' | 'Left' | 'Right' | 'C-c' | 'M-BSpace' | 'C-u' | 'M-d'

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
  inboxCardDown: () => void
  inboxCardUp: () => void
  inboxFocusCard: () => void
  inboxUnfocusCard: () => void
  inboxMsgScrollDown: () => void
  inboxMsgScrollUp: () => void
  inboxReply: () => void
  setSearchQuery: (query: string) => void
  submitCommand: (input: string) => void
  setKillConfirm: (agentName: string) => void
  confirmKill: () => void
  cancelKill: () => void
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
}

const COMMANDS = ['send', 'logs', 'spawn', 'presets', 'kill', 'theme', 'help']
const SPAWN_FLAGS = ['--cli', '--model', '--dir', '--preset']
const PRESETS_ACTIONS = ['list', 'add', 'remove']
const PRESETS_ADD_FLAGS = ['--cli', '--model', '--description']

// Load model suggestions from ~/.flt/models.json (user-configurable)
function loadModelSuggestions(): Record<string, string[]> {
  const defaults: Record<string, string[]> = {
    'claude-code': ['haiku', 'sonnet', 'opus', 'opus[1m]', 'sonnet[1m]'],
    codex: ['gpt-5.3-codex', 'gpt-5.4-mini', 'gpt-5.4', 'o3', 'gpt-4.1'],
    gemini: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    aider: ['sonnet', 'opus', 'gpt-4.1', 'o3'],
    opencode: ['gpt-5.3', 'gpt-5.4-mini', 'o3'],
    'swe-agent': ['sonnet', 'gpt-4.1'],
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

interface CompletionResult {
  completions: string[]
  currentToken: string
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
  const empty: CompletionResult = { completions: [], currentToken: '' }

  if (parts.length <= 1) {
    const prefix = parts[0] || ''
    return {
      completions: COMMANDS.filter((c) => c.startsWith(prefix) && c !== prefix),
      currentToken: prefix,
    }
  }

  const cmd = parts[0]

  if (['send', 'logs', 'kill'].includes(cmd) && parts.length === 2) {
    const prefix = parts[1] || ''
    return {
      completions: agentNames.filter((n) => n.startsWith(prefix) && n !== prefix),
      currentToken: prefix,
    }
  }

  if (cmd === 'theme' && parts.length === 2) {
    const { getThemeNames } = require('./theme')
    const names: string[] = getThemeNames()
    const prefix = parts[1] || ''
    return {
      completions: names.filter((n: string) => n.startsWith(prefix) && n !== prefix),
      currentToken: prefix,
    }
  }

  if (cmd === 'spawn') {
    const lastPart = parts[parts.length - 1] || ''
    const prevPart = parts.length >= 2 ? parts[parts.length - 2] : ''

    if (parts.length === 2) return empty

    if (prevPart === '--cli') {
      return {
        completions: cliAdapters.filter((a) => a.startsWith(lastPart) && a !== lastPart),
        currentToken: lastPart,
      }
    }

    if (prevPart === '--model') {
      const cliIdx = parts.indexOf('--cli')
      const selectedCli = cliIdx !== -1 && cliIdx + 1 < parts.length ? parts[cliIdx + 1] : ''
      const models = MODEL_SUGGESTIONS[selectedCli]
        ?? Array.from(new Set(Object.values(MODEL_SUGGESTIONS).flat()))

      return {
        completions: models.filter((m) => m.startsWith(lastPart) && m !== lastPart),
        currentToken: lastPart,
      }
    }

    if (prevPart === '--preset') {
      return {
        completions: presetNames.filter((name) => name.startsWith(lastPart) && name !== lastPart),
        currentToken: lastPart,
      }
    }

    if (lastPart.startsWith('-')) {
      const usedFlags = parts.filter((p) => p.startsWith('--'))
      const available = SPAWN_FLAGS.filter((f) => !usedFlags.includes(f) && f.startsWith(lastPart) && f !== lastPart)
      return { completions: available, currentToken: lastPart }
    }

    if (prevPart !== '--dir') {
      const usedFlags = parts.filter((p) => p.startsWith('--'))
      const available = SPAWN_FLAGS.filter((f) => !usedFlags.includes(f))
      if (available.length > 0 && lastPart === '') {
        return { completions: available, currentToken: '' }
      }
    }
  }

  if (cmd === 'presets') {
    const lastPart = parts[parts.length - 1] || ''
    const prevPart = parts.length >= 2 ? parts[parts.length - 2] : ''

    if (parts.length === 2) {
      const prefix = parts[1] || ''
      return {
        completions: PRESETS_ACTIONS.filter((action) => action.startsWith(prefix) && action !== prefix),
        currentToken: prefix,
      }
    }

    const action = parts[1]
    if (action === 'remove' && parts.length === 3) {
      return {
        completions: presetNames.filter((name) => name.startsWith(lastPart) && name !== lastPart),
        currentToken: lastPart,
      }
    }

    if (action === 'add') {
      if (prevPart === '--cli') {
        return {
          completions: cliAdapters.filter((adapter) => adapter.startsWith(lastPart) && adapter !== lastPart),
          currentToken: lastPart,
        }
      }

      if (prevPart === '--model') {
        const cliIdx = parts.indexOf('--cli')
        const selectedCli = cliIdx !== -1 && cliIdx + 1 < parts.length ? parts[cliIdx + 1] : ''
        const models = MODEL_SUGGESTIONS[selectedCli]
          ?? Array.from(new Set(Object.values(MODEL_SUGGESTIONS).flat()))

        return {
          completions: models.filter((m) => m.startsWith(lastPart) && m !== lastPart),
          currentToken: lastPart,
        }
      }

      if (lastPart.startsWith('-')) {
        const usedFlags = parts.filter((p) => p.startsWith('--'))
        const available = PRESETS_ADD_FLAGS.filter((f) => !usedFlags.includes(f) && f.startsWith(lastPart) && f !== lastPart)
        return { completions: available, currentToken: lastPart }
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
  const { completions, currentToken } = getCompletions(input, agentNames, cliAdapters, presetNames)
  if (completions.length === 1) {
    return { hint: completions[0].slice(currentToken.length), multiHint: '' }
  }
  if (completions.length > 1 && completions.length <= 6) {
    return { hint: '', multiHint: completions.join(' | ') }
  }
  return { hint: '', multiHint: '' }
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
          else if (/^\x1b\[[0-9;:]*u$/.test(seqText)) {
            // Kitty keyboard protocol / CSI u: \x1b[<codepoint>u or \x1b[<codepoint>;<modifiers>u
            // Ghostty and other modern terminals send keys in this format
            // Note: some implementations use : as separator within groups
            const params = seqText.slice(2, -1) // strip \x1b[ and u
            const codepoint = parseInt(params.split(/[;:]/)[0], 10)
            if (codepoint && !isNaN(codepoint)) {
              if (codepoint === 13) this.onEvent({ type: 'key', key: 'enter', raw: seq })
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

function tabCompleteCommand(bindings: InputBindings): void {
  const state = bindings.getState()
  const { completions, currentToken } = getCompletions(
    state.commandInput,
    bindings.getAgentNames(),
    bindings.getCliAdapters(),
    bindings.getPresetNames(),
  )

  if (completions.length === 1) {
    const next = applySingleCompletion(state.commandInput, completions[0])
    bindings.setCommand(next, next.length)
    return
  }

  if (completions.length > 1) {
    const prefix = commonPrefix(completions)
    if (prefix.length > currentToken.length) {
      const parts = state.commandInput.split(/\s+/)
      parts[parts.length - 1] = prefix
      const next = parts.join(' ')
      bindings.setCommand(next, next.length)
    }
  }
}

function handleNormalChar(char: string, bindings: InputBindings): void {
  const state = bindings.getState()

  if (char === 'j') bindings.selectNext()
  else if (char === 'k') bindings.selectPrev()
  else if (char === ':') bindings.openCommand('')
  else if (char === 's') bindings.openCommand('spawn ')
  else if (char === 'K' && state.selectedAgent) bindings.setKillConfirm(state.selectedAgent.name)
  else if (char === 'm') bindings.setMode('inbox')
  else if (char === 'r' && state.selectedAgent) bindings.openCommand(`send ${state.selectedAgent.name} `)
  else if (char === 't') bindings.openShell()
  else if (char === 'q') bindings.quit()
}

function handleLogFocusChar(char: string, bindings: InputBindings): void {
  const state = bindings.getState()

  if (char === 'i' && state.selectedAgent) {
    bindings.jumpLogBottom()
    bindings.setMode('insert')
  } else if (char === 'j') {
    bindings.scrollLogDown()
  } else if (char === 'k') {
    bindings.scrollLogUp()
  } else if (char === 'G') {
    bindings.jumpLogBottom()
  } else if (char === 'g') {
    bindings.jumpLogTop()
  } else if (char === '/') {
    bindings.setSearchQuery('')
  } else if (char === 'r' && state.selectedAgent) {
    bindings.openCommand(`send ${state.selectedAgent.name} `)
  }
}

function handleInboxChar(char: string, bindings: InputBindings): void {
  const state = bindings.getState()
  if (state.inboxFocusedCard) {
    if (char === 'j') bindings.inboxMsgScrollDown()
    else if (char === 'k') bindings.inboxMsgScrollUp()
    return
  }
  if (char === 'j') bindings.inboxCardDown()
  else if (char === 'k') bindings.inboxCardUp()
  else if (char === 'r') bindings.inboxReply()
}

function handlePresetsChar(char: string, bindings: InputBindings): void {
  if (char === ':') {
    bindings.openCommand('')
  }
}

function handleSpecialKey(event: Extract<ParsedInputEvent, { type: 'key' }>, bindings: InputBindings): void {
  const state = bindings.getState()

  if (state.mode === 'insert') {
    if (event.key === 'escape') {
      bindings.flushInsert()
      bindings.setMode('log-focus')
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
    } else if (event.key === 'ctrl-c') {
      bindings.flushInsert()
      bindings.sendInsertKey('C-c')
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
    if (event.key === 'escape') {
      bindings.setCommand('', 0)
      bindings.setMode('normal')
    } else if (event.key === 'enter') {
      const command = state.commandInput
      bindings.setCommand('', 0)
      bindings.submitCommand(command)
    } else if (event.key === 'tab' || event.key === 'shift-tab') {
      tabCompleteCommand(bindings)
    } else if (event.key === 'backspace') {
      backspaceCommand(bindings)
    }
    return
  }

  if (state.mode === 'kill-confirm') {
    if (event.key === 'escape') {
      bindings.cancelKill()
    }
    return
  }

  if (state.mode === 'normal') {
    if (event.key === 'enter' || event.key === 'tab') {
      bindings.setMode('log-focus')
    }
    return
  }

  if (state.mode === 'log-focus') {
    if (event.key === 'escape') bindings.setMode('normal')
    else if (event.key === 'ctrl-d') bindings.scrollLogPageDown()
    else if (event.key === 'ctrl-u') bindings.scrollLogPageUp()
    return
  }

  if (state.mode === 'inbox') {
    if (event.key === 'escape') {
      if (state.inboxFocusedCard) {
        bindings.inboxUnfocusCard()
      } else {
        bindings.setMode('normal')
      }
    } else if (event.key === 'enter' && !state.inboxFocusedCard) {
      bindings.inboxFocusCard()
    }
    return
  }

  if (state.mode === 'presets') {
    if (event.key === 'escape') {
      bindings.setMode('normal')
    }
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
    const char = event.text.toLowerCase()
    if (char === 'y') bindings.confirmKill()
    else if (char === 'n') bindings.cancelKill()
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
    }
  }
}

export function handleInputEvent(event: ParsedInputEvent, bindings: InputBindings): void {
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
