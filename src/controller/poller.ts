import { readFileSync } from 'fs'
import { join } from 'path'
import { resolveAdapter, getAdapter } from '../adapters/registry'
import type { AgentStatus } from '../adapters/types'
import { loadState, saveState, type AgentState } from '../state'
import { capturePane, listSessions, sendKeys } from '../tmux'
import { appendInbox } from '../commands/init'
import { appendEvent } from '../activity'
import { killDirect } from '../commands/kill'

const CONTENT_STABLE_TIMEOUT_MS = 60_000
const STUCK_THRESHOLD_MS = 30 * 60 * 1000      // 30 min: warn
const STUCK_KILL_MS = 60 * 60 * 1000           // 60 min: force-kill (workflow agents only)
const DEATH_GRACE_MS = 2000

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
const deathCandidateSince: Record<string, { since: number; reason: string }> = {}

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

function detectDeathReason(agent: AgentState, liveSessions: Set<string>): string | null {
  // Liveness source of truth: tmux session presence only.
  // Process-name based checks are too flaky across CLIs/startup wrappers
  // and can produce false deaths during normal operation.
  if (!liveSessions.has(agent.tmuxSession)) {
    return 'session gone'
  }

  return null
}

function detectAgentStatusFromPane(name: string, agent: AgentState, pane: string, paneHash: string): AgentStatus {
  try {
    const adapter = getAdapter(agent.cli)

    const stripped = pane.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')

    // Unknown adapter fallback: content-delta running/idle heuristic.
    if (!adapter) {
      const prevHash = lastHashes[name]
      lastHashes[name] = paneHash

      if (cachedTypingAgent === name) return agent.status ?? 'idle'

      if (prevHash && prevHash !== paneHash) {
        delete hashStableSince[name]
        return 'running'
      }
      if (prevHash && prevHash === paneHash) {
        if (!hashStableSince[name]) hashStableSince[name] = Date.now()
        return (Date.now() - hashStableSince[name]) >= CONTENT_IDLE_GRACE_MS ? 'idle' : (agent.status ?? 'idle')
      }
      return agent.status ?? 'idle'
    }

    // Claude-code: spinner icon delta detection
    if (adapter.name === 'claude-code') {
      const last2 = stripped.split('\n').slice(-2).join('\n')
      if (/rate.?limit|hit your limit/i.test(last2)) return 'rate-limited'

      const icon = extractSpinnerIcon(stripped)

      if (icon) {
        const prev = lastIcons[name]
        lastIcons[name] = icon
        if (prev && prev !== icon) {
          iconStableCount[name] = 0
          return 'running'
        }
        if (prev) {
          iconStableCount[name] = (iconStableCount[name] ?? 0) + 1
          return iconStableCount[name] >= ICON_IDLE_THRESHOLD ? 'idle' : 'running'
        }
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

    // Fallback: content-delta with grace period
    const prevHash = lastHashes[name]
    lastHashes[name] = paneHash

    if (cachedTypingAgent === name) return agent.status ?? 'idle'

    if (prevHash && prevHash !== paneHash) {
      delete hashStableSince[name]
      return 'running'
    }
    if (prevHash && prevHash === paneHash) {
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

  if (Date.now() - prev.since >= CONTENT_STABLE_TIMEOUT_MS) {
    if (adapterStatus === 'running' || adapterStatus === 'unknown') {
      return 'idle'
    }
  }

  return adapterStatus
}

function handleWorkflowStepFailure(name: string): void {
  import('../workflow/engine').then(({ getWorkflowForAgent, handleStepFailure }) => {
    const workflowName = getWorkflowForAgent(name)
    if (workflowName) {
      handleStepFailure(workflowName).catch(() => {})
    }
  }).catch(() => {})
}

function cleanupDeadAgent(name: string, reason: string): void {
  appendInbox('WATCHDOG', `Agent ${name} died (${reason}); cleaning up`) 
  try {
    // Keep workflow alive; let engine mark the step failure instead of cancelling run.
    killDirect({ name, fromWorkflow: true })
    handleWorkflowStepFailure(name)
  } catch {
    // Best effort — state may already be cleaned.
  }
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
  const nowIso = new Date().toISOString()
  const nowMs = Date.now()
  let dirty = false
  let performedCleanup = false

  cachedTypingAgent = getTypingAgent()
  const liveSessions = new Set(listSessions())

  const toCleanup: Array<{ name: string; reason: string }> = []

  for (const [name, agent] of Object.entries(agents)) {
    const deathReason = detectDeathReason(agent, liveSessions)
    if (deathReason) {
      const candidate = deathCandidateSince[name]
      if (!candidate || candidate.reason !== deathReason) {
        deathCandidateSince[name] = { since: nowMs, reason: deathReason }
      } else if (nowMs - candidate.since >= DEATH_GRACE_MS) {
        toCleanup.push({ name, reason: deathReason })
      }
      continue
    }

    delete deathCandidateSince[name]

    const prevStatus = agent.status
    const pane = capturePane(agent.tmuxSession, 50)
    // Hash the stripped pane (no ANSI/cursor moves) so spinner-only changes
    // don't keep paneHash churning. Without this, spinner-heavy CLIs (gemini,
    // codex) never satisfy the content-idle grace and look "stuck running"
    // indefinitely even when the underlying agent is genuinely idle.
    const strippedForHash = pane.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
    const paneHash = simpleHash(strippedForHash)
    let status = detectAgentStatusFromPane(name, agent, pane, paneHash)

    // Auto-approve dialogs
    if (status === ('dialog' as AgentStatus)) {
      try {
        const adapter = resolveAdapter(agent.cli)
        const keys = adapter.handleDialog(pane)
        if (keys) {
          for (const key of keys) {
            sendKeys(agent.tmuxSession, [key])
          }
        }
      } catch {}
      status = 'unknown'
    }

    status = applyContentStableTimeout(name, paneHash, status)

    // Stuck detector
    if (status === 'running') {
      if (!runningSince[name]) runningSince[name] = nowMs
      const runningFor = nowMs - runningSince[name]
      if (!stuckWarned[name] && runningFor >= STUCK_THRESHOLD_MS) {
        appendInbox('WATCHDOG', `Agent ${name} has been running for 30+ minutes — may be stuck`)
        stuckWarned[name] = true
      }
      // Hard timeout: 60 min for workflow agents — force-kill so engine can
      // fail the node and either retry or open a gate. Non-workflow agents
      // get the warning but no auto-kill (user may have legit long tasks).
      if (runningFor >= STUCK_KILL_MS && (agent.workflow || agent.workflowStep)) {
        appendInbox('WATCHDOG', `Agent ${name} stuck running ${Math.round(runningFor / 60000)}m — force-killing for engine retry`)
        toCleanup.push({ name, reason: 'stuck-timeout' })
        delete runningSince[name]
        delete stuckWarned[name]
        continue
      }
    } else {
      delete runningSince[name]
      delete stuckWarned[name]
    }

    if (status !== prevStatus) {
      agent.status = status
      agent.statusAt = nowIso
      dirty = true
      appendEvent({
        type: 'status',
        agent: name,
        detail: `${prevStatus ?? 'unknown'} -> ${status}`,
        at: nowIso,
      })
      if (onStatusChange) {
        onStatusChange(name, prevStatus, status)
      }
    }
  }

  if (toCleanup.length > 0) {
    for (const { name, reason } of toCleanup) {
      cleanupDeadAgent(name, reason)
      performedCleanup = true
    }
  }

  // Avoid writing stale pre-cleanup state back over killDirect removals.
  if (performedCleanup) return

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
  delete deathCandidateSince[name]
}
