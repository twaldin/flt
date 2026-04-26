import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { classifyTier, gcAllRuns, gcRun } from '../../src/workflow/gc'
import { writeManifest } from '../../src/workflow/manifest'

function setupRun(root: string, runId: string, startedAt: string): string {
  const runDir = join(root, runId)
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({ id: runId, startedAt }, null, 2) + '\n')
  return runDir
}

describe('workflow GC', () => {
  let home = ''
  const now = new Date('2026-04-26T00:00:00.000Z')

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'flt-workflow-gc-'))
    process.env.HOME = home
    mkdirSync(join(home, '.flt', 'runs'), { recursive: true })
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('classifyTier categorizes hot, warm, and cold by age', () => {
    expect(classifyTier('2026-04-25T00:00:00.000Z', now)).toBe('hot')
    expect(classifyTier('2026-04-16T00:00:00.000Z', now)).toBe('warm')
    expect(classifyTier('2026-02-25T00:00:00.000Z', now)).toBe('cold')
  })

  it('gcRun on hot tier takes no action', () => {
    const runDir = setupRun(join(home, '.flt', 'runs'), 'hot-run', '2026-04-25T00:00:00.000Z')
    writeFileSync(join(runDir, 'foo.txt'), 'hello\n')

    const result = gcRun(runDir, { now })

    expect(result.tier).toBe('hot')
    expect(result.actions).toEqual([])
    expect(existsSync(join(runDir, 'foo.txt'))).toBe(true)
  })

  it('gcRun on warm tier archives logs + diff artifacts and deletes non-durable scratch', () => {
    const runDir = setupRun(join(home, '.flt', 'runs'), 'warm-run', '2026-04-01T00:00:00.000Z')
    mkdirSync(join(runDir, 'logs'), { recursive: true })
    mkdirSync(join(runDir, 'scratch'), { recursive: true })
    mkdirSync(join(runDir, 'results'), { recursive: true })

    writeFileSync(join(runDir, 'logs', 'foo.log'), 'log\n')
    writeFileSync(join(runDir, 'scratch', 'bar.md'), 'scratch\n')
    writeFileSync(join(runDir, 'results', 'coder-_.json'), '{"ok":true}\n')

    writeManifest(runDir, {
      artifacts: [
        {
          path: 'scratch/bar.md',
          type: 'scratch',
          owner_agent: 'coder',
          status: 'active',
          keep: false,
        },
        {
          path: 'results/coder-_.json',
          type: 'diff',
          owner_agent: 'coder',
          status: 'active',
          keep: false,
        },
      ],
    })

    const result = gcRun(runDir, { now })

    expect(result.tier).toBe('warm')
    expect(existsSync(join(runDir, 'run-archive.tar.gz'))).toBe(true)
    expect(existsSync(join(runDir, 'logs', 'foo.log'))).toBe(false)
    expect(existsSync(join(runDir, 'scratch', 'bar.md'))).toBe(false)
    expect(existsSync(join(runDir, 'results', 'coder-_.json'))).toBe(true)
  })

  it('gcRun on cold tier archives run and keeps only permanent set', () => {
    const runId = 'cold-run'
    const runDir = setupRun(join(home, '.flt', 'runs'), runId, '2026-02-01T00:00:00.000Z')

    writeFileSync(join(runDir, 'run_summary.md'), 'summary\n')
    writeFileSync(join(runDir, 'final.diff'), 'diff\n')
    writeFileSync(join(runDir, 'blocker_report.json'), '{"blocked":true}\n')
    writeFileSync(join(runDir, 'temp.txt'), 'remove me\n')
    mkdirSync(join(runDir, 'scratch'), { recursive: true })
    writeFileSync(join(runDir, 'scratch', 'notes.md'), 'notes\n')
    writeManifest(runDir, {
      artifacts: [
        {
          path: 'scratch/keep.md',
          type: 'scratch',
          owner_agent: 'coder',
          status: 'active',
          keep: true,
        },
      ],
    })
    writeFileSync(join(runDir, 'scratch', 'keep.md'), 'keep\n')

    const result = gcRun(runDir, { now })

    expect(result.tier).toBe('cold')
    expect(existsSync(join(home, '.flt', 'runs', `${runId}-archive.tar.gz`))).toBe(true)

    const remaining = new Set(readdirSync(runDir))
    expect(remaining.has('manifest.json')).toBe(true)
    expect(remaining.has('run_summary.md')).toBe(true)
    expect(remaining.has('final.diff')).toBe(true)
    expect(remaining.has('blocker_report.json')).toBe(true)
    expect(existsSync(join(runDir, 'scratch', 'keep.md'))).toBe(true)
    expect(remaining.has('temp.txt')).toBe(false)
    expect(existsSync(join(runDir, 'scratch', 'notes.md'))).toBe(false)
  })

  it('gcAllRuns olderThan filters eligible runs', () => {
    setupRun(join(home, '.flt', 'runs'), 'run-1d', '2026-04-25T00:00:00.000Z')
    setupRun(join(home, '.flt', 'runs'), 'run-10d', '2026-04-16T00:00:00.000Z')
    setupRun(join(home, '.flt', 'runs'), 'run-60d', '2026-02-25T00:00:00.000Z')

    const results = gcAllRuns({ now, olderThan: '7d' })

    const ids = results.map((r) => r.runId).sort()
    expect(ids).toEqual(['run-10d', 'run-60d'])
  })

  it('keep=true artifacts are never deleted in warm tier', () => {
    const runDir = setupRun(join(home, '.flt', 'runs'), 'warm-keep-run', '2026-04-01T00:00:00.000Z')
    mkdirSync(join(runDir, 'scratch'), { recursive: true })
    writeFileSync(join(runDir, 'scratch', 'keep.md'), 'keep\n')

    writeManifest(runDir, {
      artifacts: [
        {
          path: 'scratch/keep.md',
          type: 'scratch',
          owner_agent: 'coder',
          status: 'active',
          keep: true,
        },
      ],
    })

    const result = gcRun(runDir, { now })

    expect(result.tier).toBe('warm')
    expect(existsSync(join(runDir, 'scratch', 'keep.md'))).toBe(true)
  })
})
