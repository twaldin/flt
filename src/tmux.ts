import { execFileSync } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

function tmux(...args: string[]): string {
  return execFileSync('tmux', args, {
    encoding: 'utf-8',
    timeout: 10_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}

function tmuxNoThrow(...args: string[]): string | null {
  try {
    return tmux(...args)
  } catch {
    return null
  }
}

export function createSession(
  name: string,
  cwd: string,
  command: string,
  env: Record<string, string> = {},
): void {
  const envArgs: string[] = []
  for (const [k, v] of Object.entries(env)) {
    envArgs.push('-e', `${k}=${v}`)
  }
  tmux('new-session', '-d', '-s', name, '-c', cwd, ...envArgs, command)
}

export function killSession(name: string): void {
  tmuxNoThrow('kill-session', '-t', name)
}

export function hasSession(name: string): boolean {
  return tmuxNoThrow('has-session', '-t', name) !== null
}

export function listSessions(): string[] {
  const out = tmuxNoThrow('list-sessions', '-F', '#{session_name}')
  if (!out) return []
  return out.split('\n').filter(Boolean)
}

export function sendKeys(session: string, keys: string[]): void {
  for (const key of keys) {
    tmux('send-keys', '-t', session, key)
  }
}

export function sendLiteral(session: string, text: string): void {
  tmux('send-keys', '-t', session, '-l', text)
}

export function pasteBuffer(session: string, text: string): void {
  const bufName = randomUUID().slice(0, 8)
  const tmpFile = join(tmpdir(), `flt-paste-${bufName}`)
  writeFileSync(tmpFile, text)
  try {
    tmux('load-buffer', '-b', bufName, tmpFile)
    tmux('paste-buffer', '-b', bufName, '-t', session, '-d')
  } finally {
    try { unlinkSync(tmpFile) } catch {}
  }
}

export function capturePane(session: string, lines = 100): string {
  // -e preserves ANSI escape sequences (colors) in the output
  const result = tmuxNoThrow('capture-pane', '-t', session, '-p', '-e', '-S', `-${lines}`)
  return result ?? ''
}

export function getPanePid(session: string): number | null {
  const out = tmuxNoThrow('list-panes', '-t', session, '-F', '#{pane_pid}')
  if (!out) return null
  const pid = parseInt(out.split('\n')[0], 10)
  return isNaN(pid) ? null : pid
}

export function setEnv(session: string, key: string, value: string): void {
  tmux('set-environment', '-t', session, key, value)
}

export function displayMessage(session: string, message: string): void {
  tmux('display-message', '-t', session, '-d', '0', message)
}

export function resizeWindow(session: string, width: number, height: number): void {
  tmuxNoThrow('resize-window', '-t', session, '-x', String(width), '-y', String(height))
}

/** Non-blocking paste via tmux buffer — handles semicolons and special chars */
function sendViaPasteBuffer(session: string, text: string): void {
  const tmpFile = join(tmpdir(), `flt-paste-${randomUUID().slice(0, 8)}`)
  writeFileSync(tmpFile, text)
  const bufName = `flt-${randomUUID().slice(0, 6)}`
  try {
    tmux('load-buffer', '-b', bufName, tmpFile)
    tmux('paste-buffer', '-b', bufName, '-t', session, '-d')
  } catch {}
  try { unlinkSync(tmpFile) } catch {}
}

/** Non-blocking keystroke forwarding — fire and forget */
export function sendKeysAsync(session: string, keys: string[]): void {
  for (const key of keys) {
    Bun.spawn(['tmux', 'send-keys', '-t', session, key], { stdout: 'ignore', stderr: 'ignore' })
  }
}

/** Non-blocking literal text send — fire and forget */
export function sendLiteralAsync(session: string, text: string): void {
  if (text.includes(';')) {
    sendViaPasteBuffer(session, text)
  } else {
    Bun.spawn(['tmux', 'send-keys', '-t', session, '-l', text], { stdout: 'ignore', stderr: 'ignore' })
  }
}

/**
 * Batched keystroke sender — collects literal chars for 16ms
 * then sends them as a single tmux call. Reduces process spawns
 * from N-per-keystroke to ~1 per 16ms frame.
 */
const keyBuffers = new Map<string, { text: string; timer: ReturnType<typeof setTimeout> | null }>()

export function sendLiteralBatched(session: string, char: string): void {
  let buf = keyBuffers.get(session)
  if (!buf) {
    buf = { text: '', timer: null }
    keyBuffers.set(session, buf)
  }
  buf.text += char
  if (buf.timer) clearTimeout(buf.timer)
  buf.timer = setTimeout(() => {
    const text = buf!.text
    buf!.text = ''
    buf!.timer = null
    if (!text) return
    // tmux treats bare ';' as a command separator even in argv mode.
    // Use paste-buffer for text containing semicolons.
    if (text.includes(';')) {
      sendViaPasteBuffer(session, text)
    } else {
      Bun.spawn(['tmux', 'send-keys', '-t', session, '-l', text], { stdout: 'ignore', stderr: 'ignore' })
    }
  }, 16)
}

/** Flush any pending batched keystrokes immediately */
export function flushBatchedKeys(session: string): void {
  const buf = keyBuffers.get(session)
  if (buf && buf.text) {
    if (buf.timer) clearTimeout(buf.timer)
    const text = buf.text
    buf.text = ''
    buf.timer = null
    Bun.spawn(['tmux', 'send-keys', '-t', session, '-l', text], { stdout: 'ignore', stderr: 'ignore' })
  }
}
