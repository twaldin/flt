import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  _setSpawnFnForTest,
  advanceWorkflow,
  loadWorkflowRun,
  saveWorkflowRun,
  startWorkflow,
} from '../../src/workflow/engine'
import { writeResult } from '../../src/workflow/results'
import { loadState, saveState } from '../../src/state'
import type { WorkflowRun } from '../../src/workflow/types'

function seedPresets(home: string): void {
  mkdirSync(join(home, '.flt'), { recursive: true })
  writeFileSync(join(home, '.flt', 'presets.json'), JSON.stringify({
    'pi-coder': { cli: 'pi', model: 'gpt-5' },
    A: { cli: 'pi', model: 'gpt-5' },
    B: { cli: 'pi', model: 'gpt-5' },
  }))
}

function writeWorkflow(home: string, name: string, yaml: string): void {
  const dir = join(home, '.flt', 'workflows')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.yaml`), yaml)
}

function makeRun(home: string, id: string, workflow: string, currentStep: string): WorkflowRun {
  return {
    id,
    workflow,
    currentStep,
    status: 'running',
    parentName: 'human',
    history: [],
    retries: {},
    vars: { _input: { task: 'task', dir: home } },
    startedAt: new Date().toISOString(),
    runDir: join(home, '.flt', 'runs', id),
  }
}

describe('per-step timeout', () => {
  let home = ''
  let previousHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'flt-step-timeout-'))
    previousHome = process.env.HOME
    process.env.HOME = home
    seedPresets(home)
  })

  afterEach(() => {
    _setSpawnFnForTest(null)
    process.env.HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  })

  it('parallel step fails with timeout when startedAt is past timeout_seconds', async () => {
    writeWorkflow(home, 'timeout-wf', `
name: timeout-wf
steps:
  - id: mutate
    type: parallel
    n: 2
    timeout_seconds: 1800
    step:
      id: mutate-child
      preset: pi-coder
      dir: ${home}
      worktree: false
      task: do work
    on_complete: done
    on_fail: abort
`)

    _setSpawnFnForTest(async args => {
      const state = loadState()
      state.agents[args.name] = {
        cli: 'pi', model: 'gpt-5', tmuxSession: `flt-${args.name}`,
        parentName: 'human', dir: args.dir ?? home,
        worktreePath: args.dir ?? home, worktreeBranch: `flt/${args.name}`,
        spawnedAt: new Date().toISOString(),
      }
      saveState(state)
    })

    const run = await startWorkflow('timeout-wf', { dir: home })

    // Backdate startedAt to simulate timeout exceeded (1800s + 1s ago)
    const group = run.parallelGroups?.['mutate']
    if (group) {
      group.startedAt = new Date(Date.now() - 1_801_000).toISOString()
    }
    saveWorkflowRun(run)

    await advanceWorkflow(run.id)

    const after = loadWorkflowRun(run.id)
    // Step should be marked failed or have a timeout result
    const resultsDir = join(run.runDir!, 'results')
    const { existsSync, readFileSync } = await import('fs')
    const resultFile = join(resultsDir, 'mutate-_.json')
    if (existsSync(resultFile)) {
      const result = JSON.parse(readFileSync(resultFile, 'utf-8')) as { verdict: string; failReason?: string }
      expect(result.verdict).toBe('fail')
      expect(result.failReason).toMatch(/timeout/)
    } else {
      // Timeout causes the run to be cancelled/failed directly
      expect(['failed', 'cancelled']).toContain(after?.status)
    }
  })

  it('parallel step does NOT timeout when within timeout_seconds', async () => {
    writeWorkflow(home, 'no-timeout-wf', `
name: no-timeout-wf
steps:
  - id: mutate
    type: parallel
    n: 2
    timeout_seconds: 1800
    step:
      id: mutate-child
      preset: pi-coder
      dir: ${home}
      worktree: false
      task: do work
    on_complete: done
    on_fail: abort
`)

    _setSpawnFnForTest(async args => {
      const state = loadState()
      state.agents[args.name] = {
        cli: 'pi', model: 'gpt-5', tmuxSession: `flt-${args.name}`,
        parentName: 'human', dir: args.dir ?? home,
        worktreePath: args.dir ?? home, worktreeBranch: `flt/${args.name}`,
        spawnedAt: new Date().toISOString(),
      }
      saveState(state)
    })

    const run = await startWorkflow('no-timeout-wf', { dir: home })

    // startedAt is recent — should NOT timeout
    await advanceWorkflow(run.id)

    const after = loadWorkflowRun(run.id)
    // Still running — no verdicts written yet
    expect(after?.status).toBe('running')
  })

  it('types.ts accepts timeout_seconds on parallel step', () => {
    // Type-level test: compile-time check via explicit type usage
    const step: import('../../src/workflow/types').ParallelStep = {
      type: 'parallel',
      id: 'test',
      n: 2,
      step: { id: 'child', preset: 'pi-coder', task: 'x' },
      timeout_seconds: 600,
    }
    expect(step.timeout_seconds).toBe(600)
  })
})
