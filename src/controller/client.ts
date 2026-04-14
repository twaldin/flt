import { existsSync } from 'fs'
import { join } from 'path'
import { getStateDir } from '../state'

export type SpawnRequestArgs = {
  name: string; cli?: string; model?: string; preset?: string; dir?: string
  worktree?: boolean; bootstrap?: string; _callerName?: string; _callerDepth?: number
}
export type KillRequestArgs = { name: string }
export type SendRequestArgs = { target: string; message: string; _caller?: unknown }

export type ControllerRequest =
  | { action: 'spawn'; args: SpawnRequestArgs }
  | { action: 'kill'; args: KillRequestArgs }
  | { action: 'send'; args: SendRequestArgs }
  | { action: 'list' | 'status' | 'ping'; args?: Record<string, never> }

export interface ControllerResponse {
  ok: boolean
  data?: unknown
  error?: string
}

export function getSocketPath(): string {
  return join(getStateDir(), 'controller.sock')
}

export function getPidPath(): string {
  return join(getStateDir(), 'controller.pid')
}

export function isControllerRunning(): boolean {
  const sock = getSocketPath()
  if (!existsSync(sock)) return false
  try {
    // Synchronous check — try to connect
    const res = Bun.spawnSync(['curl', '-s', '--unix-socket', sock, 'http://localhost/ping'], {
      timeout: 2000,
    })
    return res.exitCode === 0
  } catch {
    return false
  }
}

export async function sendToController(req: ControllerRequest): Promise<ControllerResponse> {
  const sock = getSocketPath()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120_000)
  try {
    const res = await fetch('http://localhost/rpc', {
      unix: sock,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
    } as RequestInit)
    return res.json() as Promise<ControllerResponse>
  } finally {
    clearTimeout(timer)
  }
}
