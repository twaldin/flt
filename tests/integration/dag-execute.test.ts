import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { setAgent } from '../../src/state'
import { _setSpawnFnForTest, advanceWorkflow, loadWorkflowRun, startWorkflow } from '../../src/workflow/engine'
import { writeResult } from '../../src/workflow/results'

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

describe('dynamic dag execute', () => {
  let home = ''
  let repo = ''
  let prevHome: string | undefined

  beforeEach(() => {
    const stale = join(tmpdir(), 'flt-wt-wf-dag-execute-integration')
    if (existsSync(stale)) rmSync(stale, { recursive: true, force: true })
    home = mkdtempSync(join(tmpdir(), 'flt-dag-int-'))
    repo = join(home, 'repo')
    mkdirSync(repo, { recursive: true })
    Bun.spawnSync(['git', 'init'], { cwd: repo })
    Bun.spawnSync(['git', 'config', 'user.email', 'test@example.com'], { cwd: repo })
    Bun.spawnSync(['git', 'config', 'user.name', 'test'], { cwd: repo })
    writeFileSync(join(repo, 'README.md'), 'x\n')
    Bun.spawnSync(['git', 'add', '.'], { cwd: repo })
    Bun.spawnSync(['git', 'commit', '-m', 'init'], { cwd: repo })

    writeFileSync(join(repo, 'plan.json'), JSON.stringify({
      default_preset: 'pi-coder',
      nodes: [
        { id: 'a', task: 'a', depends_on: [] },
        { id: 'b', task: 'b', depends_on: [] },
        { id: 'c', task: 'c', depends_on: ['a', 'b'] },
      ],
    }))

    prevHome = process.env.HOME
    process.env.HOME = home
    seedPresets(home)
    writeWorkflow(home)
  })

  afterEach(() => {
    _setSpawnFnForTest(null)
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  })

  it('runs roots, deps, then reconciler', async () => {
    const spawns: string[] = []
    _setSpawnFnForTest(async args => {
      spawns.push(args.name)
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
    })

    const run = await startWorkflow('wf-dag', { dir: repo })

    expect(spawns.some(s => s.endsWith('-execute-a-coder'))).toBe(true)
    expect(spawns.some(s => s.endsWith('-execute-b-coder'))).toBe(true)

    writeResult(run.runDir!, 'execute', 'a-coder', 'pass')
    await advanceWorkflow(run.id, `${run.id}-execute-a-coder`)
    writeResult(run.runDir!, 'execute', 'a-reviewer', 'pass')
    await advanceWorkflow(run.id, `${run.id}-execute-a-reviewer`)

    writeResult(run.runDir!, 'execute', 'b-coder', 'pass')
    await advanceWorkflow(run.id, `${run.id}-execute-b-coder`)
    writeResult(run.runDir!, 'execute', 'b-reviewer', 'pass')
    await advanceWorkflow(run.id, `${run.id}-execute-b-reviewer`)

    expect(spawns.some(s => s.endsWith('-execute-c-coder'))).toBe(true)

    writeResult(run.runDir!, 'execute', 'c-coder', 'pass')
    await advanceWorkflow(run.id, `${run.id}-execute-c-coder`)
    writeResult(run.runDir!, 'execute', 'c-reviewer', 'pass')
    await advanceWorkflow(run.id, `${run.id}-execute-c-reviewer`)

    expect(spawns.some(s => s.endsWith('-execute-reconcile'))).toBe(true)

    writeResult(run.runDir!, 'execute', '_', 'pass')
    await advanceWorkflow(run.id, `${run.id}-execute-reconcile`)

    const loaded = loadWorkflowRun(run.id)
    expect(loaded?.status).toBe('completed')
    expect(loaded?.vars.execute.branch?.startsWith('flt/')).toBe(true)
  })
})
