import { readFileSync } from 'fs'
import { join } from 'path'
import { resolveAdapter, getAdapter } from '../adapters/registry'
import type { AgentStatus } from '../adapters/types'
import { allAgents, setAgent, loadState, saveState, type AgentState } from '../state'
import { capturePane, hasSession, listSessions } from '../tmux'
import { appendInbox } from '../commands/init'
import { appendEvent } from '../activity'

const CONTENT_STABLE_TIMEOUT_MS = 60_000
const STUCK_THRESHOLD_MS = 30 * 60 * 1000  // 30 minutes

function getTypingAgent(): string | null {
  try {
    const home = process.env.HOME ?? require('os').homedir()
    return readFileSync(join(home, '.flt', 'typing'), 'utf-8').trim() || null
  } catch {
    return null
  }
}

// Per-agent tracking state
const lastIcons: Record<string, string> = {}
const iconStableCount: Record<string, number> = {}  // consecutive polls with same icon
const lastHashes: Record<string, string> = {}
const hashStableSince: Record<string, number> = {}  // when content stopped changing
const stableTracker: Record<string, { hash: string; since: number }> = {}
const runningSince: Record<string, number> = {}     // when agent entered 'running' state
const stuckWarned: Record<string, boolean> = {}     // whether 30m warning was already emitted

const ICON_IDLE_THRESHOLD = 3     // 3 consecutive same-icon polls (3s) before idle
const CONTENT_IDLE_GRACE_MS = 5000 // 5s of stable content before flipping running→idle
let cachedTypingAgent: string | null = null

function extractSpinnerIcon(pane: string): string | null {
  // Match the LAST spinner icon in the pane — earlier ones may be stale "Cooked for" lines
  // U+00B7 · U+2217 ∗ U+2722 ✢ U+2733 ✳ U+2736 ✶ U+273B ✻ U+273D ✽
  const matches = pane.match(/^[\u00B7\u2217\u2722\u2733\u2736\u273B\u273D]/gm)
  return matches ? matches[matches.length - 1] : null
}

function simpleHash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return String(h)
}

function detectAgentStatusFromPane(name: string, agent: AgentState, pane: string, paneHash: string): AgentStatus {
  try {
    const adapter = getAdapter(agent.cli)
    if (!adapter) return 'unknown'

    const stripped = pane.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')

    // Claude-code: spinner icon delta detection
    // The spinner cycles through · ✢ ✳ ∗ ✻ ✽ when active (~1s per icon).
    // When done, it freezes on ✻. Compare between polls:
    //   icon changed → running (reset stable count)
    //   icon same N times → idle (only after ICON_IDLE_THRESHOLD consecutive same reads)
    //   no icon → idle
    if (adapter.name === 'claude-code') {
      const last2 = stripped.split('\n').slice(-2).join('\n')
      if (/rate.?limit|hit your limit/i.test(last2)) return 'rate-limited'

      const icon = extractSpinnerIcon(stripped)

      if (icon) {
        const prev = lastIcons[name]
        lastIcons[name] = icon
        if (prev && prev !== icon) {
          // Icon changed — definitely running
          iconStableCount[name] = 0
          return 'running'
        }
        if (prev) {
          // Same icon — increment stable count, only declare idle after threshold
          iconStableCount[name] = (iconStableCount[name] ?? 0) + 1
          return iconStableCount[name] >= ICON_IDLE_THRESHOLD ? 'idle' : 'running'
        }
        // First time seeing icon — assume running
        iconStableCount[name] = 0
        return 'running'
      }

      delete lastIcons[name]
      delete iconStableCount[name]
      return 'idle'
    }

    // Other CLIs: adapter detection first
    const adapterResult = adapter.detectStatus(pane)
    if (adapterResult !== 'unknown') return adapterResult

    // Fallback: content-delta with grace period (reuse pre-computed hash)
    const prevHash = lastHashes[name]
    lastHashes[name] = paneHash

    // If user is typing into this agent, ignore content changes
    if (cachedTypingAgent === name) return agent.status ?? 'idle'

    if (prevHash && prevHash !== paneHash) {
      // Content changed — running, reset stable timer
      delete hashStableSince[name]
      return 'running'
    }
    if (prevHash && prevHash === paneHash) {
      // Content stable — only flip to idle after grace period
      if (!hashStableSince[name]) hashStableSince[name] = Date.now()
      return (Date.now() - hashStableSince[name]) >= CONTENT_IDLE_GRACE_MS ? 'idle' : (agent.status ?? 'idle')
    }
    return 'idle'
  } catch {
    return 'unknown'
  }
}

function applyContentStableTimeout(name: string, paneHash: string, adapterStatus: AgentStatus): AgentStatus {
  const hash = paneHash
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
  const state = loadState()
  const agents = state.agents
  const now = new Date().toISOString()
  let dirty = false
  cachedTypingAgent = getTypingAgent()
  const liveSessions = new Set(listSessions())

  for (const [name, agent] of Object.entries(agents)) {
    if (!liveSessions.has(agent.tmuxSession)) continue

    const prevStatus = agent.status
    const pane = capturePane(agent.tmuxSession, 50)
    const paneHash = simpleHash(pane)
    let status = detectAgentStatusFromPane(name, agent, pane, paneHash)
    status = applyContentStableTimeout(name, paneHash, status)

    // Stuck detector: track how long an agent has been continuously 'running'
    if (status === 'running') {
      if (!runningSince[name]) runningSince[name] = Date.now()
      if (!stuckWarned[name] && Date.now() - runningSince[name] >= STUCK_THRESHOLD_MS) {
        appendInbox('WATCHDOG', `Agent ${name} has been running for 30+ minutes — may be stuck`)
        stuckWarned[name] = true
      }
    } else {
      delete runningSince[name]
      delete stuckWarned[name]
    }

    if (status !== prevStatus) {
      agent.status = status
      agent.statusAt = now
      dirty = true
      appendEvent({
        type: 'status',
        agent: name,
        detail: `${prevStatus ?? 'unknown'} -> ${status}`,
        at: now,
      })
      if (onStatusChange) {
        onStatusChange(name, prevStatus, status)
      }
    }
  }

  // Watchdog: detect agents whose tmux session is gone
  for (const [name, agent] of Object.entries(agents)) {
    if (liveSessions.has(agent.tmuxSession)) continue
    if (agent.status === 'exited') continue

    const prevStatus = agent.status
    agent.status = 'exited'
    agent.statusAt = now
    dirty = true
    appendInbox('WATCHDOG', `Agent ${name} died (session gone)`)
    appendEvent({
      type: 'status',
      agent: name,
      detail: `${prevStatus ?? 'unknown'} -> exited`,
      at: now,
    })
    if (onStatusChange) {
      onStatusChange(name, prevStatus, 'exited')
    }

    // Clean up tracking state for dead agent (but leave worktree intact)
    delete runningSince[name]
    delete stuckWarned[name]
  }

  // Single write for all status changes
  if (dirty) saveState(state)
}

export function startPolling(intervalMs = 1000): void {
  if (pollInterval) return
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
  delete lastIcons[name]
  delete iconStableCount[name]
  delete lastHashes[name]
  delete hashStableSince[name]
  delete stableTracker[name]
  delete runningSince[name]
  delete stuckWarned[name]
}
