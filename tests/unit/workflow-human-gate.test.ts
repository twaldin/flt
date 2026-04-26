import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { setAgent } from '../../src/state'
import {
  _setSpawnFnForTest,
  advanceWorkflow,
  loadWorkflowRun,
  startWorkflow,
  workflowAgentName,
} from '../../src/workflow/engine'

type GatePending = {
  step: string
  notify?: string
  at: string
}

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

describe('workflow human_gate step executor', () => {
  let home = ''
  let previousHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'flt-workflow-human-gate-'))
    previousHome = process.env.HOME
    process.env.HOME = home
    seedPresets(home)
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

  it('human_gate writes .gate-pending and does not advance', async () => {
    writeWorkflow(home, 'wf-gate-pending', `
name: wf-gate-pending
steps:
  - id: gate
    type: human_gate
    notify: check this
`)

    const run = await startWorkflow('wf-gate-pending', { dir: home })
    const pendingPath = join(run.runDir!, '.gate-pending')

    expect(existsSync(pendingPath)).toBe(true)
    expect(loadWorkflowRun(run.id)?.currentStep).toBe('gate')
    expect(existsSync(join(run.runDir!, 'results', 'gate-_.json'))).toBe(false)

    const pending = JSON.parse(readFileSync(pendingPath, 'utf-8')) as GatePending
    expect(pending.step).toBe('gate')
    expect(pending.notify).toBe('check this')
    expect(pending.at).toBeTruthy()
  })

  it('approved gate decision writes pass and advances', async () => {
    const spawns: string[] = []
    _setSpawnFnForTest(async args => {
      spawns.push(args.name)
      setAgent(args.name, {
        cli: 'pi',
        model: 'gpt-5',
        tmuxSession: `flt-${args.name}`,
        parentName: args.parent ?? 'human',
        dir: args.dir ?? home,
        worktreePath: args.dir ?? home,
        worktreeBranch: `flt/${args.name}`,
        spawnedAt: new Date().toISOString(),
      })
    })

    writeWorkflow(home, 'wf-gate-approve', `
name: wf-gate-approve
steps:
  - id: gate
    type: human_gate
    on_complete: next
  - id: next
    preset: pi-coder
    task: continue
`)

    const run = await startWorkflow('wf-gate-approve', { dir: home })
    writeFileSync(join(run.runDir!, '.gate-decision'), JSON.stringify({ approved: true }))

    await advanceWorkflow(run.id)

    const loaded = loadWorkflowRun(run.id)
    expect(existsSync(join(run.runDir!, '.gate-decision'))).toBe(false)
    expect(existsSync(join(run.runDir!, '.gate-pending'))).toBe(false)
    const result = JSON.parse(readFileSync(join(run.runDir!, 'results', 'gate-_.json'), 'utf-8')) as { verdict: string }
    expect(result.verdict).toBe('pass')
    expect(loaded?.currentStep).toBe('next')
    expect(spawns).toContain(workflowAgentName(run.id, 'next'))
  })

  it('rejected gate decision writes fail and follows on_fail', async () => {
    const spawns: string[] = []
    _setSpawnFnForTest(async args => {
      spawns.push(args.name)
      setAgent(args.name, {
        cli: 'pi',
        model: 'gpt-5',
        tmuxSession: `flt-${args.name}`,
        parentName: args.parent ?? 'human',
        dir: args.dir ?? home,
        worktreePath: args.dir ?? home,
        worktreeBranch: `flt/${args.name}`,
        spawnedAt: new Date().toISOString(),
      })
    })

    writeWorkflow(home, 'wf-gate-reject', `
name: wf-gate-reject
steps:
  - id: gate
    type: human_gate
    on_fail: recovery
  - id: recovery
    preset: pi-coder
    task: recover
`)

    const run = await startWorkflow('wf-gate-reject', { dir: home })
    writeFileSync(join(run.runDir!, '.gate-decision'), JSON.stringify({ approved: false, reason: 'nope' }))

    await advanceWorkflow(run.id)

    const loaded = loadWorkflowRun(run.id)
    const result = JSON.parse(readFileSync(join(run.runDir!, 'results', 'gate-_.json'), 'utf-8')) as { verdict: string; failReason?: string }
    expect(result.verdict).toBe('fail')
    expect(result.failReason).toBe('nope')
    expect(loaded?.currentStep).toBe('recovery')
    expect(spawns).toContain(workflowAgentName(run.id, 'recovery'))
  })

  it('invalid gate decision json does not advance', async () => {
    writeWorkflow(home, 'wf-gate-invalid', `
name: wf-gate-invalid
steps:
  - id: gate
    type: human_gate
`)

    const run = await startWorkflow('wf-gate-invalid', { dir: home })
    writeFileSync(join(run.runDir!, '.gate-decision'), 'not json')

    await advanceWorkflow(run.id)

    const loaded = loadWorkflowRun(run.id)
    expect(loaded?.currentStep).toBe('gate')
    expect(loaded?.status).toBe('running')
    expect(existsSync(join(run.runDir!, 'results', 'gate-_.json'))).toBe(false)
  })
})
