import { listWorkflowRuns } from './workflow/engine'
import type { WorkflowRun } from './workflow/types'

export type WorkflowFilter = 'all' | 'running' | 'completed' | 'failed'

export interface WorkflowRow {
  id: string
  workflow: string
  currentStep: string
  status: WorkflowRun['status']
  startedAt: string
  startedAtDisplay: string
  parentName: string
}

export interface WorkflowStepRow {
  name: string
  agent: string | undefined
  status: 'completed' | 'failed' | 'skipped'
  at: string
  atDisplay: string
  duration: string
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
    }))
}

export function getWorkflowHistory(id: string): WorkflowStepRow[] {
  const run = listWorkflowRuns().find(r => r.id === id)
  if (!run) return []

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
    }
  })
}
