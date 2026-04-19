import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface FleetEvent {
  type: 'spawn' | 'kill' | 'status' | 'workflow' | 'message' | 'error'
  agent?: string
  detail: string
  at: string
  // Optional cost/token telemetry attached to `kill` events via harness extract.
  // Other event types leave these undefined; consumers must not assume presence.
  cost_usd?: number | null
  tokens_in?: number | null
  tokens_out?: number | null
}

function getLogPath(): string {
  const home = process.env.HOME ?? homedir()
  const dir = join(home, '.flt')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'activity.log')
}

export function appendEvent(event: FleetEvent): void {
  try {
    appendFileSync(getLogPath(), JSON.stringify(event) + '\n', 'utf-8')
  } catch {
    // Best-effort — never throw from activity logging
  }
}

export function listEvents(opts?: { limit?: number; since?: string; type?: string }): FleetEvent[] {
  const path = getLogPath()
  if (!existsSync(path)) return []

  let lines: string[]
  try {
    lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean)
  } catch {
    return []
  }

  let events: FleetEvent[] = []
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as FleetEvent)
    } catch {
      // Skip malformed lines
    }
  }

  if (opts?.type) {
    events = events.filter(e => e.type === opts.type)
  }

  if (opts?.since) {
    const since = new Date(opts.since).getTime()
    events = events.filter(e => new Date(e.at).getTime() >= since)
  }

  const limit = opts?.limit ?? 20
  return events.slice(-limit)
}
