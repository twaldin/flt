import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildWorkflowTreatment, permuteTreatmentMap } from '../../src/workflow/treatment'

describe('permuteTreatmentMap', () => {
  it('returns keys a.. and values as a permutation of presets', () => {
    const n = 4
    const presets = ['p1', 'p2', 'p3', 'p4']

    const result = permuteTreatmentMap(n, presets, 123)

    expect(Object.keys(result)).toEqual(['a', 'b', 'c', 'd'])
    expect(Object.values(result).slice().sort()).toEqual(presets.slice().sort())
  })

  it('is deterministic for the same inputs', () => {
    const n = 5
    const presets = ['a1', 'a2', 'a3', 'a4', 'a5']

    const first = permuteTreatmentMap(n, presets, 42)
    const second = permuteTreatmentMap(n, presets, 42)

    expect(second).toEqual(first)
  })

  it('produces variety across many seeds', () => {
    const n = 5
    const presets = ['a1', 'a2', 'a3', 'a4', 'a5']
    const orderings = new Set<string>()

    for (let seed = 0; seed < 100; seed += 1) {
      const mapped = permuteTreatmentMap(n, presets, seed)
      orderings.add(Object.values(mapped).join(','))
    }

    expect(orderings.size).toBeGreaterThanOrEqual(50)
  })

  it('throws when presets length does not equal n', () => {
    expect(() => permuteTreatmentMap(3, ['a', 'b'], 1)).toThrow('must equal n')
  })

  it('throws when n is 0', () => {
    expect(() => permuteTreatmentMap(0, [], 1)).toThrow()
  })

  it('throws when n is 27', () => {
    expect(() => permuteTreatmentMap(27, new Array(27).fill('x'), 1)).toThrow()
  })

  it('returns single item map for n=1', () => {
    expect(permuteTreatmentMap(1, ['only'], 99)).toEqual({ a: 'only' })
  })
})

describe('buildWorkflowTreatment', () => {
  let home = ''
  let previousHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'flt-treatment-hash-'))
    previousHome = process.env.HOME
    process.env.HOME = home

    mkdirSync(join(home, '.flt', 'roles'), { recursive: true })
    mkdirSync(join(home, '.flt', 'skills', 's1'), { recursive: true })
    mkdirSync(join(home, '.flt', 'workflows'), { recursive: true })

    writeFileSync(join(home, '.flt', 'roles', 'coder.md'), 'role content\n')
    writeFileSync(join(home, '.flt', 'skills', 's1', 'SKILL.md'), 'skill content\n')
    writeFileSync(join(home, '.flt', 'workflows', 'wf.yaml'), 'name: wf\nsteps:\n  - id: x\n    run: echo ok\n')
    writeFileSync(join(home, '.flt', 'presets.json'), JSON.stringify({
      p1: { cli: 'pi', model: 'gpt-5', soul: 'roles/coder.md', skills: ['s1'] },
    }))
  })

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  })

  it('hashes role, selected skills, and workflow yaml deterministically', () => {
    const first = buildWorkflowTreatment('wf', 'p1')
    const second = buildWorkflowTreatment('wf', 'p1')

    expect(first).toEqual(second)
    expect(first.roleHash).toMatch(/^[a-f0-9]{64}$/)
    expect(first.workflowHash).toMatch(/^[a-f0-9]{64}$/)
    expect(first.skillHashes.s1).toMatch(/^[a-f0-9]{64}$/)
  })
})
