import { listEvents } from './activity'
import { listWorkflowRuns } from './workflow/engine'
import type { WorkflowRun } from './workflow/types'

export type WorkflowFilter = 'all' | 'running' | 'completed' | 'failed'

export interface WorkflowCost {
  usd: number
  tokensIn: number
  tokensOut: number
}

export interface WorkflowRow {
  id: string
  workflow: string
  currentStep: string
  status: WorkflowRun['status']
  startedAt: string
  startedAtDisplay: string
  parentName: string
  task: string
  cost: WorkflowCost
}

export interface WorkflowStepRow {
  name: string
  agent: string | undefined
  status: 'completed' | 'failed' | 'skipped'
  at: string
  atDisplay: string
  duration: string
  cost: WorkflowCost
}

function emptyCost(): WorkflowCost {
  return { usd: 0, tokensIn: 0, tokensOut: 0 }
}

interface AgentKillCost extends WorkflowCost {
  at: string
}

const KILL_COST_CACHE: Map<string, AgentKillCost[]> = new Map()
let killCacheLoadedAt = 0

function getAgentKillCosts(agentName: string): AgentKillCost[] {
  // Refresh the kill-event cache every 10s to keep TUI cost columns live without
  // re-reading activity.log on every redraw.
  const now = Date.now()
  if (now - killCacheLoadedAt > 10_000) {
    KILL_COST_CACHE.clear()
    const kills = listEvents({ type: 'kill', limit: 100_000 })
    for (const event of kills) {
      if (!event.agent) continue
      const arr = KILL_COST_CACHE.get(event.agent) ?? []
      arr.push({
        usd: event.cost_usd ?? 0,
        tokensIn: event.tokens_in ?? 0,
        tokensOut: event.tokens_out ?? 0,
        at: event.at,
      })
      KILL_COST_CACHE.set(event.agent, arr)
    }
    killCacheLoadedAt = now
  }
  return KILL_COST_CACHE.get(agentName) ?? []
}

function sumCostFor(agentName: string, fromIso?: string, toIso?: string): WorkflowCost {
  const fromMs = fromIso ? Date.parse(fromIso) : -Infinity
  const toMs = toIso ? Date.parse(toIso) : Infinity
  let usd = 0, tokensIn = 0, tokensOut = 0
  for (const cost of getAgentKillCosts(agentName)) {
    const t = Date.parse(cost.at)
    if (!Number.isFinite(t)) continue
    if (t < fromMs || t > toMs) continue
    usd += cost.usd
    tokensIn += cost.tokensIn
    tokensOut += cost.tokensOut
  }
  return { usd, tokensIn, tokensOut }
}

function sumRunCost(run: WorkflowRun): WorkflowCost {
  // Sum across every agent the run spawned: <runId>-<step> for any step.
  // Iterate kill events directly for correctness across step renames / retries.
  const total = emptyCost()
  for (const [agentName, costs] of KILL_COST_CACHE.entries()) {
    if (agentName !== run.id && !agentName.startsWith(`${run.id}-`)) continue
    for (const cost of costs) {
      total.usd += cost.usd
      total.tokensIn += cost.tokensIn
      total.tokensOut += cost.tokensOut
    }
  }
  return total
}

function formatShortDateTime(iso: string): string {
  const dt = new Date(iso)
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  const hh = String(dt.getHours()).padStart(2, '0')
  const mi = String(dt.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
}

function formatTime(iso: string): string {
  const dt = new Date(iso)
  const hh = String(dt.getHours()).padStart(2, '0')
  const mi = String(dt.getMinutes()).padStart(2, '0')
  const ss = String(dt.getSeconds()).padStart(2, '0')
  return `${hh}:${mi}:${ss}`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s'

  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`

  const totalMinutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (totalMinutes < 60) {
    if (seconds === 0) return `${totalMinutes}m`
    return `${totalMinutes}m ${seconds}s`
  }

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}h ${minutes}m`
}

export function listWorkflows(filter: WorkflowFilter): WorkflowRow[] {
  const runs = listWorkflowRuns()
  const filtered = runs.filter((run) => {
    if (filter === 'all') return true
    if (filter === 'running') return run.status === 'running'
    if (filter === 'completed') return run.status === 'completed'
    return run.status === 'failed' || run.status === 'cancelled'
  })

  // Prime the kill-event cache once so per-run sums share work.
  getAgentKillCosts('__prime__')

  return filtered
    .map((run, idx) => ({ run, idx }))
    .sort((a, b) => {
      const diff = new Date(b.run.startedAt).getTime() - new Date(a.run.startedAt).getTime()
      if (diff !== 0) return diff
      return a.idx - b.idx
    })
    .map(({ run }) => ({
      id: run.id,
      workflow: run.workflow,
      currentStep: run.currentStep,
      status: run.status,
      startedAt: run.startedAt,
      startedAtDisplay: formatShortDateTime(run.startedAt),
      parentName: run.parentName,
      task: run.vars._input?.task ?? '',
      cost: sumRunCost(run),
    }))
}

export function getWorkflowHistory(id: string): WorkflowStepRow[] {
  const run = listWorkflowRuns().find(r => r.id === id)
  if (!run) return []

  // Prime the kill-event cache.
  getAgentKillCosts('__prime__')

  // Pair history entries to kill events by ORDER, not time window. The kill
  // event for a step fires AFTER history.at is stamped (advanceWorkflow writes
  // history first, then cleans up agents), so a strict [prev, this] window
  // misses the kill. The Nth history entry for agent X gets the Nth kill
  // event for agent X.
  const killCursors = new Map<string, number>()
  const stepCosts = new Map<number, WorkflowCost>()
  run.history.forEach((entry, idx) => {
    if (!entry.agent) return
    const cursor = killCursors.get(entry.agent) ?? 0
    const kills = getAgentKillCosts(entry.agent)
    if (cursor < kills.length) {
      const k = kills[cursor]
      stepCosts.set(idx, { usd: k.usd, tokensIn: k.tokensIn, tokensOut: k.tokensOut })
      killCursors.set(entry.agent, cursor + 1)
    }
  })

  return run.history.map((entry, idx) => {
    const prevAt = idx > 0 ? run.history[idx - 1].at : run.startedAt
    const durationMs = Math.max(0, new Date(entry.at).getTime() - new Date(prevAt).getTime())
    return {
      name: entry.step,
      agent: entry.agent,
      status: entry.result,
      at: entry.at,
      atDisplay: formatTime(entry.at),
      duration: formatDuration(durationMs),
      cost: stepCosts.get(idx) ?? emptyCost(),
    }
  })
}

export function formatUsd(cost: WorkflowCost): string {
  if (cost.usd === 0) return '—'
  if (cost.usd >= 1) return `$${cost.usd.toFixed(2)}`
  if (cost.usd >= 0.01) return `$${cost.usd.toFixed(3)}`
  return `$${cost.usd.toFixed(4)}`
}

export function formatTokens(cost: WorkflowCost): string {
  if (cost.tokensIn === 0 && cost.tokensOut === 0) return '—'
  const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)
  return `${fmt(cost.tokensIn)}/${fmt(cost.tokensOut)}`
}

/** Strip the workflow-name prefix from an old-style runId so we can show it
 * alongside its workflow as separate columns. New-style runIds (slug-only)
 * are returned unchanged. */
export function deriveSlug(runId: string, workflow: string): string {
  if (runId === workflow) return ''
  if (runId.startsWith(`${workflow}-`)) return runId.slice(workflow.length + 1)
  return runId
}
