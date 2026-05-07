import { existsSync, readFileSync } from 'fs'
import { allAgents, setAgent } from '../state'
import { listSessions } from '../tmux'
import { restoreInstructions } from '../instructions'
import { appendEvent } from '../activity'

interface AuditArgs {
  json?: boolean
  restore?: boolean
}

type RowState = 'active' | 'orphan-session-gone' | 'orphan-no-markers' | 'orphan-file-missing'

interface AuditRow {
  agent: string
  filePath: string
  tmuxSession: string
  state: RowState
  reason?: string
}

const MARKER_START = '<!-- flt:start -->'
const MARKER_END = '<!-- flt:end -->'

export function scanProjections(): AuditRow[] {
  const agents = allAgents()
  const live = new Set(listSessions())
  const rows: AuditRow[] = []

  for (const [name, agent] of Object.entries(agents)) {
    const projection = agent.instructionProjection
    if (!projection) continue

    const filePath = projection.filePath
    const sessionAlive = live.has(agent.tmuxSession)
    let state: RowState = 'active'
    let reason: string | undefined

    if (!sessionAlive) {
      state = 'orphan-session-gone'
      reason = `tmux session ${agent.tmuxSession} not found`
    } else if (!existsSync(filePath)) {
      // Session is alive but the file was removed/moved out from under flt.
      // Restore is a no-op anyway, but it's still an orphan record worth flagging.
      state = 'orphan-file-missing'
      reason = 'projected file no longer exists'
    } else {
      const content = readFileSync(filePath, 'utf-8')
      if (!content.includes(MARKER_START) || !content.includes(MARKER_END)) {
        state = 'orphan-no-markers'
        reason = 'flt:start..flt:end markers missing in file'
      }
    }

    rows.push({ agent: name, filePath, tmuxSession: agent.tmuxSession, state, reason })
  }

  return rows
}

export function restoreOrphans(rows: AuditRow[]): { restored: number; failures: Array<{ agent: string; error: string }> } {
  const agents = allAgents()
  let restored = 0
  const failures: Array<{ agent: string; error: string }> = []

  for (const row of rows) {
    if (row.state === 'active') continue
    const agent = agents[row.agent]
    if (!agent?.instructionProjection) continue

    try {
      restoreInstructions(agent.instructionProjection)
      appendEvent({
        type: 'instructions',
        agent: row.agent,
        detail: `audit restored ${row.filePath}`,
        at: new Date().toISOString(),
      })
      restored++
    } catch (e) {
      failures.push({ agent: row.agent, error: (e as Error).message })
    }

    // Always clear the field — repeated audits on a broken backup just spam.
    setAgent(row.agent, { ...agent, instructionProjection: undefined })
  }

  return { restored, failures }
}

export function auditProjections(args: AuditArgs): void {
  const rows = scanProjections()

  if (args.restore) {
    const { restored, failures } = restoreOrphans(rows)
    if (args.json) {
      console.log(JSON.stringify({ rows, restored, failures }, null, 2))
    } else {
      printTable(rows)
      console.log(`\nRestored ${restored} orphaned projection(s)${failures.length ? `; ${failures.length} failed` : ''}.`)
      for (const f of failures) {
        console.error(`  ${f.agent}: ${f.error}`)
      }
    }
    return
  }

  if (args.json) {
    console.log(JSON.stringify({ rows }, null, 2))
    return
  }

  printTable(rows)
}

function printTable(rows: AuditRow[]): void {
  if (rows.length === 0) {
    console.log('No instruction projections recorded.')
    return
  }
  const orphans = rows.filter(r => r.state !== 'active')
  console.log(`AGENT\tSTATE\tFILE\tNOTE`)
  for (const r of rows) {
    console.log(`${r.agent}\t${r.state}\t${r.filePath}\t${r.reason ?? ''}`)
  }
  if (orphans.length > 0) {
    console.log(`\n${orphans.length} orphan(s). Re-run with --restore to clean up.`)
  }
}
