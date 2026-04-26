import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { execSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { executeMergeBestStep, saveWorkflowRun } from '../../src/workflow/engine'
import type { MergeBestStep, WorkflowDef, WorkflowRun } from '../../src/workflow/types'

function makeRun(home: string, id: string, runDir: string, repoDir: string): WorkflowRun {
  return {
    id,
    workflow: 'wf',
    currentStep: 'merge',
    status: 'running',
    parentName: 'human',
    history: [],
    retries: {},
    vars: {
      _input: {
        task: 'task',
        dir: repoDir,
      },
    },
    startedAt: new Date().toISOString(),
    runDir,
    startBranch: 'main',
  }
}

function initRepo(repoDir: string): void {
  execSync('git init', { cwd: repoDir, stdio: 'ignore' })
  execSync('git config user.email "test@example.com"', { cwd: repoDir })
  execSync('git config user.name "Test User"', { cwd: repoDir })
  execSync('git checkout -b main', { cwd: repoDir, stdio: 'ignore' })
}

function readResult(runDir: string, stepId: string): { verdict: string; failReason?: string } {
  return JSON.parse(readFileSync(join(runDir, 'results', `${stepId}-_.json`), 'utf-8')) as { verdict: string; failReason?: string }
}

describe('workflow merge_best executor', () => {
  let home = ''
  let previousHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'flt-workflow-merge-best-'))
    previousHome = process.env.HOME
    process.env.HOME = home
  })

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = previousHome
    }
    rmSync(home, { recursive: true, force: true })
  })

  it('merges winner branch from winner.json and writes pass result', () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'flt-workflow-repo-'))
    initRepo(repoDir)

    writeFileSync(join(repoDir, 'README.md'), 'hello\n')
    execSync('git add README.md && git commit -m "base"', { cwd: repoDir, stdio: 'ignore' })

    execSync('git checkout -b flt/cand-a', { cwd: repoDir, stdio: 'ignore' })
    writeFileSync(join(repoDir, 'foo.md'), 'A\n')
    execSync('git add foo.md && git commit -m "cand-a"', { cwd: repoDir, stdio: 'ignore' })

    execSync('git checkout main', { cwd: repoDir, stdio: 'ignore' })
    execSync('git checkout -b flt/cand-b', { cwd: repoDir, stdio: 'ignore' })
    writeFileSync(join(repoDir, 'bar.md'), 'B\n')
    execSync('git add bar.md && git commit -m "cand-b"', { cwd: repoDir, stdio: 'ignore' })
    execSync('git checkout main', { cwd: repoDir, stdio: 'ignore' })

    const runDir = join(home, '.flt', 'runs', 'merge-best-pass')
    mkdirSync(join(runDir, 'results'), { recursive: true })
    const run = makeRun(home, 'merge-best-pass', runDir, repoDir)
    run.parallelGroups = {
      fanout: {
        candidates: [
          { label: 'a', agentName: 'fanout-a', preset: 'pi-coder', branch: 'flt/cand-a', worktree: repoDir },
          { label: 'b', agentName: 'fanout-b', preset: 'pi-coder', branch: 'flt/cand-b', worktree: repoDir },
        ],
        treatmentMap: {},
        allDone: false,
      },
    }
    saveWorkflowRun(run)

    writeFileSync(join(runDir, 'winner.json'), JSON.stringify({ winner: 'b' }))

    const step: MergeBestStep = { type: 'merge_best', id: 'merge', candidate_var: 'fanout' }
    const def: WorkflowDef = { name: 'wf', steps: [step] }

    executeMergeBestStep(def, run, step)

    const log = execSync('git log --oneline --max-count=1', { cwd: repoDir, encoding: 'utf-8' })
    expect(log).toContain('workflow merge-best-pass: merge winner b')
    expect(readFileSync(join(repoDir, 'bar.md'), 'utf-8')).toBe('B\n')

    const result = readResult(runDir, 'merge')
    expect(result.verdict).toBe('pass')

    rmSync(repoDir, { recursive: true, force: true })
  })

  it('writes fail result on merge conflict', () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'flt-workflow-repo-'))
    initRepo(repoDir)

    writeFileSync(join(repoDir, 'README.md'), 'hello\n')
    execSync('git add README.md && git commit -m "base"', { cwd: repoDir, stdio: 'ignore' })

    execSync('git checkout -b flt/cand-a', { cwd: repoDir, stdio: 'ignore' })
    writeFileSync(join(repoDir, 'README.md'), 'A-version\n')
    execSync('git add README.md && git commit -m "cand-a"', { cwd: repoDir, stdio: 'ignore' })

    execSync('git checkout main', { cwd: repoDir, stdio: 'ignore' })
    writeFileSync(join(repoDir, 'README.md'), 'main-version\n')
    execSync('git add README.md && git commit -m "main change"', { cwd: repoDir, stdio: 'ignore' })

    const runDir = join(home, '.flt', 'runs', 'merge-best-conflict')
    mkdirSync(join(runDir, 'results'), { recursive: true })
    const run = makeRun(home, 'merge-best-conflict', runDir, repoDir)
    run.parallelGroups = {
      fanout: {
        candidates: [
          { label: 'a', agentName: 'fanout-a', preset: 'pi-coder', branch: 'flt/cand-a', worktree: repoDir },
        ],
        treatmentMap: {},
        allDone: false,
      },
    }
    saveWorkflowRun(run)

    writeFileSync(join(runDir, 'winner.json'), JSON.stringify({ winner: 'a' }))

    const step: MergeBestStep = { type: 'merge_best', id: 'merge', candidate_var: 'fanout' }
    executeMergeBestStep({ name: 'wf', steps: [step] }, run, step)

    const result = readResult(runDir, 'merge')
    expect(result.verdict).toBe('fail')
    expect(result.failReason).toContain('conflict')

    rmSync(repoDir, { recursive: true, force: true })
  })

  it('fails when winner file is missing', () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'flt-workflow-repo-'))
    initRepo(repoDir)

    const runDir = join(home, '.flt', 'runs', 'merge-best-missing')
    mkdirSync(join(runDir, 'results'), { recursive: true })
    const run = makeRun(home, 'merge-best-missing', runDir, repoDir)
    saveWorkflowRun(run)

    const step: MergeBestStep = { type: 'merge_best', id: 'merge', candidate_var: 'fanout' }
    executeMergeBestStep({ name: 'wf', steps: [step] }, run, step)

    const result = readResult(runDir, 'merge')
    expect(result.verdict).toBe('fail')
    expect(result.failReason).toContain('no winner')

    rmSync(repoDir, { recursive: true, force: true })
  })

  it('uses .gate-decision candidate fallback', () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'flt-workflow-repo-'))
    initRepo(repoDir)

    writeFileSync(join(repoDir, 'README.md'), 'hello\n')
    execSync('git add README.md && git commit -m "base"', { cwd: repoDir, stdio: 'ignore' })

    execSync('git checkout -b flt/cand-b', { cwd: repoDir, stdio: 'ignore' })
    writeFileSync(join(repoDir, 'bar.md'), 'B\n')
    execSync('git add bar.md && git commit -m "cand-b"', { cwd: repoDir, stdio: 'ignore' })
    execSync('git checkout main', { cwd: repoDir, stdio: 'ignore' })

    const runDir = join(home, '.flt', 'runs', 'merge-best-gate')
    mkdirSync(join(runDir, 'results'), { recursive: true })
    const run = makeRun(home, 'merge-best-gate', runDir, repoDir)
    run.parallelGroups = {
      fanout: {
        candidates: [
          { label: 'b', agentName: 'fanout-b', preset: 'pi-coder', branch: 'flt/cand-b', worktree: repoDir },
        ],
        treatmentMap: {},
        allDone: false,
      },
    }
    saveWorkflowRun(run)

    writeFileSync(join(runDir, '.gate-decision'), JSON.stringify({ approved: true, candidate: 'b' }))

    const step: MergeBestStep = { type: 'merge_best', id: 'merge', candidate_var: 'fanout' }
    executeMergeBestStep({ name: 'wf', steps: [step] }, run, step)

    expect(readFileSync(join(repoDir, 'bar.md'), 'utf-8')).toBe('B\n')
    expect(readResult(runDir, 'merge').verdict).toBe('pass')

    rmSync(repoDir, { recursive: true, force: true })
  })

  it('fails when workflow dir is not a git repo', () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'flt-workflow-repo-'))
    initRepo(repoDir)
    const nonRepoDir = mkdtempSync(join(tmpdir(), 'flt-not-git-'))

    const runDir = join(home, '.flt', 'runs', 'merge-best-not-git')
    mkdirSync(join(runDir, 'results'), { recursive: true })
    const run = makeRun(home, 'merge-best-not-git', runDir, nonRepoDir)
    run.parallelGroups = {
      fanout: {
        candidates: [
          { label: 'a', agentName: 'fanout-a', preset: 'pi-coder', branch: 'flt/cand-a', worktree: repoDir },
        ],
        treatmentMap: {},
        allDone: false,
      },
    }
    saveWorkflowRun(run)

    writeFileSync(join(runDir, 'winner.json'), JSON.stringify({ winner: 'a' }))

    const step: MergeBestStep = { type: 'merge_best', id: 'merge', candidate_var: 'fanout' }
    executeMergeBestStep({ name: 'wf', steps: [step] }, run, step)

    const result = readResult(runDir, 'merge')
    expect(result.verdict).toBe('fail')
    expect(result.failReason).toContain('not a git repo')

    rmSync(repoDir, { recursive: true, force: true })
    rmSync(nonRepoDir, { recursive: true, force: true })
  })
})
