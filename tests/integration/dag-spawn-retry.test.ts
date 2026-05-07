import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { setAgent } from '../../src/state'
import {
  _setDagSpawnBackoffsForTest,
  _setMergeFnForTest,
  _setSpawnFnForTest,
  loadWorkflowRun,
  startWorkflow,
} from '../../src/workflow/engine'

function seedPresets(home: string): void {
  mkdirSync(join(home, '.flt'), { recursive: true })
  writeFileSync(join(home, '.flt', 'presets.json'), JSON.stringify({
    default: { cli: 'pi', model: 'gpt-5' },
    'pi-coder': { cli: 'pi', model: 'gpt-5' },
    'cc-evaluator': { cli: 'pi', model: 'gpt-5' },
  }))
}

function writeWorkflow(home: string): void {
  const workflowsDir = join(home, '.flt', 'workflows')
  mkdirSync(workflowsDir, { recursive: true })
  writeFileSync(join(workflowsDir, 'wf-dag.yaml'), `
name: wf-dag
steps:
  - id: execute
    type: dynamic_dag
    plan_from: '{dir}/plan.json'
    reconciler:
      preset: cc-evaluator
      task: reconcile
    on_complete: done
`)
}

function readActivityLog(home: string): string {
  const path = join(home, '.flt', 'activity.log')
  return existsSync(path) ? readFileSync(path, 'utf-8') : ''
}

function registerAgent(args: { name: string; parent?: string; dir?: string }, repo: string): void {
  setAgent(args.name, {
    cli: 'pi',
    model: 'gpt-5',
    tmuxSession: `flt-${args.name}`,
    parentName: args.parent ?? 'human',
    dir: args.dir ?? repo,
    worktreePath: args.dir ?? repo,
    worktreeBranch: `flt/${args.name}`,
    spawnedAt: new Date().toISOString(),
  })
}

describe('dynamic_dag spawn retry + plan reread (issue #87)', () => {
  let home = ''
  let repo = ''
  let prevHome: string | undefined

  beforeEach(() => {
    _setMergeFnForTest(async (_repoDir, baseBranch) => ({
      branch: baseBranch,
      worktree: repo,
      conflicted: false,
    }))
    _setDagSpawnBackoffsForTest([0, 0, 0])

    for (const id of ['a', 'b']) {
      const stale = join(tmpdir(), `flt-wt-wf-dag-execute-${id}-coder`)
      if (existsSync(stale)) rmSync(stale, { recursive: true, force: true })
    }
    const staleIntegration = join(tmpdir(), 'flt-wt-wf-dag-execute-integration')
    if (existsSync(staleIntegration)) rmSync(staleIntegration, { recursive: true, force: true })

    home = mkdtempSync(join(tmpdir(), 'flt-dag-retry-'))
    repo = join(home, 'repo')
    mkdirSync(repo, { recursive: true })
    Bun.spawnSync(['git', 'init'], { cwd: repo })
    Bun.spawnSync(['git', 'config', 'user.email', 'test@example.com'], { cwd: repo })
    Bun.spawnSync(['git', 'config', 'user.name', 'test'], { cwd: repo })
    writeFileSync(join(repo, 'README.md'), 'x\n')
    Bun.spawnSync(['git', 'add', '.'], { cwd: repo })
    Bun.spawnSync(['git', 'commit', '-m', 'init'], { cwd: repo })

    prevHome = process.env.HOME
    process.env.HOME = home
    seedPresets(home)
    writeWorkflow(home)
  })

  afterEach(() => {
    _setSpawnFnForTest(null)
    _setMergeFnForTest(null)
    _setDagSpawnBackoffsForTest(null)
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  })

  it('retries dag-spawn on transient failure and writes error event to activity.log', async () => {
    writeFileSync(join(repo, 'plan.json'), JSON.stringify({
      default_preset: 'pi-coder',
      nodes: [{ id: 'a', task: 'a', depends_on: [] }],
    }))

    const spawnNames: string[] = []
    let coderAttempts = 0
    _setSpawnFnForTest(async args => {
      spawnNames.push(args.name)
      if (args.name.endsWith('-execute-a-coder')) {
        coderAttempts += 1
        if (coderAttempts === 1) {
          throw new Error('synthetic worktree-setup failure')
        }
      }
      registerAgent(args, repo)
    })

    const run = await startWorkflow('wf-dag', { dir: repo })

    expect(coderAttempts).toBe(2)
    expect(spawnNames.filter(n => n.endsWith('-execute-a-coder')).length).toBe(2)

    const activity = readActivityLog(home)
    expect(activity).toContain('dag-spawn')
    expect(activity).toContain('synthetic worktree-setup failure')
    expect(activity).toContain(`${run.id}/execute/a`)

    const loaded = loadWorkflowRun(run.id)
    expect(loaded?.dynamicDagGroups?.execute?.nodes.a.status).toBe('running')
  })

  it('fails the step after max retries instead of silent stall', async () => {
    writeFileSync(join(repo, 'plan.json'), JSON.stringify({
      default_preset: 'pi-coder',
      nodes: [{ id: 'a', task: 'a', depends_on: [] }],
    }))

    let coderAttempts = 0
    _setSpawnFnForTest(async args => {
      if (args.name.endsWith('-execute-a-coder')) {
        coderAttempts += 1
        throw new Error('persistent failure')
      }
      registerAgent(args, repo)
    })

    const run = await startWorkflow('wf-dag', { dir: repo })

    expect(coderAttempts).toBe(3)

    const stepResultPath = join(run.runDir, 'results', 'execute-_.json')
    expect(existsSync(stepResultPath)).toBe(true)
    const result = JSON.parse(readFileSync(stepResultPath, 'utf-8')) as { verdict?: string; failReason?: string }
    expect(result.verdict).toBe('fail')
    expect(result.failReason).toContain('persistent failure')
    expect(result.failReason).toContain('3 attempts')
  })

  it('re-reads plan.json each attempt and follows nodeId rename across retries', async () => {
    writeFileSync(join(repo, 'plan.json'), JSON.stringify({
      default_preset: 'pi-coder',
      nodes: [{ id: 'a', task: 'task-a', depends_on: [] }],
    }))

    const spawnNames: string[] = []
    let firstACoderSeen = false
    _setSpawnFnForTest(async args => {
      if (args.name.endsWith('-execute-a-coder') && !firstACoderSeen) {
        firstACoderSeen = true
        // Simulate a re-prodded planner rewriting plan.json with a renamed
        // first-pending node, then the spawn pipeline failing.
        writeFileSync(join(repo, 'plan.json'), JSON.stringify({
          default_preset: 'pi-coder',
          nodes: [{ id: 'b', task: 'task-b', depends_on: [] }],
        }))
        throw new Error('synthetic spawn failure mid-rename')
      }
      spawnNames.push(args.name)
      registerAgent(args, repo)
    })

    const run = await startWorkflow('wf-dag', { dir: repo })

    expect(spawnNames.some(n => n.endsWith('-execute-b-coder'))).toBe(true)
    expect(spawnNames.some(n => n.endsWith('-execute-a-coder'))).toBe(false)

    const loaded = loadWorkflowRun(run.id)
    expect(loaded?.dynamicDagGroups?.execute?.nodes.a).toBeUndefined()
    expect(loaded?.dynamicDagGroups?.execute?.nodes.b?.status).toBe('running')

    const activity = readActivityLog(home)
    expect(activity).toContain('node dropped from plan')
  })
})
