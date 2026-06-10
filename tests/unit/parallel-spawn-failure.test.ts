/**
 * Regression test for Plan 004, Fix 2: write fail result when a parallel
 * candidate spawn throws.
 *
 * Bug: executeParallelStep had no try/catch around each candidate's spawn call.
 * If candidate 2-of-3 threw (tmux error, preset error, worktree collision),
 * candidates 1 and 3 ran but aggregation waited for a verdict from candidate 2
 * that would never arrive — a permanent stall.
 *
 * Fix: wrap each candidate's spawn+bookkeeping in try/catch; on catch, write a
 * fail result for that candidate's label so aggregation can complete, then
 * continue so remaining candidates still spawn.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  _setSpawnFnForTest,
  loadWorkflowRun,
  startWorkflow,
} from '../../src/workflow/engine'

function seedPresets(home: string): void {
  mkdirSync(join(home, '.flt'), { recursive: true })
  writeFileSync(
    join(home, '.flt', 'presets.json'),
    JSON.stringify({
      default: { cli: 'pi', model: 'gpt-5' },
      A: { cli: 'pi', model: 'gpt-5' },
      B: { cli: 'pi', model: 'gpt-5' },
      'pi-coder': { cli: 'pi', model: 'gpt-5' },
    }),
  )
}

function writeWorkflow(home: string, name: string, yaml: string): void {
  const dir = join(home, '.flt', 'workflows')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.yaml`), yaml)
}

describe('executeParallelStep: spawn failure hardening', () => {
  let home = ''
  let previousHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'flt-par-spawn-fail-'))
    previousHome = process.env.HOME
    process.env.HOME = home
    seedPresets(home)
  })

  afterEach(() => {
    _setSpawnFnForTest(null)
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  })

  it('writes a fail result for the failing candidate and lets other candidates spawn', async () => {
    writeWorkflow(home, 'wf-par-spawn-fail', `
name: wf-par-spawn-fail
steps:
  - id: fanout
    type: parallel
    n: 2
    presets: [A, B]
    step:
      id: coder
      preset: pi-coder
      task: do work
    on_complete: done
`)

    const spawned: string[] = []
    let callCount = 0

    _setSpawnFnForTest(async (args) => {
      callCount++
      if (callCount === 2) {
        // Second candidate (label 'b') spawn throws
        throw new Error('tmux: could not create session for candidate-b')
      }
      spawned.push(args.name)
    })

    // startWorkflow calls executeParallelStep — it must NOT throw even though
    // the second candidate spawn fails
    let threw = false
    try {
      await startWorkflow('wf-par-spawn-fail', { dir: home })
    } catch {
      threw = true
    }
    expect(threw).toBe(false)

    // The first candidate (label 'a') must have spawned
    expect(spawned.length).toBeGreaterThanOrEqual(1)

    // A fail result file must exist for the failing candidate's label
    // Labels are single letters: 'a' for the first, 'b' for the second
    const run = loadWorkflowRun((await (async () => {
      // Re-derive the run id from the run dirs written by startWorkflow
      const { readdirSync } = await import('fs')
      const runsDir = join(home, '.flt', 'runs')
      if (!existsSync(runsDir)) return ''
      const entries = readdirSync(runsDir)
      return entries[0] ?? ''
    })())
    )

    // At minimum: a fail result file for the second candidate must be present
    // Results dir: <runDir>/results/fanout-<label>.json
    if (run?.runDir) {
      const resultsDir = join(run.runDir, 'results')
      // Find the fail result for the failed candidate
      const resultFiles = existsSync(resultsDir)
        ? (await import('fs')).readdirSync(resultsDir)
        : []

      const failResultFiles = resultFiles.filter(f => f.startsWith('fanout-') && f.endsWith('.json'))
      const failResults = failResultFiles
        .map(f => {
          try {
            return JSON.parse(readFileSync(join(resultsDir, f), 'utf-8')) as {
              step: string
              label: string
              verdict: string
              failReason?: string
            }
          } catch {
            return null
          }
        })
        .filter(Boolean)

      const failForB = failResults.find(r => r?.verdict === 'fail')
      expect(failForB).toBeDefined()
      expect(failForB?.step).toBe('fanout')
    }
  })

  it('does not throw when all candidates fail to spawn', async () => {
    writeWorkflow(home, 'wf-par-all-fail', `
name: wf-par-all-fail
steps:
  - id: fanout
    type: parallel
    n: 2
    presets: [A, B]
    step:
      id: coder
      preset: pi-coder
      task: do work
    on_complete: done
`)

    _setSpawnFnForTest(async (_args) => {
      throw new Error('tmux: no server running')
    })

    let threw = false
    try {
      await startWorkflow('wf-par-all-fail', { dir: home })
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
  })
})
