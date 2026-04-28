import { watch } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { cleanStaleGates, scanBlockers, scanGates } from '../gates'
import type { BlockerRow, GateRow } from '../gates'

function fmtAge(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 3) + '...' : s
}

const HEADER = 'AGE\tRUN\tWORKFLOW\tKIND\tREASON'

function renderGates(rows: GateRow[], json: boolean): void {
  if (json) {
    console.log(JSON.stringify(rows, null, 2))
    return
  }
  console.log(HEADER)
  for (const row of rows) {
    console.log(`${fmtAge(row.ageMs)}\t${row.runId}\t${row.workflow}\t${row.kind}\t${truncate(row.reason, 80)}`)
  }
}

function renderBlockers(rows: BlockerRow[], json: boolean): void {
  if (json) {
    console.log(JSON.stringify(rows, null, 2))
    return
  }
  console.log(HEADER)
  for (const row of rows) {
    console.log(`${fmtAge(row.ageMs)}\t${row.runId}\t${row.workflow}\tblocker\t${truncate(row.reason, 80)}`)
  }
}

export async function gates(opts: { json?: boolean; watch?: boolean; runsDir?: string }): Promise<void> {
  const runsDir = opts.runsDir ?? join(homedir(), '.flt', 'runs')

  const render = () => {
    cleanStaleGates(runsDir)
    const rows = scanGates(runsDir).sort((a, b) => b.ageMs - a.ageMs)
    renderGates(rows, !!opts.json)
  }

  render()

  if (!opts.watch) return

  let timer: ReturnType<typeof setTimeout> | null = null
  const watcher = watch(runsDir, { recursive: true }, () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(render, 200)
  })

  await new Promise<void>(resolve => {
    process.on('SIGINT', () => {
      if (timer) clearTimeout(timer)
      watcher.close()
      resolve()
    })
  })
}

export async function blockers(opts: { json?: boolean; watch?: boolean; runsDir?: string }): Promise<void> {
  const runsDir = opts.runsDir ?? join(homedir(), '.flt', 'runs')

  const render = () => {
    const rows = scanBlockers(runsDir).sort((a, b) => b.ageMs - a.ageMs)
    renderBlockers(rows, !!opts.json)
  }

  render()

  if (!opts.watch) return

  let timer: ReturnType<typeof setTimeout> | null = null
  const watcher = watch(runsDir, { recursive: true }, () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(render, 200)
  })

  await new Promise<void>(resolve => {
    process.on('SIGINT', () => {
      if (timer) clearTimeout(timer)
      watcher.close()
      resolve()
    })
  })
}
