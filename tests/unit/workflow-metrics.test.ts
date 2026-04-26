import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { execSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { appendEvent } from '../../src/activity'
import { _setSpawnFnForTest, cancelWorkflow, loadWorkflowRun, startWorkflow } from '../../src/workflow/engine'
import { buildMetrics } from '../../src/workflow/metrics'
import { writeResult } from '../../src/workflow/results'
import type { WorkflowRun } from '../../src/workflow/types'

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

describe('workflow metrics', () => {
  let home = ''
  let previousHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'flt-workflow-metrics-'))
    previousHome = process.env.HOME
    process.env.HOME = home
  })

  afterEach(() => {
    _setSpawnFnForTest(null)
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  })

  it('buildMetrics happy path populates scores, cost, patch and empty blockers', () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'flt-workflow-metrics-repo-'))
    execSync('git init', { cwd: repoDir, stdio: 'ignore' })
    execSync('git config user.email "test@example.com"', { cwd: repoDir, stdio: 'ignore' })
    execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'ignore' })
    writeFileSync(join(repoDir, 'demo.txt'), 'a\nb\nc\n')
    execSync('git add demo.txt && git commit -m init', { cwd: repoDir, stdio: 'ignore' })
    const startBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim()
    writeFileSync(join(repoDir, 'demo.txt'), 'a\nB\nc\nd\n')

    const runDir = mkdtempSync(join(tmpdir(), 'flt-workflow-metrics-run-'))
    writeResult(runDir, 'tests', '_', 'pass')
    writeResult(runDir, 'lint', '_', 'pass')

    const run: WorkflowRun = {
      id: 'run-happy',
      workflow: 'wf',
      currentStep: 'tests',
      status: 'completed',
      parentName: 'human',
      history: [],
      retries: {},
      vars: { _input: { task: 'task', dir: repoDir } },
      startedAt: '2026-04-26T10:00:00.000Z',
      completedAt: '2026-04-26T10:00:10.000Z',
      runDir,
      startBranch,
    }

    appendEvent({ type: 'kill', agent: 'run-happy-tests', detail: 'killed', at: '2026-04-26T10:00:05.000Z', cost_usd: 0.12, tokens_in: 100, tokens_out: 50 })
    appendEvent({ type: 'kill', agent: 'other-run-tests', detail: 'killed', at: '2026-04-26T10:00:05.000Z', cost_usd: 1.2, tokens_in: 999, tokens_out: 999 })

    const metrics = buildMetrics(run, repoDir)
    expect(metrics.outcome).toBe('completed')
    expect(metrics.scores).toEqual({ tests: 'pass', lint: 'pass' })
    expect(metrics.cost).toEqual({ usd: 0.12, tokensIn: 100, tokensOut: 50 })
    expect(metrics.time.wallSeconds).toBe(10)
    expect(metrics.patch).toEqual({ filesChanged: 1, linesAdded: 2, linesDeleted: 1 })
    expect(metrics.blockers).toEqual([])

    rmSync(repoDir, { recursive: true, force: true })
    rmSync(runDir, { recursive: true, force: true })
  })

  it('buildMetrics failed run collects blockers from failed results', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'flt-workflow-metrics-fail-'))
    writeResult(runDir, 'reviewer', '_', 'fail', 'missing tests')
    writeResult(runDir, 'e2e', '_', 'fail', 'broken login')

    const run: WorkflowRun = {
      id: 'run-failed',
      workflow: 'wf',
      currentStep: 'reviewer',
      status: 'failed',
      parentName: 'human',
      history: [],
      retries: {},
      vars: { _input: { task: 'task', dir: home } },
      startedAt: '2026-04-26T10:00:00.000Z',
      completedAt: '2026-04-26T10:00:08.000Z',
      runDir,
      startBranch: '',
    }

    const metrics = buildMetrics(run, home)
    expect(metrics.outcome).toBe('failed')
    expect(metrics.blockers).toEqual(['broken login', 'missing tests'])

    rmSync(runDir, { recursive: true, force: true })
  })

  it('buildMetrics cancelled run with empty startBranch sets patch zeros', () => {
    const run: WorkflowRun = {
      id: 'run-cancelled',
      workflow: 'wf',
      currentStep: 'coder',
      status: 'cancelled',
      parentName: 'human',
      history: [],
      retries: {},
      vars: { _input: { task: 'task', dir: home } },
      startedAt: '2026-04-26T10:00:00.000Z',
      completedAt: '2026-04-26T10:00:08.000Z',
      runDir: join(home, 'missing-run-dir'),
      startBranch: '',
    }

    const metrics = buildMetrics(run, home)
    expect(metrics.outcome).toBe('cancelled')
    expect(metrics.patch).toEqual({ filesChanged: 0, linesAdded: 0, linesDeleted: 0 })
  })

  it('buildMetrics with missing results dir returns empty scores', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'flt-workflow-metrics-empty-'))
    const run: WorkflowRun = {
      id: 'run-empty',
      workflow: 'wf',
      currentStep: 'coder',
      status: 'completed',
      parentName: 'human',
      history: [],
      retries: {},
      vars: { _input: { task: 'task', dir: home } },
      startedAt: '2026-04-26T10:00:00.000Z',
      completedAt: '2026-04-26T10:00:08.000Z',
      runDir,
      startBranch: '',
    }

    const metrics = buildMetrics(run, home)
    expect(metrics.scores).toEqual({})
    expect(metrics.blockers).toEqual([])

    rmSync(runDir, { recursive: true, force: true })
  })

  it('engine writes metrics.json for completed, failed, and cancelled terminal states', async () => {
    seedPresets(home)

    writeWorkflow(home, 'wf-complete', `
name: wf-complete
steps:
  - id: shell
    run: "true"
`)

    const completed = await startWorkflow('wf-complete', { dir: home })
    const completedRun = loadWorkflowRun(completed.id)
    expect(completedRun?.status).toBe('completed')

    const completedMetricsPath = join(completedRun!.runDir!, 'metrics.json')
    const completedRunPath = join(completedRun!.runDir!, 'run.json')
    expect(existsSync(completedMetricsPath)).toBe(true)
    expect(statSync(completedMetricsPath).mtimeMs).toBeLessThanOrEqual(statSync(completedRunPath).mtimeMs)
    expect(JSON.parse(readFileSync(completedMetricsPath, 'utf-8')).outcome).toBe('completed')

    writeWorkflow(home, 'wf-fail', `
name: wf-fail
steps:
  - id: shell
    run: "false"
`)

    const failed = await startWorkflow('wf-fail', { dir: home })
    const failedRun = loadWorkflowRun(failed.id)
    expect(failedRun?.status).toBe('failed')
    expect(JSON.parse(readFileSync(join(failedRun!.runDir!, 'metrics.json'), 'utf-8')).outcome).toBe('failed')

    _setSpawnFnForTest(async () => {})
    writeWorkflow(home, 'wf-cancel', `
name: wf-cancel
steps:
  - id: coder
    preset: pi-coder
    task: do it
`)

    const running = await startWorkflow('wf-cancel', { dir: home })
    await cancelWorkflow(running.id)
    const cancelledRun = loadWorkflowRun(running.id)
    expect(cancelledRun?.status).toBe('cancelled')
    const cancelledMetrics = JSON.parse(readFileSync(join(cancelledRun!.runDir!, 'metrics.json'), 'utf-8'))
    expect(cancelledMetrics.outcome).toBe('cancelled')
    expect(cancelledMetrics.patch).toEqual({ filesChanged: 0, linesAdded: 0, linesDeleted: 0 })
  })
})
