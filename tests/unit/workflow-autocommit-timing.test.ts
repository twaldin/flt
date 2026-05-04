import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { execSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  _setSpawnFnForTest,
  saveWorkflowRun,
  signalWorkflowResult,
} from '../../src/workflow/engine'
import { loadState, saveState } from '../../src/state'
import type { WorkflowRun } from '../../src/workflow/types'

function makeGitRepo(dir: string): void {
  mkdirSync(dir, { recursive: true })
  execSync('git init', { cwd: dir })
  execSync('git config user.email "test@test.com"', { cwd: dir })
  execSync('git config user.name "Test"', { cwd: dir })
  writeFileSync(join(dir, 'initial.txt'), 'initial')
  execSync('git add -A && git commit -m "init"', { cwd: dir, shell: true as unknown as string })
}

function countCommits(dir: string): number {
  return parseInt(execSync('git rev-list --count HEAD', { cwd: dir, encoding: 'utf-8' }).trim(), 10)
}

function getLastCommitMessage(dir: string): string {
  return execSync('git log -1 --pretty=%s', { cwd: dir, encoding: 'utf-8' }).trim()
}

describe('auto-commit on workflow pass/fail signal', () => {
  let home = ''
  let repoDir = ''
  let previousHome: string | undefined
  let previousAgentName: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'flt-autocommit-'))
    repoDir = join(home, 'repo')
    previousHome = process.env.HOME
    previousAgentName = process.env.FLT_AGENT_NAME
    process.env.HOME = home
    delete process.env.FLT_AGENT_NAME
    mkdirSync(join(home, '.flt'), { recursive: true })
    writeFileSync(join(home, '.flt', 'presets.json'), JSON.stringify({
      'pi-coder': { cli: 'pi', model: 'gpt-5' },
    }))
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

  it('commits worktree changes before writing result on pass', () => {
    const agentName = 'test-run-step1-coder'
    const runId = 'test-run'
    const runDir = join(home, '.flt', 'runs', runId)
    mkdirSync(join(runDir, 'results'), { recursive: true })

    // Register agent with worktreePath pointing to the git repo
    const state = loadState()
    state.agents[agentName] = {
      cli: 'pi', model: 'gpt-5', tmuxSession: `flt-${agentName}`,
      parentName: 'human', dir: repoDir,
      worktreePath: repoDir,
      spawnedAt: new Date().toISOString(),
    }
    saveState(state)

    const run: WorkflowRun = {
      id: runId,
      workflow: 'wf',
      currentStep: 'step1',
      status: 'running',
      parentName: 'human',
      history: [],
      retries: {},
      vars: { _input: { task: 'task', dir: repoDir } },
      startedAt: new Date().toISOString(),
      runDir,
      dynamicDagGroups: {
        step1: {
          nodes: {
            coder: {
              id: 'coder', task: 'do it', dependsOn: [], preset: 'pi-coder',
              parallel: 1, retries: 0, status: 'running',
              coderAgent: agentName, worktree: repoDir, branch: 'flt/coder',
            },
          },
          topoOrder: ['coder'],
          integrationBranch: 'flt/int',
          integrationWorktree: repoDir,
          skipped: [],
        },
      },
    }
    saveWorkflowRun(run)

    // Agent adds a new file (unstaged changes)
    writeFileSync(join(repoDir, 'new-work.txt'), 'agent work product')

    const commitsBefore = countCommits(repoDir)
    expect(existsSync(join(repoDir, 'new-work.txt'))).toBe(true)

    // Signal pass as the coder agent
    process.env.FLT_AGENT_NAME = agentName
    signalWorkflowResult('pass')

    // Result file should exist
    const resultPath = join(runDir, 'results', 'step1-coder-coder.json')
    expect(existsSync(resultPath)).toBe(true)

    // Worktree should have a new commit containing the file
    const commitsAfter = countCommits(repoDir)
    expect(commitsAfter).toBeGreaterThan(commitsBefore)
    expect(getLastCommitMessage(repoDir)).toContain(agentName)
  })

  it('commits worktree changes on fail signal too', () => {
    const agentName = 'test-run2-step1-coder'
    const runId = 'test-run2'
    const runDir = join(home, '.flt', 'runs', runId)
    mkdirSync(join(runDir, 'results'), { recursive: true })

    const state = loadState()
    state.agents[agentName] = {
      cli: 'pi', model: 'gpt-5', tmuxSession: `flt-${agentName}`,
      parentName: 'human', dir: repoDir,
      worktreePath: repoDir,
      spawnedAt: new Date().toISOString(),
    }
    saveState(state)

    const run: WorkflowRun = {
      id: runId,
      workflow: 'wf',
      currentStep: 'step1',
      status: 'running',
      parentName: 'human',
      history: [],
      retries: {},
      vars: { _input: { task: 'task', dir: repoDir } },
      startedAt: new Date().toISOString(),
      runDir,
      dynamicDagGroups: {
        step1: {
          nodes: {
            coder: {
              id: 'coder', task: 'do it', dependsOn: [], preset: 'pi-coder',
              parallel: 1, retries: 0, status: 'running',
              coderAgent: agentName, worktree: repoDir, branch: 'flt/coder',
            },
          },
          topoOrder: ['coder'],
          integrationBranch: 'flt/int',
          integrationWorktree: repoDir,
          skipped: [],
        },
      },
    }
    saveWorkflowRun(run)

    writeFileSync(join(repoDir, 'partial-work.txt'), 'incomplete')
    const commitsBefore = countCommits(repoDir)

    process.env.FLT_AGENT_NAME = agentName
    signalWorkflowResult('fail', 'tests failed')

    const resultPath = join(runDir, 'results', 'step1-coder-coder.json')
    expect(existsSync(resultPath)).toBe(true)
    const result = JSON.parse(readFileSync(resultPath, 'utf-8')) as { verdict: string }
    expect(result.verdict).toBe('fail')

    expect(countCommits(repoDir)).toBeGreaterThan(commitsBefore)
  })

  it('skips commit when worktree has no uncommitted changes', () => {
    const agentName = 'test-run3-step1-coder'
    const runId = 'test-run3'
    const runDir = join(home, '.flt', 'runs', runId)
    mkdirSync(join(runDir, 'results'), { recursive: true })

    const state = loadState()
    state.agents[agentName] = {
      cli: 'pi', model: 'gpt-5', tmuxSession: `flt-${agentName}`,
      parentName: 'human', dir: repoDir,
      worktreePath: repoDir,
      spawnedAt: new Date().toISOString(),
    }
    saveState(state)

    const run: WorkflowRun = {
      id: runId,
      workflow: 'wf',
      currentStep: 'step1',
      status: 'running',
      parentName: 'human',
      history: [],
      retries: {},
      vars: { _input: { task: 'task', dir: repoDir } },
      startedAt: new Date().toISOString(),
      runDir,
      dynamicDagGroups: {
        step1: {
          nodes: {
            coder: {
              id: 'coder', task: 'do it', dependsOn: [], preset: 'pi-coder',
              parallel: 1, retries: 0, status: 'running',
              coderAgent: agentName, worktree: repoDir, branch: 'flt/coder',
            },
          },
          topoOrder: ['coder'],
          integrationBranch: 'flt/int',
          integrationWorktree: repoDir,
          skipped: [],
        },
      },
    }
    saveWorkflowRun(run)

    // No changes — clean working tree
    const commitsBefore = countCommits(repoDir)

    process.env.FLT_AGENT_NAME = agentName
    signalWorkflowResult('pass')

    // Should not have created a new commit
    expect(countCommits(repoDir)).toBe(commitsBefore)
  })
})
