import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { removeAgent, setAgent } from '../../src/state'
import {
  _setSpawnFnForTest,
  loadWorkflowRun,
  startWorkflow,
} from '../../src/workflow/engine'
import { workflowAdvance } from '../../src/commands/workflow'

function seedPresets(home: string): void {
  mkdirSync(join(home, '.flt'), { recursive: true })
  writeFileSync(join(home, '.flt', 'presets.json'), JSON.stringify({
    default: { cli: 'pi', model: 'gpt-5' },
    'pi-coder': { cli: 'pi', model: 'gpt-5' },
  }))
}

function writeWorkflow(home: string): void {
  const workflowsDir = join(home, '.flt', 'workflows')
  mkdirSync(workflowsDir, { recursive: true })
  writeFileSync(join(workflowsDir, 'wf-spawn.yaml'), `
name: wf-spawn
steps:
  - id: spec
    preset: pi-coder
    task: spec body
    on_complete: done
`)
}

function readActivityLog(home: string): string {
  const path = join(home, '.flt', 'activity.log')
  return existsSync(path) ? readFileSync(path, 'utf-8') : ''
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
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

describe('spawn-step recovery (issue #92)', () => {
  let home = ''
  let repo = ''
  let prevHome: string | undefined

  beforeEach(() => {
    // Tests use the deterministic workflow name "wf-spawn" so the runId is
    // "wf-spawn" and the agent name is "wf-spawn-spec". Wipe any leftover
    // worktree on disk from a prior test run.
    const stale = join(tmpdir(), 'flt-wt-wf-spawn-spec')
    if (existsSync(stale)) rmSync(stale, { recursive: true, force: true })

    home = mkdtempSync(join(tmpdir(), 'flt-spawn-step-'))
    repo = join(home, 'repo')
    mkdirSync(repo, { recursive: true })
    Bun.spawnSync(['git', 'init', '-b', 'main'], { cwd: repo })
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
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    rmSync(home, { recursive: true, force: true })
    const stale = join(tmpdir(), 'flt-wt-wf-spawn-spec')
    if (existsSync(stale)) rmSync(stale, { recursive: true, force: true })
  })

  it('drops a stale flt/<run>-<step> branch with no associated worktree before spawn', async () => {
    // Simulate the issue-#92 reproducer: a prior aborted run left an orphan
    // branch behind. createWorktree's existing branch-handling reuses such a
    // branch — but only if its tip is sane. The engine-level reconcile drops
    // it so the new spawn starts from a clean HEAD.
    git(repo, 'branch', 'flt/wf-spawn-spec', 'HEAD')
    expect(git(repo, 'rev-parse', '--verify', 'flt/wf-spawn-spec')).not.toBe('')

    let spawned = false
    _setSpawnFnForTest(async args => {
      spawned = true
      registerAgent(args, repo)
    })

    await startWorkflow('wf-spawn', { dir: repo })

    expect(spawned).toBe(true)
    const activity = readActivityLog(home)
    expect(activity).toContain('spawn-prep wf-spawn/spec: dropped stale branch')

    // Branch was deleted. Defensive — `git rev-parse --verify` would throw if
    // the ref disappeared, so use a noThrow-style probe.
    let branchAfter = ''
    try {
      branchAfter = git(repo, 'rev-parse', '--verify', 'flt/wf-spawn-spec')
    } catch {
      branchAfter = ''
    }
    expect(branchAfter).toBe('')
  })

  it('logs spawn-failed to activity.log and writes a fail result on spawn raise', async () => {
    _setSpawnFnForTest(async () => {
      throw new Error('synthetic spawn-pipeline failure')
    })

    await startWorkflow('wf-spawn', { dir: repo })

    const activity = readActivityLog(home)
    expect(activity).toContain('spawn-failed wf-spawn/spec')
    expect(activity).toContain('synthetic spawn-pipeline failure')

    // Step result reflects the failure rather than silently stalling.
    const stepResultPath = join(home, '.flt', 'runs', 'wf-spawn', 'results', 'spec-_.json')
    expect(existsSync(stepResultPath)).toBe(true)
    const result = JSON.parse(readFileSync(stepResultPath, 'utf-8')) as { verdict?: string; failReason?: string }
    expect(result.verdict).toBe('fail')
    expect(result.failReason).toContain('synthetic spawn-pipeline failure')

    // With no on_fail / no max_retries on this workflow, the run aborts.
    const loaded = loadWorkflowRun('wf-spawn')
    expect(loaded?.status).toBe('failed')
  })

  it('respawns when state says step is in-flight but no live agent exists (phantom advance)', async () => {
    let spawnCount = 0
    _setSpawnFnForTest(async args => {
      spawnCount += 1
      registerAgent(args, repo)
    })

    await startWorkflow('wf-spawn', { dir: repo })
    expect(spawnCount).toBe(1)

    // Simulate the phantom state: the controller thinks the spec step is
    // still running, but the agent has vanished (e.g. crashed without going
    // through the normal idle/kill path). Drop the agent record.
    removeAgent('wf-spawn-spec')

    await workflowAdvance('wf-spawn')

    expect(spawnCount).toBe(2)

    const activity = readActivityLog(home)
    expect(activity).toContain('reconcile wf-spawn/spec: no live agent for in-flight step')

    const loaded = loadWorkflowRun('wf-spawn')
    expect(loaded?.currentStep).toBe('spec')
    expect(loaded?.status).toBe('running')
  })
})
