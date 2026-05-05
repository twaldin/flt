import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  resolvePrAdapter,
  saveWorkflowRun,
  _applyPrForTest,
} from '../../src/workflow/engine'
import { loadState, saveState } from '../../src/state'
import { _setPrAdapterForTest } from '../../src/pr-adapters'
import type { PrAdapter } from '../../src/pr-adapters'
import type { SpawnStep, WorkflowDef, WorkflowRun } from '../../src/workflow/types'

function makeStep(overrides: Partial<SpawnStep> = {}): SpawnStep {
  return { id: 'step1', preset: undefined, task: 't', ...overrides }
}

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'test-pr-run',
    workflow: 'wf',
    currentStep: 'step1',
    status: 'running',
    parentName: 'human',
    history: [],
    retries: {},
    vars: { _input: { task: 'task', dir: '/tmp' } },
    startedAt: new Date().toISOString(),
    runDir: '/tmp/fake-run',
    ...overrides,
  }
}

describe('resolvePrAdapter', () => {
  it('defaults to gh when nothing is set', () => {
    const run = makeRun()
    expect(resolvePrAdapter(run, makeStep(), undefined)).toBe('gh')
  })

  it('prefers run.vars._prAdapter over step and preset', () => {
    const run = makeRun({ vars: { _input: { task: 't', dir: '/' }, _prAdapter: { name: 'gt' } } })
    const step = makeStep({ pr_adapter: 'manual' })
    expect(resolvePrAdapter(run, step, undefined)).toBe('gt')
  })

  it('falls back to step.pr_adapter when run var is absent', () => {
    const run = makeRun()
    const step = makeStep({ pr_adapter: 'manual' })
    expect(resolvePrAdapter(run, step, undefined)).toBe('manual')
  })

  it('falls back to preset.pr_adapter when step has none', () => {
    // We need a real preset loaded. Use a temp HOME with a preset file.
    const home = mkdtempSync(join(tmpdir(), 'flt-rpa-'))
    const prev = process.env.HOME
    process.env.HOME = home
    try {
      mkdirSync(join(home, '.flt'), { recursive: true })
      writeFileSync(join(home, '.flt', 'presets.json'), JSON.stringify({
        'mypreset': { cli: 'claude', model: 'm', pr_adapter: 'gt' },
      }))
      const run = makeRun()
      const step = makeStep({ preset: 'mypreset' })
      expect(resolvePrAdapter(run, step, 'mypreset')).toBe('gt')
    } finally {
      process.env.HOME = prev
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('step.pr_adapter beats preset.pr_adapter', () => {
    const home = mkdtempSync(join(tmpdir(), 'flt-rpa2-'))
    const prev = process.env.HOME
    process.env.HOME = home
    try {
      mkdirSync(join(home, '.flt'), { recursive: true })
      writeFileSync(join(home, '.flt', 'presets.json'), JSON.stringify({
        'mypreset': { cli: 'claude', model: 'm', pr_adapter: 'gt' },
      }))
      const run = makeRun()
      const step = makeStep({ preset: 'mypreset', pr_adapter: 'manual' })
      expect(resolvePrAdapter(run, step, 'mypreset')).toBe('manual')
    } finally {
      process.env.HOME = prev
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('ignores invalid _prAdapter.name and falls through to step', () => {
    const run = makeRun({ vars: { _input: { task: 't', dir: '/' }, _prAdapter: { name: 'bogus' } } })
    const step = makeStep({ pr_adapter: 'manual' })
    expect(resolvePrAdapter(run, step, undefined)).toBe('manual')
  })
})

describe('applyAutoCommit adapter dispatch', () => {
  let home = ''
  let repoDir = ''
  let previousHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'flt-prdispatch-'))
    repoDir = join(home, 'repo')
    previousHome = process.env.HOME
    process.env.HOME = home
    mkdirSync(join(home, '.flt'), { recursive: true })
    writeFileSync(join(home, '.flt', 'presets.json'), JSON.stringify({}))
    mkdirSync(repoDir, { recursive: true })
    _setPrAdapterForTest('gh', null)
    _setPrAdapterForTest('gt', null)
    _setPrAdapterForTest('manual', null)
  })

  afterEach(() => {
    _setPrAdapterForTest('gh', null)
    _setPrAdapterForTest('gt', null)
    _setPrAdapterForTest('manual', null)
    process.env.HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  })

  it('calls createPr on the adapter resolved from run.vars._prAdapter', async () => {
    const agentName = 'test-pr-run-step1-coder'
    const runId = 'test-pr-run'
    const runDir = join(home, '.flt', 'runs', runId)
    mkdirSync(join(runDir, 'results'), { recursive: true })

    let pushCalled = false
    let createCalled = false
    let createOpts: Parameters<PrAdapter['createPr']>[0] | undefined

    const mockAdapter: PrAdapter = {
      async pushBranch() { pushCalled = true },
      async createPr(opts) {
        createCalled = true
        createOpts = opts
        return { url: 'https://github.com/org/repo/pull/42' }
      },
    }
    _setPrAdapterForTest('gt', mockAdapter)

    const state = loadState()
    state.agents[agentName] = {
      cli: 'claude', model: 'm', tmuxSession: `flt-${agentName}`,
      parentName: 'human', dir: repoDir,
      worktreePath: repoDir,
      worktreeBranch: 'flt/test-branch',
      spawnedAt: new Date().toISOString(),
      workflow: runId,
    }
    saveState(state)

    const wfDir = join(home, '.flt', 'workflows')
    mkdirSync(wfDir, { recursive: true })
    writeFileSync(join(wfDir, 'wf.yaml'), [
      'name: wf',
      'steps:',
      '  - id: step1',
      '    preset: test-preset',
      '    task: do it',
    ].join('\n'))
    writeFileSync(join(home, '.flt', 'presets.json'), JSON.stringify({
      'test-preset': { cli: 'claude', model: 'm' },
    }))

    const run = makeRun({
      id: runId,
      runDir,
      vars: {
        _input: { task: 'my task', dir: repoDir },
        _prAdapter: { name: 'gt' },
      },
    })
    saveWorkflowRun(run)

    await _applyPrForTest(agentName, runId, 'step1')

    expect(createCalled).toBe(true)
    expect(pushCalled).toBe(false)
    expect(createOpts?.branch).toBe('flt/test-branch')
    expect(createOpts?.title).toBeTruthy()
  })

  it('calls pushBranch (not createPr) when _pr already exists', async () => {
    const agentName = 'test-pr-run2-step1-coder'
    const runId = 'test-pr-run2'
    const runDir = join(home, '.flt', 'runs', runId)
    mkdirSync(join(runDir, 'results'), { recursive: true })

    let pushCalled = false
    let createCalled = false

    const mockAdapter: PrAdapter = {
      async pushBranch() { pushCalled = true },
      async createPr() { createCalled = true; return { url: 'x' } },
    }
    _setPrAdapterForTest('gt', mockAdapter)

    const state = loadState()
    state.agents[agentName] = {
      cli: 'claude', model: 'm', tmuxSession: `flt-${agentName}`,
      parentName: 'human', dir: repoDir,
      worktreePath: repoDir,
      worktreeBranch: 'flt/test-branch2',
      spawnedAt: new Date().toISOString(),
      workflow: runId,
    }
    saveState(state)

    const wfDir = join(home, '.flt', 'workflows')
    if (!mkdirSync(wfDir, { recursive: true })) {
      // already exists — that's fine
    }
    writeFileSync(join(wfDir, 'wf.yaml'), [
      'name: wf',
      'steps:',
      '  - id: step1',
      '    preset: test-preset',
      '    task: do it',
    ].join('\n'))
    writeFileSync(join(home, '.flt', 'presets.json'), JSON.stringify({
      'test-preset': { cli: 'claude', model: 'm' },
    }))

    const run = makeRun({
      id: runId,
      runDir,
      vars: {
        _input: { task: 'my task', dir: repoDir },
        _prAdapter: { name: 'gt' },
        _pr: { url: 'https://github.com/org/repo/pull/1', branch: 'flt/test-branch2' },
      },
    })
    saveWorkflowRun(run)

    await _applyPrForTest(agentName, runId, 'step1')

    expect(pushCalled).toBe(true)
    expect(createCalled).toBe(false)
  })
})
