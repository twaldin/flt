import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { execSync } from 'child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  saveWorkflowRun,
  _applyPrForTest,
} from '../../src/workflow/engine'
import { loadState, saveState } from '../../src/state'
import { _setPrAdapterForTest } from '../../src/pr-adapters'
import { listEvents } from '../../src/activity'
import type { PrAdapter } from '../../src/pr-adapters'
import type { WorkflowRun } from '../../src/workflow/types'

function makeGitRepo(dir: string): void {
  mkdirSync(dir, { recursive: true })
  execSync('git init', { cwd: dir })
  execSync('git config user.email "test@test.com"', { cwd: dir })
  execSync('git config user.name "Test"', { cwd: dir })
  writeFileSync(join(dir, 'initial.txt'), 'initial')
  execSync('git add -A', { cwd: dir })
  execSync('git commit -m "init"', { cwd: dir })
}

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'test-commit-fail-run',
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

describe('auto-commit failure skips PR creation and logs event', () => {
  let home = ''
  let repoDir = ''
  let hooksDir = ''
  let previousHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'flt-commitfail-'))
    repoDir = join(home, 'repo')
    previousHome = process.env.HOME
    process.env.HOME = home
    mkdirSync(join(home, '.flt'), { recursive: true })
    writeFileSync(join(home, '.flt', 'presets.json'), JSON.stringify({
      'test-preset': { cli: 'claude', model: 'm' },
    }))
    makeGitRepo(repoDir)
    _setPrAdapterForTest('gh', null)
    _setPrAdapterForTest('gt', null)
    _setPrAdapterForTest('manual', null)

    // Install a failing pre-commit hook to make git commit fail deterministically
    hooksDir = join(home, 'git-hooks')
    mkdirSync(hooksDir, { recursive: true })
    const hookPath = join(hooksDir, 'pre-commit')
    writeFileSync(hookPath, '#!/bin/sh\nexit 1\n')
    chmodSync(hookPath, 0o755)
    execSync(`git config core.hooksPath "${hooksDir}"`, { cwd: repoDir })
  })

  afterEach(() => {
    _setPrAdapterForTest('gh', null)
    _setPrAdapterForTest('gt', null)
    _setPrAdapterForTest('manual', null)
    process.env.HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  })

  it('does not invoke createPr or pushBranch when auto-commit fails', async () => {
    const agentName = 'test-commit-fail-run-step1-coder'
    const runId = 'test-commit-fail-run'
    const runDir = join(home, '.flt', 'runs', runId)
    mkdirSync(join(runDir, 'results'), { recursive: true })

    let pushCalled = false
    let createCalled = false

    const mockAdapter: PrAdapter = {
      async pushBranch() { pushCalled = true },
      async createPr() { createCalled = true; return { url: 'https://example.com/pr/1' } },
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

    const run = makeRun({
      id: runId,
      runDir,
      vars: {
        _input: { task: 'my task', dir: repoDir },
        _prAdapter: { name: 'gt' },
      },
    })
    saveWorkflowRun(run)

    // Add an unstaged file so git will actually attempt the commit
    writeFileSync(join(repoDir, 'work.txt'), 'agent output')

    const eventsBefore = listEvents({ type: 'workflow' }).length

    await _applyPrForTest(agentName, runId, 'step1')

    // The PR adapter must not have been invoked
    expect(createCalled).toBe(false)
    expect(pushCalled).toBe(false)

    // An "auto-commit failed ... skipping" event must have been appended
    const eventsAfter = listEvents({ type: 'workflow', limit: 50 })
    const failEvent = eventsAfter.find(e =>
      e.detail.includes('auto-commit failed') && e.detail.includes('skipping auto-PR/push')
    )
    expect(failEvent).toBeDefined()
    expect(eventsAfter.length).toBeGreaterThan(eventsBefore)
  })

  it('still calls createPr when auto-commit succeeds (happy path guard)', async () => {
    const agentName = 'test-commit-ok-run-step1-coder'
    const runId = 'test-commit-ok-run'
    const runDir = join(home, '.flt', 'runs', runId)
    mkdirSync(join(runDir, 'results'), { recursive: true })

    // Remove the failing hook so this commit succeeds
    execSync('git config --unset core.hooksPath', { cwd: repoDir })

    let createCalled = false

    const mockAdapter: PrAdapter = {
      async pushBranch() {},
      async createPr() { createCalled = true; return { url: 'https://example.com/pr/2' } },
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
    if (!mkdirSync(wfDir, { recursive: true })) {
      // directory already created in this test run — fine
    }
    writeFileSync(join(wfDir, 'wf.yaml'), [
      'name: wf',
      'steps:',
      '  - id: step1',
      '    preset: test-preset',
      '    task: do it',
    ].join('\n'))

    const run = makeRun({
      id: runId,
      runDir,
      vars: {
        _input: { task: 'my task', dir: repoDir },
        _prAdapter: { name: 'gt' },
      },
    })
    saveWorkflowRun(run)

    // Add an unstaged file so there is something to commit
    writeFileSync(join(repoDir, 'work2.txt'), 'more output')

    await _applyPrForTest(agentName, runId, 'step1')

    // The PR adapter should have been called
    expect(createCalled).toBe(true)
  })
})
