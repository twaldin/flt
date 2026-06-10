/**
 * Regression test for Plan 004, Fix 1: retire non-pending dag nodes removed by plan re-read.
 *
 * Bug: reconcileDagPlanFromDisk only deleted nodes with status === 'pending'.
 * A node that was 'running' but removed from plan.json stayed in state forever,
 * blocking its dependents and the all-done check.
 *
 * Fix: nodes with any non-terminal status (running/reviewing) that are absent
 * from the rewritten plan should be retired to 'skipped' (with a kill attempt
 * and an activity event).
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  _setDagSpawnBackoffsForTest,
  _setSpawnFnForTest,
  advanceWorkflow,
  loadWorkflowRun,
  saveWorkflowRun,
} from '../../src/workflow/engine'
import type { WorkflowRun } from '../../src/workflow/types'

function seedPresets(home: string): void {
  mkdirSync(join(home, '.flt'), { recursive: true })
  writeFileSync(
    join(home, '.flt', 'presets.json'),
    JSON.stringify({
      default: { cli: 'pi', model: 'gpt-5' },
      'pi-coder': { cli: 'pi', model: 'gpt-5' },
      'cc-evaluator': { cli: 'claude-code', model: 'sonnet' },
    }),
  )
}

function writeWorkflow(home: string, name: string, yaml: string): void {
  const dir = join(home, '.flt', 'workflows')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.yaml`), yaml)
}

describe('reconcileDagPlanFromDisk: orphan retirement', () => {
  let home = ''
  let previousHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'flt-dag-orphan-'))
    previousHome = process.env.HOME
    process.env.HOME = home

    seedPresets(home)
    writeWorkflow(
      home,
      'tiny-dag',
      `
name: tiny-dag
steps:
  - id: plan
    preset: pi-coder
    task: produce plan.json
    on_complete: execute
    on_fail: abort
  - id: execute
    type: dynamic_dag
    plan_from: '{steps.plan.worktree}/plan.json'
    reconciler:
      preset: cc-evaluator
      task: merge
    on_complete: done
    on_fail: abort
`,
    )

    _setDagSpawnBackoffsForTest([0])
  })

  afterEach(() => {
    _setSpawnFnForTest(null)
    _setDagSpawnBackoffsForTest(null)
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  })

  it('retires a running node removed from plan.json to skipped, not leaves it running', async () => {
    const planWorktree = join(home, 'plan-worktree')
    mkdirSync(planWorktree, { recursive: true })

    // plan.json only contains node 'a' — node 'b' has been removed by planner rewrite
    const planJson = {
      nodes: [
        { id: 'a', task: 'do a', depends_on: [] },
      ],
    }
    writeFileSync(join(planWorktree, 'plan.json'), JSON.stringify(planJson))

    const runDir = join(home, '.flt', 'runs', 'orphan-test')
    mkdirSync(join(runDir, 'results'), { recursive: true })
    mkdirSync(join(runDir, 'handoffs'), { recursive: true })

    const integrationWorktree = join(home, 'integration')
    mkdirSync(integrationWorktree, { recursive: true })

    const run: WorkflowRun = {
      id: 'orphan-test',
      workflow: 'tiny-dag',
      currentStep: 'execute',
      status: 'running',
      parentName: 'human',
      history: [{ step: 'plan', result: 'completed', at: new Date().toISOString() }],
      retries: {},
      vars: {
        _input: { task: 't', dir: home },
        plan: { worktree: planWorktree },
      },
      startedAt: new Date().toISOString(),
      runDir,
      dynamicDagGroups: {
        execute: {
          nodes: {
            a: {
              id: 'a',
              task: 'do a',
              dependsOn: [],
              preset: 'pi-coder',
              parallel: 1,
              retries: 0,
              status: 'pending',
            },
            b: {
              id: 'b',
              task: 'do b',
              dependsOn: [],
              preset: 'pi-coder',
              parallel: 1,
              retries: 0,
              status: 'running', // ← orphan: running but removed from plan.json
              coderAgent: 'orphan-test-execute-b-coder',
            },
          },
          topoOrder: ['a', 'b'],
          integrationBranch: 'flt/integration',
          integrationWorktree,
          skipped: [],
        },
      },
    }
    saveWorkflowRun(run)

    // Spawn fn succeeds for node 'a' — we just care about what happens to 'b'
    _setSpawnFnForTest(async (_opts) => {
      // no-op: let the node spawn succeed without creating a real agent
    })

    await advanceWorkflow('orphan-test')

    const after = loadWorkflowRun('orphan-test')
    expect(after).toBeTruthy()

    // The orphaned 'running' node 'b' must be retired — not still 'running'
    const nodeB = after!.dynamicDagGroups?.execute?.nodes?.b
    expect(nodeB).toBeDefined()
    expect(nodeB!.status).not.toBe('running')
    expect(['skipped', 'failed', 'cancelled']).toContain(nodeB!.status)

    // An activity event must have been appended for the retirement
    const activityLog = join(home, '.flt', 'activity.log')
    expect(existsSync(activityLog)).toBe(true)
    const events = readFileSync(activityLog, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as { type: string; detail: string })
    const retireEvent = events.find(e => e.detail.includes('b') && e.detail.toLowerCase().includes('retire'))
    expect(retireEvent).toBeDefined()
  })

  it('leaves passed and skipped nodes alone during reconcile', async () => {
    const planWorktree = join(home, 'plan-worktree2')
    mkdirSync(planWorktree, { recursive: true })

    // plan.json only contains node 'a'
    const planJson = {
      nodes: [
        { id: 'a', task: 'do a', depends_on: [] },
      ],
    }
    writeFileSync(join(planWorktree, 'plan.json'), JSON.stringify(planJson))

    const runDir = join(home, '.flt', 'runs', 'terminal-unchanged')
    mkdirSync(join(runDir, 'results'), { recursive: true })
    mkdirSync(join(runDir, 'handoffs'), { recursive: true })

    const integrationWorktree = join(home, 'integration2')
    mkdirSync(integrationWorktree, { recursive: true })

    const run: WorkflowRun = {
      id: 'terminal-unchanged',
      workflow: 'tiny-dag',
      currentStep: 'execute',
      status: 'running',
      parentName: 'human',
      history: [{ step: 'plan', result: 'completed', at: new Date().toISOString() }],
      retries: {},
      vars: {
        _input: { task: 't', dir: home },
        plan: { worktree: planWorktree },
      },
      startedAt: new Date().toISOString(),
      runDir,
      dynamicDagGroups: {
        execute: {
          nodes: {
            a: {
              id: 'a',
              task: 'do a',
              dependsOn: [],
              preset: 'pi-coder',
              parallel: 1,
              retries: 0,
              status: 'pending',
            },
            b: {
              id: 'b',
              task: 'do b',
              dependsOn: [],
              preset: 'pi-coder',
              parallel: 1,
              retries: 0,
              status: 'passed', // ← already terminal — must not be touched
            },
          },
          topoOrder: ['a', 'b'],
          integrationBranch: 'flt/integration',
          integrationWorktree,
          skipped: [],
        },
      },
    }
    saveWorkflowRun(run)

    _setSpawnFnForTest(async (_opts) => {
      // no-op
    })

    await advanceWorkflow('terminal-unchanged')

    const after = loadWorkflowRun('terminal-unchanged')
    const nodeB = after!.dynamicDagGroups?.execute?.nodes?.b
    // 'passed' is terminal and should remain — reconcile must not change it
    expect(nodeB!.status).toBe('passed')
  })
})
