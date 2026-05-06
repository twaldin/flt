import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  advanceWorkflow,
  loadWorkflowRun,
  saveWorkflowRun,
  _setSpawnFnForTest,
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

describe('maybeRunFinalReconcile stale pendingGateNode self-heal', () => {
  let home = ''
  let previousHome: string | undefined
  const spawned: string[] = []

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'flt-stale-gate-node-'))
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

    spawned.length = 0
    _setSpawnFnForTest(async (opts) => {
      spawned.push(opts.name)
    })
  })

  afterEach(() => {
    _setSpawnFnForTest(null)
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  })

  it('sweeps pendingGateNode when target node is no longer failed and fires reconciler', async () => {
    // Hand-craft a run that simulates the operator hand-resolved a node-fail:
    // - node "n1" was failed, gate was opened, operator wrote run.json setting
    //   status=passed, deleted .gate-pending, BUT pendingGateNode field
    //   stayed stale on the dag state.
    // Pre-fix: maybeRunFinalReconcile early-returns on pendingGateNode and
    // never spawns reconciler. Post-fix: it sweeps the stale field and
    // proceeds to spawn reconciler.
    const runDir = join(home, '.flt', 'runs', 'stale')
    mkdirSync(join(runDir, 'results'), { recursive: true })
    mkdirSync(join(runDir, 'handoffs'), { recursive: true })

    const run: WorkflowRun = {
      id: 'stale',
      workflow: 'tiny-dag',
      currentStep: 'execute',
      status: 'running',
      parentName: 'human',
      history: [{ step: 'plan', result: 'completed', at: new Date().toISOString() }],
      retries: {},
      vars: { _input: { task: 't', dir: home }, plan: { worktree: '/tmp/notused' } },
      startedAt: new Date().toISOString(),
      runDir,
      dynamicDagGroups: {
        execute: {
          nodes: {
            n1: {
              id: 'n1',
              task: 't',
              dependsOn: [],
              preset: 'pi-coder',
              parallel: 1,
              retries: 0,
              status: 'passed',
              branch: 'flt/n1',
            },
          },
          topoOrder: ['n1'],
          integrationBranch: 'flt/integration',
          integrationWorktree: join(home, 'integration'),
          skipped: [],
          pendingGateNode: 'n1', // ← STALE: points at a now-passed node
        },
      },
    }
    mkdirSync(run.dynamicDagGroups!.execute.integrationWorktree!, { recursive: true })
    saveWorkflowRun(run)

    await advanceWorkflow('stale')

    const after = loadWorkflowRun('stale')
    expect(after).toBeTruthy()
    expect(after!.dynamicDagGroups?.execute?.pendingGateNode).toBeUndefined()
    expect(spawned.some(name => name.includes('reconcile'))).toBe(true)
  })

  it('preserves pendingGateNode when target node is still failed', async () => {
    // Negative case: if the node referenced by pendingGateNode is genuinely
    // still failed (operator hasn't resolved it yet), the field must stay
    // and reconciler must NOT fire.
    const runDir = join(home, '.flt', 'runs', 'unresolved')
    mkdirSync(join(runDir, 'results'), { recursive: true })
    mkdirSync(join(runDir, 'handoffs'), { recursive: true })

    const run: WorkflowRun = {
      id: 'unresolved',
      workflow: 'tiny-dag',
      currentStep: 'execute',
      status: 'running',
      parentName: 'human',
      history: [{ step: 'plan', result: 'completed', at: new Date().toISOString() }],
      retries: {},
      vars: { _input: { task: 't', dir: home }, plan: { worktree: '/tmp/notused' } },
      startedAt: new Date().toISOString(),
      runDir,
      dynamicDagGroups: {
        execute: {
          nodes: {
            n1: {
              id: 'n1',
              task: 't',
              dependsOn: [],
              preset: 'pi-coder',
              parallel: 1,
              retries: 2,
              status: 'failed',
              branch: 'flt/n1',
            },
          },
          topoOrder: ['n1'],
          integrationBranch: 'flt/integration',
          integrationWorktree: join(home, 'integration'),
          skipped: [],
          pendingGateNode: 'n1',
        },
      },
    }
    mkdirSync(run.dynamicDagGroups!.execute.integrationWorktree!, { recursive: true })
    saveWorkflowRun(run)

    await advanceWorkflow('unresolved')

    const after = loadWorkflowRun('unresolved')
    expect(after!.dynamicDagGroups?.execute?.pendingGateNode).toBe('n1')
    expect(spawned.some(name => name.includes('reconcile'))).toBe(false)
  })
})
