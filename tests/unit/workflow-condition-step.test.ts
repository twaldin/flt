import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
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
import { writeResult } from '../../src/workflow/results'

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

describe('workflow condition step executor', () => {
  let home = ''
  let previousHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'flt-workflow-condition-step-'))
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

  it('condition true jumps to then step', async () => {
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

    writeWorkflow(home, 'wf-cond-true', `
name: wf-cond-true
steps:
  - id: coder
    preset: pi-coder
    task: code
    on_complete: route
  - id: route
    type: condition
    if: '{steps.coder.verdict} == "pass"'
    then: success
    else: failure
  - id: success
    preset: pi-coder
    task: success
  - id: failure
    preset: pi-coder
    task: failure
`)

    const run = await startWorkflow('wf-cond-true', { dir: home })
    writeResult(run.runDir!, 'coder', '_', 'pass')
    await advanceWorkflow(run.id)

    const loaded = loadWorkflowRun(run.id)
    expect(loaded?.currentStep).toBe('success')
    expect(spawns).toContain(workflowAgentName(run.id, 'success'))
    expect(spawns).not.toContain(workflowAgentName(run.id, 'failure'))
  })

  it('condition false jumps to else step', async () => {
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

    writeWorkflow(home, 'wf-cond-false', `
name: wf-cond-false
steps:
  - id: coder
    preset: pi-coder
    task: code
    on_complete: route
    on_fail: route
  - id: route
    type: condition
    if: '{steps.coder.verdict} == "pass"'
    then: success
    else: failure
  - id: success
    preset: pi-coder
    task: success
  - id: failure
    preset: pi-coder
    task: failure
`)

    const run = await startWorkflow('wf-cond-false', { dir: home })
    writeResult(run.runDir!, 'coder', '_', 'fail', 'bad')
    await advanceWorkflow(run.id)

    const loaded = loadWorkflowRun(run.id)
    expect(loaded?.currentStep).toBe('failure')
    expect(spawns).toContain(workflowAgentName(run.id, 'failure'))
    expect(spawns).not.toContain(workflowAgentName(run.id, 'success'))
  })

  it('condition without else falls back to on_complete or done', async () => {
    writeWorkflow(home, 'wf-cond-fallback', `
name: wf-cond-fallback
steps:
  - id: route
    type: condition
    if: '{task} == "nope"'
    then: next
  - id: next
    preset: pi-coder
    task: next
`)

    const run = await startWorkflow('wf-cond-fallback', { dir: home, task: 'task' })
    const loaded = loadWorkflowRun(run.id)
    expect(loaded?.status).toBe('completed')
    expect(loaded?.completedAt).toBeDefined()
  })

  it('malformed condition expression fails condition step with reason', async () => {
    writeWorkflow(home, 'wf-cond-bad-expr', `
name: wf-cond-bad-expr
steps:
  - id: route
    type: condition
    if: badbad
    then: next
  - id: next
    preset: pi-coder
    task: next
`)

    const run = await startWorkflow('wf-cond-bad-expr', { dir: home })

    const loaded = loadWorkflowRun(run.id)
    expect(loaded?.status).toBe('failed')
    expect(loaded?.stepFailReason).toContain('condition:')
    const result = JSON.parse(readFileSync(join(run.runDir!, 'results', 'route-_.json'), 'utf-8')) as { verdict: string; failReason?: string }
    expect(result.verdict).toBe('fail')
    expect(result.failReason).toContain('condition:')
  })

  it('self-jump condition does not recurse infinitely', async () => {
    writeWorkflow(home, 'wf-cond-self', `
name: wf-cond-self
steps:
  - id: route
    type: condition
    if: "'x' == 'x'"
    then: route
`)

    const run = await startWorkflow('wf-cond-self', { dir: home })
    const loaded = loadWorkflowRun(run.id)
    expect(loaded?.history.filter(h => h.step === 'route')).toHaveLength(1)
    expect(loaded?.currentStep).toBe('route')
    expect(loaded?.status).toBe('running')
  })
})
