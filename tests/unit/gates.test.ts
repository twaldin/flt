import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { cleanStaleGates, scanBlockers, scanGates } from '../../src/gates'

function makeRunDir(runsDir: string, runId: string): string {
  const runDir = join(runsDir, runId)
  mkdirSync(runDir, { recursive: true })
  return runDir
}

function writeRunJson(runDir: string, status: string, workflow = 'test-workflow') {
  writeFileSync(
    join(runDir, 'run.json'),
    JSON.stringify({
      id: runDir,
      workflow,
      status,
      currentStep: '',
      parentName: '',
      history: [],
      retries: {},
      vars: {},
      startedAt: new Date().toISOString(),
    }),
  )
}

function writeGatePending(runDir: string, payload: object) {
  writeFileSync(join(runDir, '.gate-pending'), JSON.stringify(payload))
}

describe('scanGates', () => {
  let runsDir: string

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'flt-gates-'))
  })

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true })
  })

  test('returns empty for empty runsDir', () => {
    expect(scanGates(runsDir)).toEqual([])
  })

  test('surfaces a human_gate row', () => {
    const runDir = makeRunDir(runsDir, 'run-001')
    writeRunJson(runDir, 'running', 'my-workflow')
    writeGatePending(runDir, { kind: 'human_gate', reason: 'approve PR' })

    const rows = scanGates(runsDir)
    expect(rows).toHaveLength(1)
    expect(rows[0].runId).toBe('run-001')
    expect(rows[0].workflow).toBe('my-workflow')
    expect(rows[0].kind).toBe('human_gate')
    expect(rows[0].reason).toBe('approve PR')
    expect(rows[0].runDir).toBe(runDir)
    expect(rows[0].ageMs).toBeGreaterThanOrEqual(0)
  })

  test('surfaces node-fail, reconcile-fail, node-candidate rows', () => {
    const cases: Array<{ kind: string; reason: string }> = [
      { kind: 'node-fail', reason: 'reason-node-fail' },
      { kind: 'reconcile-fail', reason: 'reason-reconcile-fail' },
      { kind: 'node-candidate', reason: 'reason-node-candidate' },
    ]
    for (const [i, c] of cases.entries()) {
      const runDir = makeRunDir(runsDir, `run-${i}`)
      writeRunJson(runDir, 'running')
      writeGatePending(runDir, { kind: c.kind, reason: c.reason })
    }

    const rows = scanGates(runsDir)
    expect(rows).toHaveLength(3)
    const byKind = Object.fromEntries(rows.map(r => [r.kind, r]))
    expect(byKind['node-fail'].reason).toBe('reason-node-fail')
    expect(byKind['reconcile-fail'].reason).toBe('reason-reconcile-fail')
    expect(byKind['node-candidate'].reason).toBe('reason-node-candidate')
  })

  test('skips runs whose run.json status is cancelled', () => {
    const runDir = makeRunDir(runsDir, 'run-cancelled')
    writeRunJson(runDir, 'cancelled')
    writeGatePending(runDir, { kind: 'human_gate', reason: 'stale' })

    expect(scanGates(runsDir)).toEqual([])
  })

  test('reason falls back to payload.message when reason is absent', () => {
    const runDir = makeRunDir(runsDir, 'run-msg')
    writeRunJson(runDir, 'running')
    writeGatePending(runDir, { kind: 'node-fail', message: 'something broke' })

    const rows = scanGates(runsDir)
    expect(rows[0].reason).toBe('something broke')
  })

  test('reason is empty string when neither reason nor message present', () => {
    const runDir = makeRunDir(runsDir, 'run-noreason')
    writeRunJson(runDir, 'running')
    writeGatePending(runDir, { kind: 'human_gate' })

    const rows = scanGates(runsDir)
    expect(rows[0].reason).toBe('')
  })

  test('ageMs is non-negative and roughly matches mtime delta', () => {
    const runDir = makeRunDir(runsDir, 'run-age')
    writeRunJson(runDir, 'running')
    writeGatePending(runDir, { kind: 'human_gate', reason: 'test' })

    const gatePath = join(runDir, '.gate-pending')
    const twoSecondsAgo = new Date(Date.now() - 2000)
    utimesSync(gatePath, twoSecondsAgo, twoSecondsAgo)

    const rows = scanGates(runsDir)
    expect(rows).toHaveLength(1)
    expect(rows[0].ageMs).toBeGreaterThanOrEqual(1900)
    expect(rows[0].ageMs).toBeLessThan(10000)
  })
})

