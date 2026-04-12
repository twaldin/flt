import { execSync, execFileSync } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const SOCKET = 'flt'

function tmux(...args: string[]): string {
  return execFileSync('tmux', ['-L', SOCKET, ...args], {
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

// Run a tmux command on the default (system) socket instead of the flt socket
function tmuxDefault(...args: string[]): string {
  return execFileSync('tmux', args, {
    encoding: 'utf-8',
    timeout: 10_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}

function tmuxDefaultNoThrow(...args: string[]): string | null {
  try {
    return tmuxDefault(...args)
  } catch {
    return null
  }
}

export function hasSessionOnDefaultSocket(name: string): boolean {
  return tmuxDefaultNoThrow('has-session', '-t', name) !== null
}

export function displayMessageOnDefaultSocket(session: string, message: string): void {
  tmuxDefault('display-message', '-t', session, '-d', '0', message)
}

export function displayMessage(session: string, message: string): void {
  tmux('display-message', '-t', session, '-d', '0', message)
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
  const result = tmuxNoThrow('capture-pane', '-t', session, '-p', '-S', `-${lines}`)
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

export { SOCKET }
