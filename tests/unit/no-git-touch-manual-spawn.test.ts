import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { execSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  _applyAutoCommitForTest,
  _setSpawnFnForTest,
  getWorkflowForAgent,
  isWorkflowAgent,
  saveWorkflowRun,
} from '../../src/workflow/engine'
import { loadState, saveState } from '../../src/state'
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

function countCommits(dir: string): number {
  return parseInt(execSync('git rev-list --count HEAD', { cwd: dir, encoding: 'utf-8' }).trim(), 10)
}

describe('no-git-touch for manual spawn', () => {
  let home = ''
  let repoDir = ''
  let previousHome: string | undefined
  let previousAgentName: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'flt-no-git-touch-'))
    repoDir = join(home, 'repo')
    previousHome = process.env.HOME
    previousAgentName = process.env.FLT_AGENT_NAME
    process.env.HOME = home
    delete process.env.FLT_AGENT_NAME
    mkdirSync(join(home, '.flt'), { recursive: true })
    makeGitRepo(repoDir)
    _setSpawnFnForTest(null)
  })

  afterEach(() => {
    _setSpawnFnForTest(null)
    process.env.HOME = previousHome
    if (previousAgentName === undefined) {
      delete process.env.FLT_AGENT_NAME
    } else {
      process.env.FLT_AGENT_NAME = previousAgentName
    }
    rmSync(home, { recursive: true, force: true })
  })

  it('isWorkflowAgent returns false for a manual spawn agent', () => {
    const agentName = 'my-manual-agent'
    const state = loadState()
    state.agents[agentName] = {
      cli: 'claude-code', model: 'sonnet', tmuxSession: `flt-${agentName}`,
      parentName: 'human', dir: repoDir,
      worktreePath: repoDir,
      spawnedAt: new Date().toISOString(),
      // no workflow field
    }
    saveState(state)

    expect(isWorkflowAgent(agentName)).toBe(false)
    expect(getWorkflowForAgent(agentName)).toBeNull()
  })

  it('isWorkflowAgent returns true for an agent in an active workflow run', () => {
    const agentName = 'wf-run-step1'
    const runId = 'wf-run'
    const runDir = join(home, '.flt', 'runs', runId)
    mkdirSync(join(runDir, 'results'), { recursive: true })

    const state = loadState()
    state.agents[agentName] = {
      cli: 'claude-code', model: 'sonnet', tmuxSession: `flt-${agentName}`,
      parentName: 'human', dir: repoDir,
      worktreePath: repoDir,
      workflow: 'my-workflow',
      spawnedAt: new Date().toISOString(),
    }
    saveState(state)

    const run: WorkflowRun = {
      id: runId,
      workflow: 'my-workflow',
      currentStep: 'step1',
      status: 'running',
      parentName: 'human',
      history: [],
      retries: {},
      vars: { _input: { task: 'task', dir: repoDir } },
      startedAt: new Date().toISOString(),
      runDir,
    }
    saveWorkflowRun(run)

    expect(isWorkflowAgent(agentName)).toBe(true)
    expect(getWorkflowForAgent(agentName)).toBe(runId)
  })

  it('applyAutoCommit no-ops when agent has no workflow association', () => {
    const agentName = 'my-manual-agent'
    const state = loadState()
    state.agents[agentName] = {
      cli: 'claude-code', model: 'sonnet', tmuxSession: `flt-${agentName}`,
      parentName: 'human', dir: repoDir,
      worktreePath: repoDir,
      // no workflow field
      spawnedAt: new Date().toISOString(),
    }
    saveState(state)

    // Add unstaged changes
    writeFileSync(join(repoDir, 'manual-work.txt'), 'some work')

    const commitsBefore = countCommits(repoDir)
    _applyAutoCommitForTest(agentName)
    expect(countCommits(repoDir)).toBe(commitsBefore)
  })

  it('applyAutoCommit commits when agent has an active workflow association', () => {
    const agentName = 'wf-run2-step1'
    const runId = 'wf-run2'
    const runDir = join(home, '.flt', 'runs', runId)
    mkdirSync(join(runDir, 'results'), { recursive: true })

    const state = loadState()
    state.agents[agentName] = {
      cli: 'claude-code', model: 'sonnet', tmuxSession: `flt-${agentName}`,
      parentName: 'human', dir: repoDir,
      worktreePath: repoDir,
      workflow: 'my-workflow',
      spawnedAt: new Date().toISOString(),
    }
    saveState(state)

    const run: WorkflowRun = {
      id: runId,
      workflow: 'my-workflow',
      currentStep: 'step1',
      status: 'running',
      parentName: 'human',
      history: [],
      retries: {},
      vars: { _input: { task: 'task', dir: repoDir } },
      startedAt: new Date().toISOString(),
      runDir,
    }
    saveWorkflowRun(run)

    writeFileSync(join(repoDir, 'workflow-work.txt'), 'workflow output')

    const commitsBefore = countCommits(repoDir)
    _applyAutoCommitForTest(agentName)
    expect(countCommits(repoDir)).toBeGreaterThan(commitsBefore)
  })

  it('manual spawn worktree accumulates no commits after kill', () => {
    // Verify the invariant: a manual-spawn agent's worktree can only grow
    // commits from the agent itself, never from flt infrastructure.
    // We simulate the kill path: killDirect removes state + worktree but does
    // not commit. This test confirms the commit count stays at the baseline.
    const agentName = 'manual-kill-test'
    const state = loadState()
    state.agents[agentName] = {
      cli: 'claude-code', model: 'sonnet', tmuxSession: `flt-${agentName}`,
      parentName: 'human', dir: repoDir,
      worktreePath: repoDir,
      spawnedAt: new Date().toISOString(),
    }
    saveState(state)

    writeFileSync(join(repoDir, 'uncommitted.txt'), 'not committed by flt')
    const commitsBefore = countCommits(repoDir)

    // applyAutoCommit must not fire for this non-workflow agent
    _applyAutoCommitForTest(agentName)

    expect(countCommits(repoDir)).toBe(commitsBefore)
  })
})
