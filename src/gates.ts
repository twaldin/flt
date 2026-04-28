import { readdirSync, readFileSync, statSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { WorkflowRun } from './workflow/types'

export type GateKind = 'human_gate' | 'node-fail' | 'reconcile-fail' | 'node-candidate'

export interface GatePayload {
  kind: GateKind
  reason?: string
  message?: string
  [key: string]: unknown
}

export interface GateRow {
  runId: string
  workflow: string
  kind: GateKind
  reason: string
  ageMs: number
  runDir: string
  payload: GatePayload
}

export interface BlockerRow {
  runId: string
  workflow: string
  reason: string
  ageMs: number
  runDir: string
  report: Record<string, unknown>
}

function defaultRunsDir(): string {
  return join(homedir(), '.flt', 'runs')
}

export function scanGates(runsDir: string = defaultRunsDir()): GateRow[] {
  const rows: GateRow[] = []
  let entries: string[]
  try {
    entries = readdirSync(runsDir)
  } catch {
    return rows
  }

  for (const entry of entries) {
    const runDir = join(runsDir, entry)
    try {
      const run = JSON.parse(
        readFileSync(join(runDir, 'run.json'), 'utf-8'),
      ) as Pick<WorkflowRun, 'status' | 'workflow'>
      if (run.status === 'cancelled') continue

      const gatePath = join(runDir, '.gate-pending')
      let gateStat: ReturnType<typeof statSync>
      try {
        gateStat = statSync(gatePath)
      } catch {
        continue
      }

      const payload = JSON.parse(readFileSync(gatePath, 'utf-8')) as GatePayload
      rows.push({
        runId: entry,
        workflow: run.workflow,
        kind: payload.kind,
        reason: payload.reason ?? payload.message ?? '',
        ageMs: Date.now() - gateStat.mtime.getTime(),
        runDir,
        payload,
      })
    } catch {
      // skip malformed run dir
    }
  }

  return rows
}

export function scanBlockers(runsDir: string = defaultRunsDir()): BlockerRow[] {
  const rows: BlockerRow[] = []
  let entries: string[]
  try {
    entries = readdirSync(runsDir)
  } catch {
    return rows
  }

  for (const entry of entries) {
    const runDir = join(runsDir, entry)
    try {
      const run = JSON.parse(
        readFileSync(join(runDir, 'run.json'), 'utf-8'),
      ) as Pick<WorkflowRun, 'status' | 'workflow'>

      const blockerPath = join(runDir, 'artifacts', 'blocker_report.json')
      let blockerStat: ReturnType<typeof statSync>
      let reportText: string
      try {
        blockerStat = statSync(blockerPath)
        reportText = readFileSync(blockerPath, 'utf-8')
      } catch {
        continue
      }

      const report = JSON.parse(reportText) as Record<string, unknown>
      const reason =
        (report.reason as string | undefined) ?? (report.title as string | undefined) ?? ''
      rows.push({
        runId: entry,
        workflow: run.workflow,
        reason,
        ageMs: Date.now() - blockerStat.mtime.getTime(),
        runDir,
        report,
      })
    } catch {
      // skip malformed run dir
    }
  }

  return rows
}

export function cleanStaleGates(runsDir: string = defaultRunsDir()): { unlinked: string[] } {
  const unlinked: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(runsDir)
  } catch {
    return { unlinked }
  }

  for (const entry of entries) {
    const runDir = join(runsDir, entry)
    try {
      const run = JSON.parse(
        readFileSync(join(runDir, 'run.json'), 'utf-8'),
      ) as Pick<WorkflowRun, 'status' | 'workflow'>
      if (run.status !== 'cancelled' && run.status !== 'completed') continue

      const gatePath = join(runDir, '.gate-pending')
      try {
        statSync(gatePath)
        unlinkSync(gatePath)
        unlinked.push(gatePath)
      } catch {
        // no .gate-pending to remove
      }
    } catch {
      // skip malformed run dir
    }
  }

  return { unlinked }
}
