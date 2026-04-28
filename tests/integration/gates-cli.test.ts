import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const CLI = join(import.meta.dir, '../../src/cli.ts')

function run(args: string[]) {
  const result = Bun.spawnSync(['bun', 'run', CLI, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return {
    stdout: result.stdout?.toString() ?? '',
    stderr: result.stderr?.toString() ?? '',
    exitCode: result.exitCode,
  }
}

function makeRun(runsDir: string, id: string, workflow: string, status = 'running') {
  const runDir = join(runsDir, id)
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({ status, workflow }))
  return runDir
}

function makeGate(runDir: string, kind: string, reason: string, ageSecs = 0) {
  const gatePath = join(runDir, '.gate-pending')
  writeFileSync(gatePath, JSON.stringify({ kind, reason }))
  if (ageSecs > 0) {
    const t = new Date(Date.now() - ageSecs * 1000)
    utimesSync(gatePath, t, t)
  }
}

function makeBlocker(runDir: string, reason: string) {
  const artifactsDir = join(runDir, 'artifacts')
  mkdirSync(artifactsDir, { recursive: true })
  writeFileSync(join(artifactsDir, 'blocker_report.json'), JSON.stringify({ reason }))
}

describe('gates-cli', () => {
  let runsDir: string

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'flt-gates-test-'))
  })

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true })
  })

  it('prints tab-separated rows sorted by ageMs desc', () => {
    const runDir1 = makeRun(runsDir, 'run-old', 'my-workflow')
    makeGate(runDir1, 'human_gate', 'needs review', 120)
    const runDir2 = makeRun(runsDir, 'run-new', 'my-workflow')
    makeGate(runDir2, 'node-fail', 'test failed', 60)

    const { stdout, exitCode } = run(['gates', '--runs-dir', runsDir])
    expect(exitCode).toBe(0)
    const lines = stdout.trim().split('\n')
    expect(lines[0]).toBe('AGE\tRUN\tWORKFLOW\tKIND\tREASON')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('run-old')
    expect(lines[2]).toContain('run-new')
  })

  it('flt gates --json produces parseable JSON whose first row matches the fixture', () => {
    const runDir1 = makeRun(runsDir, 'run-abc', 'wf-test')
    makeGate(runDir1, 'human_gate', 'approve please', 300)
    const runDir2 = makeRun(runsDir, 'run-xyz', 'wf-test')
    makeGate(runDir2, 'node-fail', 'build broke', 60)

    const { stdout, exitCode } = run(['gates', '--json', '--runs-dir', runsDir])
    expect(exitCode).toBe(0)
    const rows = JSON.parse(stdout) as Array<Record<string, unknown>>
    expect(Array.isArray(rows)).toBe(true)
    expect(rows[0].runId).toBe('run-abc')
    expect(rows[0].workflow).toBe('wf-test')
    expect(rows[0].kind).toBe('human_gate')
  })

  it('flt blockers surfaces blocker_report.json rows', () => {
    const runDir = makeRun(runsDir, 'run-blocked', 'wf-blocked')
    makeBlocker(runDir, 'missing secret API_KEY')

    const { stdout, exitCode } = run(['blockers', '--runs-dir', runsDir])
    expect(exitCode).toBe(0)
    const lines = stdout.trim().split('\n')
    expect(lines[0]).toBe('AGE\tRUN\tWORKFLOW\tKIND\tREASON')
    expect(lines.some(l => l.includes('run-blocked'))).toBe(true)
    expect(lines.some(l => l.includes('missing secret API_KEY'))).toBe(true)
  })

  it('prints only header when runsDir has no pending gates', () => {
    makeRun(runsDir, 'run-clean', 'my-workflow')

    const { stdout, exitCode } = run(['gates', '--runs-dir', runsDir])
    expect(exitCode).toBe(0)
    const lines = stdout.trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe('AGE\tRUN\tWORKFLOW\tKIND\tREASON')
  })

  it('--watch flag is accepted without arg parse error', () => {
    const { stdout, exitCode } = run(['gates', '--help'])
    expect(exitCode).toBe(0)
    expect(stdout).toContain('--watch')
  })
})
