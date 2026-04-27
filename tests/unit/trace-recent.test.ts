import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { traceRecent } from '../../src/commands/trace'

function writeRun(home: string, opts: {
  id: string
  workflow: string
  startedAt: string
  completedAt?: string
  outcome: 'completed' | 'failed' | 'cancelled'
  costUsd: number
}): void {
  const runDir = join(home, '.flt', 'runs', opts.id)
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({
    id: opts.id,
    workflow: opts.workflow,
    startedAt: opts.startedAt,
    completedAt: opts.completedAt,
  }))
  writeFileSync(join(runDir, 'metrics.json'), JSON.stringify({
    outcome: opts.outcome,
    cost: { usd: opts.costUsd, tokensIn: 0, tokensOut: 0 },
  }))
}

describe('trace recent', () => {
  let home = ''
  let prevHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'flt-trace-recent-'))
    prevHome = process.env.HOME
    process.env.HOME = home
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  })

  it('lists recent runs in startedAt-desc order with tsv output', () => {
    const now = Date.now()
    const iso = (msAgo: number): string => new Date(now - msAgo).toISOString()

    writeRun(home, {
      id: 'run-pass',
      workflow: 'ship',
      startedAt: iso(15 * 60 * 1000),
      completedAt: iso(10 * 60 * 1000),
      outcome: 'completed',
      costUsd: 1.25,
    })
    writeRun(home, {
      id: 'run-fail',
      workflow: 'ship',
      startedAt: iso(45 * 60 * 1000),
      completedAt: iso(40 * 60 * 1000),
      outcome: 'failed',
      costUsd: 0.75,
    })
    writeRun(home, {
      id: 'run-old',
      workflow: 'ship',
      startedAt: iso(5 * 60 * 60 * 1000),
      completedAt: iso(4 * 60 * 60 * 1000),
      outcome: 'completed',
      costUsd: 2,
    })

    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    traceRecent({ since: '2h', status: 'all' })
    const lines = logSpy.mock.calls.map((call) => String(call[0]))
    logSpy.mockRestore()

    expect(lines).toHaveLength(2)
    expect(lines[0]?.split('\t')).toEqual([
      'run-pass',
      'ship',
      'passed',
      iso(15 * 60 * 1000),
      iso(10 * 60 * 1000),
      '1.25',
    ])
    expect(lines[1]?.split('\t')[0]).toBe('run-fail')
  })

  it('filters by failed status and includes cancelled outcomes', () => {
    const now = Date.now()
    const iso = (msAgo: number): string => new Date(now - msAgo).toISOString()

    writeRun(home, {
      id: 'run-cancel',
      workflow: 'wf',
      startedAt: iso(20 * 60 * 1000),
      completedAt: iso(19 * 60 * 1000),
      outcome: 'cancelled',
      costUsd: 0,
    })
    writeRun(home, {
      id: 'run-pass',
      workflow: 'wf',
      startedAt: iso(10 * 60 * 1000),
      completedAt: iso(9 * 60 * 1000),
      outcome: 'completed',
      costUsd: 0,
    })

    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    traceRecent({ since: '1h', status: 'failed' })
    const lines = logSpy.mock.calls.map((call) => String(call[0]))
    logSpy.mockRestore()

    expect(lines).toHaveLength(1)
    expect(lines[0]?.split('\t').slice(0, 3)).toEqual(['run-cancel', 'wf', 'failed'])
  })

  it('throws for invalid duration', () => {
    expect(() => traceRecent({ since: 'bad', status: 'all' })).toThrow('Invalid duration')
  })
})
