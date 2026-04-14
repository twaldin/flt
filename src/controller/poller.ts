import { resolveAdapter, getAdapter } from '../adapters/registry'
import type { AgentStatus } from '../adapters/types'
import { allAgents, setAgent, type AgentState } from '../state'
import { capturePane, hasSession } from '../tmux'

const CONTENT_STABLE_TIMEOUT_MS = 60_000

// Per-agent tracking state
const lastIcons: Record<string, string> = {}
const lastHashes: Record<string, string> = {}
const stableTracker: Record<string, { hash: string; since: number }> = {}

function extractSpinnerIcon(pane: string): string | null {
  const match = pane.match(/^[\u00B7\u2722\u2733\u2217\u273B\u273D]/m)
  return match ? match[0] : null
}

function simpleHash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return String(h)
}

function detectAgentStatusFromPane(agent: AgentState, pane: string): AgentStatus {
  try {
    const adapter = getAdapter(agent.cli)
    if (!adapter) return 'unknown'

    const stripped = pane.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')

    // Claude-code: pure spinner icon delta detection
    // The spinner cycles through · ✢ ✳ ∗ ✻ ✽ when active (~1s per icon).
    // When done, it freezes on ✻. Compare between polls:
    //   icon changed → running
    //   icon same    → idle
    //   no icon      → idle
    if (adapter.name === 'claude-code') {
      const last2 = stripped.split('\n').slice(-2).join('\n')
      if (/rate.?limit|hit your limit/i.test(last2)) return 'rate-limited'

      const icon = extractSpinnerIcon(stripped)
      const key = agent.tmuxSession

      if (icon) {
        const prev = lastIcons[key]
        lastIcons[key] = icon
        if (prev && prev !== icon) return 'running'
        if (prev) return 'idle'
        return 'running' // first time seeing icon — assume running, next poll confirms
      }

      delete lastIcons[key]
      return 'idle'
    }

    // Other CLIs: adapter detection first
    const adapterResult = adapter.detectStatus(pane)
    if (adapterResult !== 'unknown') return adapterResult

    // Fallback: content-delta — one-way filter
    // Content changing can KEEP running, content stable can MOVE to idle
    // But content changing alone cannot move idle → running
    // Only adapter-specific signals (above) can transition to running
    const key = agent.tmuxSession
    const hash = simpleHash(pane)
    const prevHash = lastHashes[key]
    lastHashes[key] = hash
    const contentChanged = prevHash && prevHash !== hash
    const prevStatus = agent.status ?? 'idle'

    if (prevStatus === 'running' && contentChanged) return 'running'
    if (prevStatus === 'running' && !contentChanged) return 'idle'
    // If was idle/unknown, stay idle — only adapter can flip to running
    return prevStatus === 'rate-limited' ? prevStatus : 'idle'
  } catch {
    return 'unknown'
  }
}

function applyContentStableTimeout(name: string, pane: string, adapterStatus: AgentStatus): AgentStatus {
  const hash = simpleHash(pane)
  const prev = stableTracker[name]

  if (!prev || prev.hash !== hash) {
    stableTracker[name] = { hash, since: Date.now() }
    return adapterStatus
  }

  // Content unchanged — check timeout
  if (Date.now() - prev.since >= CONTENT_STABLE_TIMEOUT_MS) {
    if (adapterStatus === 'running' || adapterStatus === 'unknown') {
      return 'idle'
    }
  }

  return adapterStatus
}

export type StatusChangeCallback = (name: string, prev: AgentStatus | undefined, next: AgentStatus) => void

let onStatusChange: StatusChangeCallback | null = null
let pollInterval: ReturnType<typeof setInterval> | null = null

export function setStatusChangeCallback(cb: StatusChangeCallback): void {
  onStatusChange = cb
}

export function pollOnce(): void {
  const agents = allAgents()
  const now = new Date().toISOString()

  for (const [name, agent] of Object.entries(agents)) {
    if (!hasSession(agent.tmuxSession)) continue

    const prevStatus = agent.status
    const pane = capturePane(agent.tmuxSession, 20)
    let status = detectAgentStatusFromPane(agent, pane)
    status = applyContentStableTimeout(name, pane, status)

    if (status !== prevStatus) {
      setAgent(name, { ...agent, status, statusAt: now })
      if (onStatusChange) {
        onStatusChange(name, prevStatus, status)
      }
    }
  }
}

export function startPolling(intervalMs = 1000): void {
  pollOnce()
  pollInterval = setInterval(pollOnce, intervalMs)
}

export function stopPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}

export function cleanupAgent(name: string): void {
  const key = `flt-${name}`
  delete lastIcons[key]
  delete lastHashes[key]
  delete stableTracker[name]
}
