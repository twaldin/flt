import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { listWorkflowRuns, loadWorkflowRun, saveWorkflowRun, _setSpawnFnForTest } from '../../src/workflow/engine'
import type { WorkflowRun } from '../../src/workflow/types'
import { workflowApprove, workflowReject, workflowRun } from '../../src/commands/workflow'

function seedPresets(home: string): void {
  mkdirSync(join(home, '.flt'), { recursive: true })
  writeFileSync(
    join(home, '.flt', 'presets.json'),
    JSON.stringify({
      default: { cli: 'pi', model: 'gpt-5' },
      'pi-coder': { cli: 'pi', model: 'gpt-5' },
    }),
  )
}

function writeWorkflow(home: string, name: string, yaml: string): void {
  const workflowsDir = join(home, '.flt', 'workflows')
  mkdirSync(workflowsDir, { recursive: true })
  writeFileSync(join(workflowsDir, `${name}.yaml`), yaml)
}

function makeRun(home: string, id: string, currentStep = 'gate'): WorkflowRun {
  const runDir = join(home, '.flt', 'runs', id)
  mkdirSync(join(runDir, 'results'), { recursive: true })
  mkdirSync(join(runDir, 'handoffs'), { recursive: true })
  return {
    id,
    workflow: 'gated',
    currentStep,
    status: 'running',
    parentName: 'human',
    history: [],
    retries: {},
    vars: {
      _input: {
        task: 'task',
        dir: home,
      },
    },
    startedAt: new Date().toISOString(),
    runDir,
  }
}

describe('workflow approve/reject commands', () => {
  let home = ''
  let previousHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'flt-workflow-approve-reject-'))
    previousHome = process.env.HOME
    process.env.HOME = home

    seedPresets(home)
    writeWorkflow(home, 'gated', `
name: gated
steps:
  - id: gate
    type: human_gate
    on_complete: after
  - id: after
    preset: pi-coder
    task: noop
`)

    _setSpawnFnForTest(async () => {})
  })

  afterEach(() => {
    _setSpawnFnForTest(null)
    if (previousHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = previousHome
    }
    rmSync(home, { recursive: true, force: true })
  })

  it('approve writes approved decision and advances', async () => {
    const run = makeRun(home, 'gated')
    saveWorkflowRun(run)

    await workflowApprove('gated')

    const loaded = loadWorkflowRun('gated')
    const resultPath = join(run.runDir!, 'results', 'gate-_.json')
    expect(existsSync(resultPath)).toBe(true)
    const result = JSON.parse(readFileSync(resultPath, 'utf-8')) as { verdict: string }
    expect(result.verdict).toBe('pass')
    expect(loaded?.currentStep === 'after' || loaded?.status === 'completed').toBe(true)
    expect(existsSync(join(run.runDir!, '.gate-decision'))).toBe(false)
  })

  it('approve with candidate advances', async () => {
    const run = makeRun(home, 'gated')
    saveWorkflowRun(run)

    await workflowApprove('gated', { candidate: 'b' })

    const loaded = loadWorkflowRun('gated')
    expect(loaded?.currentStep === 'after' || loaded?.status === 'completed').toBe(true)
  })

  it('approve fails when run status is not running', async () => {
    const run = makeRun(home, 'gated')
    run.status = 'completed'
    saveWorkflowRun(run)

    await expect(workflowApprove('gated')).rejects.toThrow('is not running')
  })

  it('approve fails when run does not exist', async () => {
    await expect(workflowApprove('missing')).rejects.toThrow('No workflow run found')
  })

  it('approve fails when current step is not human_gate', async () => {
    const run = makeRun(home, 'gated', 'after')
    saveWorkflowRun(run)

    await expect(workflowApprove('gated')).rejects.toThrow('is not a human_gate')
  })

  it('reject writes rejected decision and records failed gate result', async () => {
    const run = makeRun(home, 'gated')
    saveWorkflowRun(run)

    await workflowReject('gated', 'nope')

    const loaded = loadWorkflowRun('gated')
    const resultPath = join(run.runDir!, 'results', 'gate-_.json')
    expect(existsSync(resultPath)).toBe(true)
    const result = JSON.parse(readFileSync(resultPath, 'utf-8')) as { verdict: string; failReason?: string }
    expect(result.verdict).toBe('fail')
    expect(result.failReason).toBe('nope')
    expect(loaded?.history.some(h => h.step === 'gate' && h.result === 'failed')).toBe(true)
  })

  it('reject without reason throws', async () => {
    const run = makeRun(home, 'gated')
    saveWorkflowRun(run)

    await expect(workflowReject('gated', '')).rejects.toThrow('requires --reason')
  })

  it('workflow run supports n > 1', async () => {
    writeWorkflow(home, 'basic', `
name: basic
steps:
  - id: run
    run: true
`)

    await workflowRun('basic', { n: 3 })

    const runs = listWorkflowRuns().filter(r => r.workflow === 'basic')
    expect(runs.length).toBe(3)
    expect(new Set(runs.map(r => r.id)).size).toBe(3)
  })
})
