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

describe('dynamic_dag spawn precheck against existing-agent state (issue #90)', () => {
  let home = ''
  let repo = ''
  let prevHome: string | undefined
  const cleanupDirs: string[] = []

  beforeEach(() => {
    _setMergeFnForTest(async (_repoDir, baseBranch) => ({
      branch: baseBranch,
      worktree: repo,
      conflicted: false,
    }))
    _setDagSpawnBackoffsForTest([0, 0, 0])

    home = mkdtempSync(join(tmpdir(), 'flt-dag-precheck-'))
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
    while (cleanupDirs.length > 0) {
      const d = cleanupDirs.pop()
      if (d && existsSync(d)) rmSync(d, { recursive: true, force: true })
    }
  })

  it('skips respawn when agent already alive in state with worktree on disk', async () => {
    writeFileSync(join(repo, 'plan.json'), JSON.stringify({
      default_preset: 'pi-coder',
      nodes: [{ id: 'a', task: 'a', depends_on: [] }],
    }))

    let coderAttempts = 0
    _setSpawnFnForTest(async args => {
      if (args.name.endsWith('-execute-a-coder')) {
        coderAttempts += 1
        if (coderAttempts === 1) {
          // Simulate a manual `flt workflow advance` having won the race:
          // agent registered + worktree dir on disk + exit before our spawn
          // pipeline records success. The retry loop's next attempt should
          // detect this state and skip without re-calling spawn.
          const raceDir = mkdtempSync(join(tmpdir(), 'flt-race-coder-'))
          cleanupDirs.push(raceDir)
          setAgent(args.name, {
            cli: 'pi',
            model: 'gpt-5',
            tmuxSession: `flt-${args.name}`,
            parentName: args.parent ?? 'human',
            dir: raceDir,
            worktreePath: raceDir,
            worktreeBranch: `flt/${args.name}`,
            spawnedAt: new Date().toISOString(),
            status: 'running',
          })
          throw new Error(`Agent "${args.name}" already exists.`)
        }
      }
      registerAgent(args, repo)
    })

    const run = await startWorkflow('wf-dag', { dir: repo })

    expect(coderAttempts).toBe(1)

    const stepResultPath = join(run.runDir, 'results', 'execute-_.json')
    expect(existsSync(stepResultPath)).toBe(false)

    const loaded = loadWorkflowRun(run.id)
    expect(loaded?.dynamicDagGroups?.execute?.nodes.a.status).toBe('running')
  })

  it('does NOT skip when pre-existing agent is exited (real respawn case)', async () => {
    writeFileSync(join(repo, 'plan.json'), JSON.stringify({
      default_preset: 'pi-coder',
      nodes: [{ id: 'a', task: 'a', depends_on: [] }],
    }))

    let coderAttempts = 0
    _setSpawnFnForTest(async args => {
      if (args.name.endsWith('-execute-a-coder')) {
        coderAttempts += 1
        if (coderAttempts === 1) {
          // Agent exists but was killed/exited — precheck must not skip;
          // the retry should attempt a real respawn.
          const exitedDir = mkdtempSync(join(tmpdir(), 'flt-exited-coder-'))
          cleanupDirs.push(exitedDir)
          setAgent(args.name, {
            cli: 'pi',
            model: 'gpt-5',
            tmuxSession: `flt-${args.name}`,
            parentName: args.parent ?? 'human',
            dir: exitedDir,
            worktreePath: exitedDir,
            worktreeBranch: `flt/${args.name}`,
            spawnedAt: new Date().toISOString(),
            status: 'exited',
          })
          throw new Error('synthetic spawn failure (exited agent path)')
        }
      }
      registerAgent(args, repo)
    })

    await startWorkflow('wf-dag', { dir: repo })

    expect(coderAttempts).toBe(2)
  })

  it('does NOT skip when agent in state but worktree dir absent (broken-state recovery)', async () => {
    writeFileSync(join(repo, 'plan.json'), JSON.stringify({
      default_preset: 'pi-coder',
      nodes: [{ id: 'a', task: 'a', depends_on: [] }],
    }))

    let coderAttempts = 0
    const ghostDir = join(tmpdir(), `flt-ghost-coder-${Date.now()}-${Math.random().toString(36).slice(2)}`)

    _setSpawnFnForTest(async args => {
      if (args.name.endsWith('-execute-a-coder')) {
        coderAttempts += 1
        if (coderAttempts === 1) {
          // Agent registered but worktreePath does NOT exist on disk —
          // typical broken-state-after-crash. Precheck must not skip; retry
          // attempts a fresh spawn.
          setAgent(args.name, {
            cli: 'pi',
            model: 'gpt-5',
            tmuxSession: `flt-${args.name}`,
            parentName: args.parent ?? 'human',
            dir: ghostDir,
            worktreePath: ghostDir,
            worktreeBranch: `flt/${args.name}`,
            spawnedAt: new Date().toISOString(),
            status: 'running',
          })
          throw new Error('synthetic spawn failure (no-worktree path)')
        }
      }
      registerAgent(args, repo)
    })

    await startWorkflow('wf-dag', { dir: repo })

    expect(coderAttempts).toBe(2)
    expect(existsSync(ghostDir)).toBe(false)
  })
})
