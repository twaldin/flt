import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'
import {
  _setSpawnFnForTest,
  saveWorkflowRun,
  startWorkflow,
  loadWorkflowRun,
} from '../../src/workflow/engine'
import { loadState, saveState } from '../../src/state'
import type { WorkflowRun } from '../../src/workflow/types'

function seedPresets(home: string): void {
  mkdirSync(join(home, '.flt'), { recursive: true })
  writeFileSync(join(home, '.flt', 'presets.json'), JSON.stringify({
    'pi-coder': { cli: 'pi', model: 'gpt-5' },
    A: { cli: 'pi', model: 'gpt-5' },
    B: { cli: 'pi', model: 'gpt-5' },
  }))
}

function writeWorkflow(home: string, name: string, yaml: string): void {
  const dir = join(home, '.flt', 'workflows')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.yaml`), yaml)
}

function makeGitRepo(dir: string): string {
  mkdirSync(dir, { recursive: true })
  execSync('git init', { cwd: dir })
  execSync('git config user.email "test@test.com"', { cwd: dir })
  execSync('git config user.name "Test"', { cwd: dir })
  writeFileSync(join(dir, 'README.md'), 'test')
  execSync('git add -A && git commit -m "init"', { cwd: dir, shell: true as unknown as string })
  return execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf-8' }).trim()
}

describe('workflow base SHA pinning', () => {
  let home = ''
  let repoDir = ''
  let previousHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'flt-base-sha-'))
    repoDir = join(home, 'repo')
    previousHome = process.env.HOME
    process.env.HOME = home
    seedPresets(home)
  })

  afterEach(() => {
    _setSpawnFnForTest(null)
    process.env.HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  })

  it('parallel step records baseSha equal to HEAD at step init', async () => {
    const headSha = makeGitRepo(repoDir)

    const spawnCalls: Array<{ name: string; worktreeBase?: string }> = []
    _setSpawnFnForTest(async args => {
      spawnCalls.push({ name: args.name, worktreeBase: (args as { worktreeBase?: string }).worktreeBase })
      const state = loadState()
      state.agents[args.name] = {
        cli: 'pi', model: 'gpt-5', tmuxSession: `flt-${args.name}`,
        parentName: 'human', dir: args.dir ?? home,
        worktreePath: args.dir ?? home, worktreeBranch: `flt/${args.name}`,
        spawnedAt: new Date().toISOString(),
      }
      saveState(state)
    })

    writeWorkflow(home, 'parallel-sha-wf', `
name: parallel-sha-wf
steps:
  - id: mutate
    type: parallel
    n: 2
    step:
      id: mutate-child
      preset: pi-coder
      dir: ${repoDir}
      worktree: true
      task: do work
    on_complete: done
`)

    const run = await startWorkflow('parallel-sha-wf', { dir: repoDir })
    const saved = loadWorkflowRun(run.id)

    expect(saved?.parallelGroups?.['mutate']?.baseSha).toBe(headSha)
  })

  it('parallel step spawns agents with worktreeBase set to baseSha', async () => {
    const headSha = makeGitRepo(repoDir)

    const spawnCalls: Array<{ worktreeBase?: string }> = []
    _setSpawnFnForTest(async args => {
      spawnCalls.push({ worktreeBase: (args as { worktreeBase?: string }).worktreeBase })
      const state = loadState()
      state.agents[args.name] = {
        cli: 'pi', model: 'gpt-5', tmuxSession: `flt-${args.name}`,
        parentName: 'human', dir: args.dir ?? home,
        worktreePath: args.dir ?? home, worktreeBranch: `flt/${args.name}`,
        spawnedAt: new Date().toISOString(),
      }
      saveState(state)
    })

    writeWorkflow(home, 'parallel-sha-wf2', `
name: parallel-sha-wf2
steps:
  - id: mutate
    type: parallel
    n: 2
    step:
      id: mutate-child
      preset: pi-coder
      dir: ${repoDir}
      worktree: true
      task: do work
    on_complete: done
`)

    await startWorkflow('parallel-sha-wf2', { dir: repoDir })

    expect(spawnCalls.length).toBe(2)
    for (const call of spawnCalls) {
      expect(call.worktreeBase).toBe(headSha)
    }
  })

  it('dynamic_dag step records baseSha equal to HEAD at step init', async () => {
    const headSha = makeGitRepo(repoDir)

    const planPath = join(home, 'plan.json')
    writeFileSync(planPath, JSON.stringify({
      default_preset: 'pi-coder',
      nodes: [{ id: 'node-a', task: 'do a' }],
    }))

    const spawnCalls: Array<{ name: string }> = []
    _setSpawnFnForTest(async args => {
      spawnCalls.push({ name: args.name })
      const state = loadState()
      state.agents[args.name] = {
        cli: 'pi', model: 'gpt-5', tmuxSession: `flt-${args.name}`,
        parentName: 'human', dir: args.dir ?? home,
        worktreePath: args.dir ?? home, worktreeBranch: `flt/${args.name}`,
        spawnedAt: new Date().toISOString(),
      }
      saveState(state)
    })

    writeWorkflow(home, 'dag-sha-wf', `
name: dag-sha-wf
steps:
  - id: execute
    type: dynamic_dag
    plan_from: ${planPath}
    on_complete: done
    on_fail: abort
`)

    const run = await startWorkflow('dag-sha-wf', { dir: repoDir })
    const saved = loadWorkflowRun(run.id)

    expect(saved?.dynamicDagGroups?.['execute']?.baseSha).toBe(headSha)
  })
})