describe('scanBlockers', () => {
  let runsDir: string

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'flt-blockers-'))
  })

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true })
  })

  test('returns empty for empty runsDir', () => {
    expect(scanBlockers(runsDir)).toEqual([])
  })

  test('returns empty for runs without blocker_report.json', () => {
    const runDir = makeRunDir(runsDir, 'run-nob')
    writeRunJson(runDir, 'running')
    expect(scanBlockers(runsDir)).toEqual([])
  })

  test('returns blocker rows for runs with blocker_report.json', () => {
    const runDir = makeRunDir(runsDir, 'run-blocker')
    writeRunJson(runDir, 'running', 'blocked-workflow')
    mkdirSync(join(runDir, 'artifacts'), { recursive: true })
    writeFileSync(
      join(runDir, 'artifacts', 'blocker_report.json'),
      JSON.stringify({ reason: 'missing secret', detail: 'SECRET_KEY not set' }),
    )

    const rows = scanBlockers(runsDir)
    expect(rows).toHaveLength(1)
    expect(rows[0].runId).toBe('run-blocker')
    expect(rows[0].workflow).toBe('blocked-workflow')
    expect(rows[0].reason).toBe('missing secret')
    expect(rows[0].runDir).toBe(runDir)
    expect(rows[0].ageMs).toBeGreaterThanOrEqual(0)
    expect(rows[0].report).toMatchObject({ reason: 'missing secret', detail: 'SECRET_KEY not set' })
  })

  test('reason falls back to report.title when reason is absent', () => {
    const runDir = makeRunDir(runsDir, 'run-title')
    writeRunJson(runDir, 'running')
    mkdirSync(join(runDir, 'artifacts'), { recursive: true })
    writeFileSync(
      join(runDir, 'artifacts', 'blocker_report.json'),
      JSON.stringify({ title: 'ambiguous requirement' }),
    )

    const rows = scanBlockers(runsDir)
    expect(rows[0].reason).toBe('ambiguous requirement')
  })

  test('reason is empty string when neither reason nor title present', () => {
    const runDir = makeRunDir(runsDir, 'run-noreport')
    writeRunJson(runDir, 'running')
    mkdirSync(join(runDir, 'artifacts'), { recursive: true })
    writeFileSync(join(runDir, 'artifacts', 'blocker_report.json'), JSON.stringify({}))

    const rows = scanBlockers(runsDir)
    expect(rows[0].reason).toBe('')
  })
})

describe('cleanStaleGates', () => {
  let runsDir: string

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'flt-clean-'))
  })

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true })
  })

  test('returns empty unlinked list for empty runsDir', () => {
    expect(cleanStaleGates(runsDir)).toEqual({ unlinked: [] })
  })

  test('unlinks .gate-pending for cancelled runs', () => {
    const runDir = makeRunDir(runsDir, 'run-cancelled')
    writeRunJson(runDir, 'cancelled')
    writeGatePending(runDir, { kind: 'human_gate' })

    const result = cleanStaleGates(runsDir)
    expect(result.unlinked).toHaveLength(1)
    expect(result.unlinked[0]).toBe(join(runDir, '.gate-pending'))
  })

  test('unlinks .gate-pending for completed runs', () => {
    const runDir = makeRunDir(runsDir, 'run-completed')
    writeRunJson(runDir, 'completed')
    writeGatePending(runDir, { kind: 'node-candidate' })

    const result = cleanStaleGates(runsDir)
    expect(result.unlinked).toHaveLength(1)
    expect(result.unlinked[0]).toBe(join(runDir, '.gate-pending'))
  })

  test('leaves .gate-pending for running runs', () => {
    const runDir = makeRunDir(runsDir, 'run-running')
    writeRunJson(runDir, 'running')
    writeGatePending(runDir, { kind: 'human_gate' })

    const result = cleanStaleGates(runsDir)
    expect(result.unlinked).toEqual([])
  })

  test('skips runs without .gate-pending', () => {
    const runDir = makeRunDir(runsDir, 'run-nogate')
    writeRunJson(runDir, 'cancelled')

    const result = cleanStaleGates(runsDir)
    expect(result.unlinked).toEqual([])
  })

  test('unlinks cancelled and completed, leaves running', () => {
    const cancelled = makeRunDir(runsDir, 'run-c')
    writeRunJson(cancelled, 'cancelled')
    writeGatePending(cancelled, { kind: 'human_gate' })

    const completed = makeRunDir(runsDir, 'run-done')
    writeRunJson(completed, 'completed')
    writeGatePending(completed, { kind: 'node-candidate' })

    const running = makeRunDir(runsDir, 'run-r')
    writeRunJson(running, 'running')
    writeGatePending(running, { kind: 'node-fail' })

    const result = cleanStaleGates(runsDir)
    expect(result.unlinked).toHaveLength(2)
    expect(result.unlinked).toContain(join(cancelled, '.gate-pending'))
    expect(result.unlinked).toContain(join(completed, '.gate-pending'))
  })
})
