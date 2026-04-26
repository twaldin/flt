import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { setAgent } from '../../src/state'
import {
  _setSpawnFnForTest,
  advanceWorkflow,
  loadWorkflowRun,
  saveWorkflowRun,
  startWorkflow,
} from '../../src/workflow/engine'
import { writeResult } from '../../src/workflow/results'
import type { WorkflowRun } from '../../src/workflow/types'

function seedPresets(home: string): void {
  mkdirSync(join(home, '.flt'), { recursive: true })
  writeFileSync(
    join(home, '.flt', 'presets.json'),
    JSON.stringify({
      default: { cli: 'pi', model: 'gpt-5' },
      A: { cli: 'pi', model: 'gpt-5' },
      B: { cli: 'pi', model: 'gpt-5' },
      C: { cli: 'pi', model: 'gpt-5' },
      'pi-coder': { cli: 'pi', model: 'gpt-5' },
    }),
  )
}

function writeWorkflow(home: string, name: string, yaml: string): void {
  const workflowsDir = join(home, '.flt', 'workflows')
  mkdirSync(workflowsDir, { recursive: true })
  writeFileSync(join(workflowsDir, `${name}.yaml`), yaml)
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
    vars: {
      _input: {
        task: 'task',
        dir: home,
      },
    },
    startedAt: new Date().toISOString(),
    runDir: join(home, '.flt', 'runs', id),
  }
}

