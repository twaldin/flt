import { describe, expect, it } from 'bun:test'
import { validatePlan } from '../../src/workflow/engine'

describe('validatePlan', () => {
  it('rejects cycles with exact reason format', () => {
    const result = validatePlan({
      nodes: [
        { id: 'a', task: 'a', depends_on: ['b'] },
        { id: 'b', task: 'b', depends_on: ['a'] },
      ],
    }, { max_nodes: 12, max_depth: 5 })

    expect(result).toEqual({ ok: false, reason: 'cycle: a→b→a' })
  })

  it('rejects duplicates and missing deps', () => {
    expect(validatePlan({
      nodes: [
        { id: 'a', task: 'a' },
        { id: 'a', task: 'dup' },
      ],
    }, { max_nodes: 12, max_depth: 5 })).toEqual({ ok: false, reason: 'duplicate node id: a' })

    expect(validatePlan({
      nodes: [{ id: 'a', task: 'a', depends_on: ['ghost'] }],
    }, { max_nodes: 12, max_depth: 5 })).toEqual({ ok: false, reason: 'missing dep: a.depends_on contains unknown id ghost' })
  })

  it('rejects caps and invalid ids', () => {
    expect(validatePlan({
      nodes: Array.from({ length: 13 }, (_, i) => ({ id: `n${i}`, task: 'x' })),
    }, { max_nodes: 12, max_depth: 10 })).toEqual({ ok: false, reason: 'too many nodes: 13 > max_nodes(12)' })

    expect(validatePlan({
      nodes: [
        { id: 'a', task: 'a' },
        { id: 'b', task: 'b', depends_on: ['a'] },
        { id: 'c', task: 'c', depends_on: ['b'] },
        { id: 'd', task: 'd', depends_on: ['c'] },
        { id: 'e', task: 'e', depends_on: ['d'] },
        { id: 'f', task: 'f', depends_on: ['e'] },
      ],
    }, { max_nodes: 12, max_depth: 5 })).toEqual({ ok: false, reason: 'depth exceeded: 6 > max_depth(5)' })

    expect(validatePlan({
      nodes: [{ id: 'a.b', task: 'bad' }],
    }, { max_nodes: 12, max_depth: 5 })).toEqual({ ok: false, reason: 'invalid node id: a.b' })
  })
})
