import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { execSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadState, saveState } from '../../src/state'
import {
    _setSpawnFnForTest,
    advanceWorkflow,
    listWorkflowRuns,
    loadWorkflowRun,
    saveWorkflowRun,
    signalWorkflowResult,
    startWorkflow,
    workflowAgentName,
} from '../../src/workflow/engine'
import { writeResult } from '../../src/workflow/results'
import type { WorkflowRun } from '../../src/workflow/types'

function writeWorkflow(home: string, name: string, yaml: string): void {
    const workflowsDir = join(home, '.flt', 'workflows')
    mkdirSync(workflowsDir, { recursive: true })
    writeFileSync(join(workflowsDir, `${name}.yaml`), yaml)
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

describe('workflow engine plumbing', () => {
    let home = ''
    let previousHome: string | undefined
    let previousAgentName: string | undefined

    beforeEach(() => {
        home = mkdtempSync(join(tmpdir(), 'flt-workflow-engine-plumbing-'))
        previousHome = process.env.HOME
        previousAgentName = process.env.FLT_AGENT_NAME
        process.env.HOME = home
        delete process.env.FLT_AGENT_NAME
        seedPresets(home)
        _setSpawnFnForTest(async args => {
            const state = loadState()
            state.agents[args.name] = {
                cli: 'pi',
                model: 'gpt-5',
                tmuxSession: `flt-${args.name}`,
                parentName: args.parent ?? 'human',
                dir: args.dir ?? home,
                worktreePath: args.dir ?? home,
                spawnedAt: new Date().toISOString(),
            }
            saveState(state)
        })
    })

    afterEach(() => {
        _setSpawnFnForTest(null)
        if (previousHome === undefined) {
            delete process.env.HOME
        } else {
            process.env.HOME = previousHome
        }
        if (previousAgentName === undefined) {
            delete process.env.FLT_AGENT_NAME
        } else {
            process.env.FLT_AGENT_NAME = previousAgentName
        }
        rmSync(home, { recursive: true, force: true })
    })

    it('saveWorkflowRun + loadWorkflowRun roundtrip writes runDir/run.json', () => {
        const run = makeRun(home, 'roundtrip-1', 'wf', 's1')

        saveWorkflowRun(run)

        const runPath = join(home, '.flt', 'runs', run.id, 'run.json')
        expect(existsSync(runPath)).toBe(true)
        expect(loadWorkflowRun(run.id)).toEqual(run)
    })

    it('refuses old-shape runs without runDir', () => {
        const runDir = join(home, '.flt', 'runs', 'old-run')
        mkdirSync(runDir, { recursive: true })
        writeFileSync(join(runDir, 'run.json'), JSON.stringify({
            id: 'old-run',
            workflow: 'wf',
            currentStep: 's1',
            status: 'running',
            parentName: 'human',
            history: [],
            retries: {},
            vars: { _input: { task: '', dir: home } },
            startedAt: new Date().toISOString(),
        }))

        expect(() => loadWorkflowRun('old-run')).toThrow(/upgrade required|cancel it/i)
    })

    it('startWorkflow creates runDir with results and handoffs and captures startBranch', async () => {
        const repoDir = mkdtempSync(join(tmpdir(), 'flt-workflow-repo-'))
        execSync('git init', { cwd: repoDir, stdio: 'ignore' })
        writeWorkflow(home, 'wf-start', `
name: wf-start
steps:
  - id: coder
    preset: pi-coder
    task: do it
`)

        const run = await startWorkflow('wf-start', { dir: repoDir })
        const loaded = loadWorkflowRun(run.id)
        expect(loaded).not.toBeNull()
        expect(loaded?.runDir).toBe(join(home, '.flt', 'runs', run.id))
        expect(existsSync(join(loaded!.runDir!, 'results'))).toBe(true)
        expect(existsSync(join(loaded!.runDir!, 'handoffs'))).toBe(true)

        const expectedBranch = execSync('git symbolic-ref --short HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim()
        expect(loaded?.startBranch === expectedBranch || loaded?.startBranch === '').toBe(true)

        rmSync(repoDir, { recursive: true, force: true })
    })

    it('listWorkflowRuns reads run.json from new runs/<id>/ layout', () => {
        const runA = makeRun(home, 'run-a', 'wf', 's1')
        const runB = makeRun(home, 'run-b', 'wf', 's2')

        saveWorkflowRun(runA)
        saveWorkflowRun(runB)

        const runs = listWorkflowRuns()
        const ids = runs.map(r => r.id).sort()
        expect(ids).toEqual(['run-a', 'run-b'])
    })

    it('signalWorkflowResult non-parallel writes step-_ result file and does not set run.stepResult', () => {
        const run = makeRun(home, 'sig-non-par', 'wf', 'coder')
        saveWorkflowRun(run)

        process.env.FLT_AGENT_NAME = workflowAgentName(run.id, run.currentStep)
        signalWorkflowResult('pass')

        const resultPath = join(run.runDir!, 'results', 'coder-_.json')
        expect(existsSync(resultPath)).toBe(true)
        const parsed = JSON.parse(readFileSync(resultPath, 'utf-8')) as { verdict?: string }
        expect(parsed.verdict).toBe('pass')

        const loaded = loadWorkflowRun(run.id)
        expect(loaded?.stepResult).toBeUndefined()
    })

    it('signalWorkflowResult parallel writes step-label result file for matching candidate agent', () => {
        const run = makeRun(home, 'sig-par', 'wf', 'fanout')
        run.parallelGroups = {
            fanout: {
                candidates: [
                    { label: 'a', agentName: 'fanout-a', preset: 'pi-coder' },
                    { label: 'b', agentName: 'fanout-b', preset: 'pi-coder' },
                    { label: 'c', agentName: 'fanout-c', preset: 'pi-coder' },
                ],
                treatmentMap: {},
                allDone: false,
            },
        }
        saveWorkflowRun(run)

        process.env.FLT_AGENT_NAME = 'fanout-b'
        signalWorkflowResult('fail', 'reason-b')

        const resultPath = join(run.runDir!, 'results', 'fanout-b.json')
        expect(existsSync(resultPath)).toBe(true)
        const parsed = JSON.parse(readFileSync(resultPath, 'utf-8')) as { verdict?: string; failReason?: string }
        expect(parsed.verdict).toBe('fail')
        expect(parsed.failReason).toBe('reason-b')
    })

    it('advanceWorkflow parallel waits on partial results, then passes when >=1 pass and spawns next step', async () => {
        const spawnCalls: string[] = []
        _setSpawnFnForTest(async args => {
            spawnCalls.push(args.name)
            const state = loadState()
            state.agents[args.name] = {
                cli: 'pi',
                model: 'gpt-5',
                tmuxSession: `flt-${args.name}`,
                parentName: args.parent ?? 'human',
                dir: args.dir ?? home,
                worktreePath: args.dir ?? home,
                spawnedAt: new Date().toISOString(),
            }
            saveState(state)
        })

        writeWorkflow(home, 'wf-par-pass', `
name: wf-par-pass
steps:
  - id: fanout
    type: parallel
    n: 3
    step:
      id: coder
      preset: pi-coder
      task: do it
    on_complete: next
    on_fail: abort
  - id: next
    preset: pi-coder
    task: done
`)

        const run = makeRun(home, 'adv-par-pass', 'wf-par-pass', 'fanout')
        run.parallelGroups = {
            fanout: {
                candidates: [
                    { label: 'a', agentName: 'fanout-a', preset: 'pi-coder' },
                    { label: 'b', agentName: 'fanout-b', preset: 'pi-coder' },
                    { label: 'c', agentName: 'fanout-c', preset: 'pi-coder' },
                ],
                treatmentMap: {},
                allDone: false,
            },
        }
        saveWorkflowRun(run)

        writeResult(run.runDir!, 'fanout', 'a', 'pass')
        writeResult(run.runDir!, 'fanout', 'b', 'fail', 'reason-b')
        await advanceWorkflow(run.id)
        expect(loadWorkflowRun(run.id)?.currentStep).toBe('fanout')
        expect(spawnCalls.length).toBe(0)

        writeResult(run.runDir!, 'fanout', 'c', 'pass')
        await advanceWorkflow(run.id)

        const loaded = loadWorkflowRun(run.id)
        expect(loaded?.currentStep).toBe('next')
        expect(loaded?.history.map(h => [h.step, h.result])).toContainEqual(['fanout', 'completed'])
        expect(spawnCalls).toContain(workflowAgentName(run.id, 'next'))
    })

    it('run step gets FLT_RUN_DIR env var', async () => {
        const outputPath = join(home, '.flt-run-dir.txt')
        writeWorkflow(home, 'wf-run-env', `
name: wf-run-env
steps:
  - id: shell
    run: |
      printf '%s' "$FLT_RUN_DIR" > '${outputPath}'
`)

        const run = await startWorkflow('wf-run-env', { dir: home })
        expect(readFileSync(outputPath, 'utf-8')).toBe(run.runDir)
    })

    it('advanceWorkflow parallel all-fail collapses to fail and follows on_fail chain', async () => {
        const spawnCalls: string[] = []
        _setSpawnFnForTest(async args => {
            spawnCalls.push(args.name)
            const state = loadState()
            state.agents[args.name] = {
                cli: 'pi',
                model: 'gpt-5',
                tmuxSession: `flt-${args.name}`,
                parentName: args.parent ?? 'human',
                dir: args.dir ?? home,
                worktreePath: args.dir ?? home,
                spawnedAt: new Date().toISOString(),
            }
            saveState(state)
        })

        writeWorkflow(home, 'wf-par-fail', `
name: wf-par-fail
steps:
  - id: fanout
    type: parallel
    n: 3
    step:
      id: coder
      preset: pi-coder
      task: do it
    on_complete: done
    on_fail: recover
  - id: recover
    preset: pi-coder
    task: recover
`)

        const run = makeRun(home, 'adv-par-fail', 'wf-par-fail', 'fanout')
        run.parallelGroups = {
            fanout: {
                candidates: [
                    { label: 'a', agentName: 'fanout-a', preset: 'pi-coder' },
                    { label: 'b', agentName: 'fanout-b', preset: 'pi-coder' },
                    { label: 'c', agentName: 'fanout-c', preset: 'pi-coder' },
                ],
                treatmentMap: {},
                allDone: false,
            },
        }
        saveWorkflowRun(run)

        writeResult(run.runDir!, 'fanout', 'a', 'fail', 'ra')
        writeResult(run.runDir!, 'fanout', 'b', 'fail', 'rb')
        writeResult(run.runDir!, 'fanout', 'c', 'fail', 'rc')

        await advanceWorkflow(run.id)

        const loaded = loadWorkflowRun(run.id)
        expect(loaded?.currentStep).toBe('recover')
        expect(loaded?.history.map(h => [h.step, h.result])).toContainEqual(['fanout', 'failed'])
        expect(spawnCalls).toContain(workflowAgentName(run.id, 'recover'))
    })
})
