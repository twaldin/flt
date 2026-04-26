import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { executeCollectArtifactsStep } from '../../src/workflow/engine'
import type { CollectArtifactsStep, WorkflowRun } from '../../src/workflow/types'

function makeRun(runDir: string): WorkflowRun {
  return {
    id: 'collect-artifacts',
    workflow: 'wf',
    currentStep: 'collect',
    status: 'running',
    parentName: 'human',
    history: [],
    retries: {},
    vars: {
      _input: {
        task: 'task',
        dir: runDir,
      },
    },
    startedAt: new Date().toISOString(),
    runDir,
    startBranch: 'main',
  }
}

function readResult(runDir: string, stepId: string): { verdict: string } {
  return JSON.parse(readFileSync(join(runDir, 'results', `${stepId}-_.json`), 'utf-8')) as { verdict: string }
}

describe('workflow collect_artifacts executor', () => {
  let root = ''

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'flt-workflow-collect-artifacts-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('copies files from non-parallel step vars and writes pass result', () => {
    const runDir = join(root, 'run')
    const coderDir = join(root, 'coder')
    mkdirSync(join(runDir, 'results'), { recursive: true })
    mkdirSync(coderDir, { recursive: true })

    writeFileSync(join(coderDir, 'summary.md'), 'summary\n')
    writeFileSync(join(coderDir, 'plan.md'), 'plan\n')

    const run = makeRun(runDir)
    run.vars.coder = { worktree: coderDir, dir: coderDir, branch: 'branch' }

    const step: CollectArtifactsStep = {
      type: 'collect_artifacts',
      id: 'collect',
      from: ['coder'],
      files: ['summary.md', 'plan.md'],
      into: 'handoffs',
    }

    executeCollectArtifactsStep({ name: 'wf', steps: [step] }, run, step)

    expect(readFileSync(join(runDir, 'handoffs', 'coder-_-summary.md'), 'utf-8')).toBe('summary\n')
    expect(readFileSync(join(runDir, 'handoffs', 'coder-_-plan.md'), 'utf-8')).toBe('plan\n')
    expect(readResult(runDir, 'collect').verdict).toBe('pass')
  })

  it('copies files from each parallel candidate worktree', () => {
    const runDir = join(root, 'run')
    mkdirSync(join(runDir, 'results'), { recursive: true })

    const aDir = join(root, 'a')
    const bDir = join(root, 'b')
    const cDir = join(root, 'c')
    mkdirSync(aDir, { recursive: true })
    mkdirSync(bDir, { recursive: true })
    mkdirSync(cDir, { recursive: true })

    writeFileSync(join(aDir, 'summary.md'), 'A\n')
    writeFileSync(join(bDir, 'summary.md'), 'B\n')
    writeFileSync(join(cDir, 'summary.md'), 'C\n')

    const run = makeRun(runDir)
    run.parallelGroups = {
      fanout: {
        candidates: [
          { label: 'a', agentName: 'fanout-a', preset: 'p', worktree: aDir },
          { label: 'b', agentName: 'fanout-b', preset: 'p', worktree: bDir },
          { label: 'c', agentName: 'fanout-c', preset: 'p', worktree: cDir },
        ],
        treatmentMap: {},
        allDone: false,
      },
    }

    const step: CollectArtifactsStep = {
      type: 'collect_artifacts',
      id: 'collect',
      from: ['fanout'],
      files: ['summary.md'],
      into: 'handoffs',
    }

    executeCollectArtifactsStep({ name: 'wf', steps: [step] }, run, step)

    expect(readFileSync(join(runDir, 'handoffs', 'fanout-a-summary.md'), 'utf-8')).toBe('A\n')
    expect(readFileSync(join(runDir, 'handoffs', 'fanout-b-summary.md'), 'utf-8')).toBe('B\n')
    expect(readFileSync(join(runDir, 'handoffs', 'fanout-c-summary.md'), 'utf-8')).toBe('C\n')
    expect(readResult(runDir, 'collect').verdict).toBe('pass')
  })

  it('silently skips missing files while still passing', () => {
    const runDir = join(root, 'run')
    const coderDir = join(root, 'coder')
    mkdirSync(join(runDir, 'results'), { recursive: true })
    mkdirSync(coderDir, { recursive: true })

    writeFileSync(join(coderDir, 'summary.md'), 'summary\n')

    const run = makeRun(runDir)
    run.vars.coder = { worktree: coderDir, dir: coderDir, branch: 'branch' }

    const step: CollectArtifactsStep = {
      type: 'collect_artifacts',
      id: 'collect',
      from: ['coder'],
      files: ['summary.md', 'nonexistent.md'],
      into: 'handoffs',
    }

    executeCollectArtifactsStep({ name: 'wf', steps: [step] }, run, step)

    expect(existsSync(join(runDir, 'handoffs', 'coder-_-summary.md'))).toBe(true)
    expect(existsSync(join(runDir, 'handoffs', 'coder-_-nonexistent.md'))).toBe(false)
    expect(readResult(runDir, 'collect').verdict).toBe('pass')
  })

  it('uses basename for destination filenames', () => {
    const runDir = join(root, 'run')
    const aDir = join(root, 'a')
    mkdirSync(join(runDir, 'results'), { recursive: true })
    mkdirSync(join(aDir, 'src', 'nested'), { recursive: true })

    writeFileSync(join(aDir, 'src', 'nested', 'foo.md'), 'foo\n')

    const run = makeRun(runDir)
    run.parallelGroups = {
      fanout: {
        candidates: [
          { label: 'a', agentName: 'fanout-a', preset: 'p', worktree: aDir },
        ],
        treatmentMap: {},
        allDone: false,
      },
    }

    const step: CollectArtifactsStep = {
      type: 'collect_artifacts',
      id: 'collect',
      from: ['fanout'],
      files: ['src/nested/foo.md'],
      into: 'handoffs',
    }

    executeCollectArtifactsStep({ name: 'wf', steps: [step] }, run, step)

    expect(readFileSync(join(runDir, 'handoffs', 'fanout-a-foo.md'), 'utf-8')).toBe('foo\n')
    expect(readResult(runDir, 'collect').verdict).toBe('pass')
  })
})
