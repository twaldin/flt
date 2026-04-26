import { describe, expect, it } from 'bun:test'
import { permuteTreatmentMap } from '../../src/workflow/treatment'

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