describe('workflow parallel executor', () => {
  let home = ''
  let previousHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'flt-workflow-parallel-'))
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

  it('spawns parallel candidates with deterministic treatment map and label env', async () => {
    const calls: Array<{ name: string; preset?: string; extraEnv?: Record<string, string>; workflowStep?: string }> = []

    _setSpawnFnForTest(async args => {
      calls.push({
        name: args.name,
        preset: args.preset,
        extraEnv: (args as { extraEnv?: Record<string, string> }).extraEnv,
        workflowStep: args.workflowStep,
      })
      const workdir = mkdtempSync(join(tmpdir(), `flt-agent-${args.name}-`))
      setAgent(args.name, {
        cli: 'pi',
        model: 'gpt-5',
        tmuxSession: `flt-${args.name}`,
        parentName: args.parent ?? 'human',
        dir: workdir,
        worktreePath: workdir,
        worktreeBranch: `flt/${args.name}`,
        spawnedAt: new Date().toISOString(),
      })
    })

    writeWorkflow(home, 'wf-parallel', `
name: wf-parallel
steps:
  - id: fanout
    type: parallel
    n: 3
    presets: [A, B, C]
    step:
      id: coder
      preset: pi-coder
      task: do work
    on_complete: done
`)

    const run = await startWorkflow('wf-parallel', { dir: home })
    const loaded = loadWorkflowRun(run.id)
    expect(loaded?.parallelGroups?.fanout).toBeDefined()
    const group = loaded!.parallelGroups!.fanout

    expect(group.candidates.map(c => c.label)).toEqual(['a', 'b', 'c'])
    const mappedPresets = Object.values(group.treatmentMap).sort()
    expect(mappedPresets).toEqual(['A', 'B', 'C'])
    expect(calls.length).toBe(3)
    for (const candidate of group.candidates) {
      expect(candidate.treatment?.roleHash).toMatch(/^[a-f0-9]{64}$/)
      expect(candidate.treatment?.workflowHash).toMatch(/^[a-f0-9]{64}$/)
      expect(candidate.treatment?.skillHashes).toBeDefined()
    }

    for (const c of group.candidates) {
      const call = calls.find(v => v.name === c.agentName)
      expect(call).toBeDefined()
      expect(call?.extraEnv?.FLT_RUN_DIR).toBe(loaded?.runDir)
      expect(call?.extraEnv?.FLT_RUN_LABEL).toBe(c.label)
    }

    rmSync(join(home, '.flt', 'runs', run.id), { recursive: true, force: true })
    calls.length = 0
    const run2 = await startWorkflow('wf-parallel', { dir: home })
    const loaded2 = loadWorkflowRun(run2.id)
    expect(loaded2?.parallelGroups?.fanout.treatmentMap).toEqual(group.treatmentMap)
  })

  it('uses child preset when presets are not provided', async () => {
    _setSpawnFnForTest(async args => {
      const workdir = mkdtempSync(join(tmpdir(), `flt-agent-${args.name}-`))
      setAgent(args.name, {
        cli: 'pi',
        model: 'gpt-5',
        tmuxSession: `flt-${args.name}`,
        parentName: args.parent ?? 'human',
        dir: workdir,
        worktreePath: workdir,
        worktreeBranch: `flt/${args.name}`,
        spawnedAt: new Date().toISOString(),
      })
    })

    writeWorkflow(home, 'wf-default-presets', `
name: wf-default-presets
steps:
  - id: fanout
    type: parallel
    n: 2
    step:
      id: coder
      preset: pi-coder
      task: do work
    on_complete: done
`)

    const run = await startWorkflow('wf-default-presets', { dir: home })
    const loaded = loadWorkflowRun(run.id)
    const treatmentMap = loaded?.parallelGroups?.fanout.treatmentMap ?? {}
    expect(Object.keys(treatmentMap).sort()).toEqual(['a', 'b'])
    expect(Object.values(treatmentMap)).toEqual(['pi-coder', 'pi-coder'])
  })

  it('parallel verdict aggregation collapses pass when any candidate passes', async () => {
    writeWorkflow(home, 'wf-par-pass', `
name: wf-par-pass
steps:
  - id: fanout
    type: parallel
    n: 3
    presets: [A, B, C]
    step:
      id: coder
      preset: pi-coder
      task: do work
    on_complete: done
`)

    const run = makeRun(home, 'par-pass', 'wf-par-pass', 'fanout')
    run.parallelGroups = {
      fanout: {
        candidates: [
          { label: 'a', agentName: 'par-pass-fanout-a', preset: 'A' },
          { label: 'b', agentName: 'par-pass-fanout-b', preset: 'B' },
          { label: 'c', agentName: 'par-pass-fanout-c', preset: 'C' },
        ],
        treatmentMap: { a: 'A', b: 'B', c: 'C' },
        allDone: false,
      },
    }
    mkdirSync(join(run.runDir!, 'results'), { recursive: true })
    saveWorkflowRun(run)

    writeResult(run.runDir!, 'fanout', 'a', 'pass')
    writeResult(run.runDir!, 'fanout', 'b', 'fail', 'bad')
    writeResult(run.runDir!, 'fanout', 'c', 'pass')

    await advanceWorkflow(run.id)
    const loaded = loadWorkflowRun(run.id)
    expect(loaded?.history.map(h => [h.step, h.result])).toContainEqual(['fanout', 'completed'])
  })

  it('parallel verdict aggregation collapses fail when all candidates fail', async () => {
    writeWorkflow(home, 'wf-par-fail', `
name: wf-par-fail
steps:
  - id: fanout
    type: parallel
    n: 3
    presets: [A, B, C]
    step:
      id: coder
      preset: pi-coder
      task: do work
    on_complete: done
`)

    const run = makeRun(home, 'par-fail', 'wf-par-fail', 'fanout')
    run.parallelGroups = {
      fanout: {
        candidates: [
          { label: 'a', agentName: 'par-fail-fanout-a', preset: 'A' },
          { label: 'b', agentName: 'par-fail-fanout-b', preset: 'B' },
          { label: 'c', agentName: 'par-fail-fanout-c', preset: 'C' },
        ],
        treatmentMap: { a: 'A', b: 'B', c: 'C' },
        allDone: false,
      },
    }
    mkdirSync(join(run.runDir!, 'results'), { recursive: true })
    saveWorkflowRun(run)

    writeResult(run.runDir!, 'fanout', 'a', 'fail', 'ra')
    writeResult(run.runDir!, 'fanout', 'b', 'fail', 'rb')
    writeResult(run.runDir!, 'fanout', 'c', 'fail', 'rc')

    await advanceWorkflow(run.id)
    const loaded = loadWorkflowRun(run.id)
    expect(loaded?.history.map(h => [h.step, h.result])).toContainEqual(['fanout', 'failed'])
    expect(loaded?.status).toBe('failed')
  })
})
