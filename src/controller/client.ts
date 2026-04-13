import { existsSync } from 'fs'
import { join } from 'path'
import { getStateDir } from '../state'

export interface ControllerRequest {
  action: 'spawn' | 'kill' | 'send' | 'list' | 'status' | 'ping'
  args: Record<string, unknown>
}

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
  const res = await fetch('http://localhost/rpc', {
    unix: sock,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  } as RequestInit)
  return res.json() as Promise<ControllerResponse>
}
