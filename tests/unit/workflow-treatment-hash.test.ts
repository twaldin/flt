import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createHash } from 'crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { setAgent } from '../../src/state'
import { computeTreatment } from '../../src/workflow/treatment'
import { _setSpawnFnForTest, loadWorkflowRun, saveWorkflowRun, startWorkflow } from '../../src/workflow/engine'
import type { WorkflowRun } from '../../src/workflow/types'

function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

function seedPreset(home: string): void {
  mkdirSync(join(home, '.flt'), { recursive: true })
  writeFileSync(join(home, '.flt', 'presets.json'), JSON.stringify({
    role: { cli: 'pi', model: 'gpt-5', soul: 'roles/dev.md', skills: ['lint'] },
    default: { cli: 'pi', model: 'gpt-5' },
  }))
}

describe('workflow treatment hashing', () => {
  let home = ''
  let prevHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'flt-treatment-'))
    prevHome = process.env.HOME
    process.env.HOME = home
    seedPreset(home)
  })

  afterEach(() => {
    _setSpawnFnForTest(null)
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  })

  it('computes stable hashes for role/skills/workflow', () => {
    mkdirSync(join(home, '.flt', 'roles'), { recursive: true })
    mkdirSync(join(home, '.flt', 'skills', 'lint'), { recursive: true })
    mkdirSync(join(home, '.flt', 'workflows'), { recursive: true })
    writeFileSync(join(home, '.flt', 'roles', 'dev.md'), 'ROLE')
    writeFileSync(join(home, '.flt', 'skills', 'lint', 'SKILL.md'), 'SKILL')
    writeFileSync(join(home, '.flt', 'workflows', 'wf.yaml'), 'name: wf\nsteps: []\n')

    const treatment = computeTreatment(
      { cli: 'pi', model: 'gpt-5', soul: 'roles/dev.md', skills: ['lint'] },
      join(home, '.flt', 'workflows', 'wf.yaml'),
    )

    expect(treatment.roleHash).toBe(sha('ROLE'))
    expect(treatment.skillHashes.lint).toBe(sha('SKILL'))
    expect(treatment.workflowHash).toBe(sha(readFileSync(join(home, '.flt', 'workflows', 'wf.yaml'), 'utf-8')))
  })

  it('uses empty-string hash when soul is unset and omits missing skills', () => {
    mkdirSync(join(home, '.flt', 'workflows'), { recursive: true })
    writeFileSync(join(home, '.flt', 'workflows', 'wf.yaml'), 'name: wf\nsteps: []\n')
    const treatment = computeTreatment(
      { cli: 'pi', model: 'gpt-5', skills: ['missing'] },
      join(home, '.flt', 'workflows', 'wf.yaml'),
    )
    expect(treatment.roleHash).toBe(sha(''))
    expect(treatment.skillHashes.missing).toBeUndefined()
  })

  it('hashes all skills when allSkills is true', () => {
    mkdirSync(join(home, '.flt', 'skills', 'a'), { recursive: true })
    mkdirSync(join(home, '.flt', 'skills', 'b'), { recursive: true })
    writeFileSync(join(home, '.flt', 'skills', 'a', 'SKILL.md'), 'A')
    writeFileSync(join(home, '.flt', 'skills', 'b', 'SKILL.md'), 'B')
    mkdirSync(join(home, '.flt', 'workflows'), { recursive: true })
    writeFileSync(join(home, '.flt', 'workflows', 'wf.yaml'), 'name: wf\nsteps: []\n')

    const treatment = computeTreatment({ cli: 'pi', model: 'gpt-5', allSkills: true }, join(home, '.flt', 'workflows', 'wf.yaml'))
    expect(Object.keys(treatment.skillHashes).sort()).toEqual(['a', 'b'])
  })

  it('survives round-trip in run.json candidate treatment', () => {
    const run: WorkflowRun = {
      id: 'r1',
      workflow: 'wf',
      currentStep: 'fanout',
      status: 'running',
      parentName: 'human',
      history: [],
      retries: {},
      vars: { _input: { task: '', dir: home } },
      startedAt: new Date().toISOString(),
      runDir: join(home, '.flt', 'runs', 'r1'),
      parallelGroups: {
        fanout: {
          candidates: [{
            label: 'a',
            agentName: 'r1-fanout-a',
            preset: 'role',
            treatment: { roleHash: 'x', skillHashes: { a: 'b' }, workflowHash: 'y' },
          }],
          treatmentMap: { a: 'role' },
          allDone: false,
        },
      },
    }
    saveWorkflowRun(run)
    const loaded = loadWorkflowRun('r1')
    expect(loaded?.parallelGroups?.fanout.candidates[0]?.treatment).toEqual(run.parallelGroups?.fanout.candidates[0]?.treatment)
  })

  it('wires treatment into parallel candidates and non-parallel vars', async () => {
    mkdirSync(join(home, '.flt', 'roles'), { recursive: true })
    mkdirSync(join(home, '.flt', 'skills', 'lint'), { recursive: true })
    mkdirSync(join(home, '.flt', 'workflows'), { recursive: true })
    writeFileSync(join(home, '.flt', 'roles', 'dev.md'), 'ROLE')
    writeFileSync(join(home, '.flt', 'skills', 'lint', 'SKILL.md'), 'SKILL')
    writeFileSync(join(home, '.flt', 'workflows', 'wf.yaml'), `name: wf\nsteps:\n  - id: fanout\n    type: parallel\n    n: 2\n    presets: [role, role]\n    step:\n      id: coder\n      preset: role\n      task: do work\n    on_complete: serial\n  - id: serial\n    preset: role\n    task: second\n    on_complete: done\n`)

    _setSpawnFnForTest(async args => {
      const dir = mkdtempSync(join(tmpdir(), `flt-agent-${args.name}-`))
      setAgent(args.name, {
        cli: 'pi',
        model: 'gpt-5',
        tmuxSession: `flt-${args.name}`,
        parentName: 'human',
        dir,
        worktreePath: dir,
        worktreeBranch: `flt/${args.name}`,
        spawnedAt: new Date().toISOString(),
      })
    })

    const run = await startWorkflow('wf', { dir: home })
    const loaded = loadWorkflowRun(run.id)
    const candidateTreatment = loaded?.parallelGroups?.fanout.candidates[0]?.treatment
    expect(candidateTreatment?.roleHash).toBe(sha('ROLE'))
    expect(candidateTreatment?.skillHashes.lint).toBe(sha('SKILL'))

    // Drive step completion to spawn serial step and persist vars.treatment
    const { writeResult } = await import('../../src/workflow/results')
    const { advanceWorkflow } = await import('../../src/workflow/engine')
    writeResult(loaded!.runDir!, 'fanout', 'a', 'pass')
    writeResult(loaded!.runDir!, 'fanout', 'b', 'pass')
    await advanceWorkflow(run.id)

    const after = loadWorkflowRun(run.id)
    const serialized = after?.vars.serial?.treatment
    expect(typeof serialized).toBe('string')
    const parsed = JSON.parse(serialized ?? '{}') as { roleHash?: string }
    expect(parsed.roleHash).toBe(sha('ROLE'))
  })
})
