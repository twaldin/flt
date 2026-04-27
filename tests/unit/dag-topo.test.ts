import { describe, expect, it } from 'bun:test'
import { topologicalReadyNodes } from '../../src/workflow/engine'
import type { DynamicDagState } from '../../src/workflow/types'

function state(): DynamicDagState {
  return {
    nodes: {
      a: { id: 'a', task: 'a', dependsOn: [], preset: 'p', parallel: 1, retries: 0, status: 'pending' },
      b: { id: 'b', task: 'b', dependsOn: [], preset: 'p', parallel: 1, retries: 0, status: 'pending' },
      c: { id: 'c', task: 'c', dependsOn: ['a', 'b'], preset: 'p', parallel: 1, retries: 0, status: 'pending' },
    },
    topoOrder: ['a', 'b', 'c'],
    integrationBranch: 'flt/int',
    integrationWorktree: '/tmp/int',
    skipped: [],
  }
}

describe('topologicalReadyNodes', () => {
  it('returns root nodes first', () => {
    expect(topologicalReadyNodes(state())).toEqual(['a', 'b'])
  })

  it('returns dep node only after all deps pass', () => {
    const s = state()
    s.nodes.a.status = 'passed'
    expect(topologicalReadyNodes(s)).toEqual(['b'])
    s.nodes.b.status = 'passed'
    expect(topologicalReadyNodes(s)).toEqual(['c'])
  })

  it('blocks nodes when deps failed or skipped', () => {
    const s = state()
    s.nodes.a.status = 'passed'
    s.nodes.b.status = 'failed'
    expect(topologicalReadyNodes(s)).toEqual([])
    s.nodes.b.status = 'skipped'
    expect(topologicalReadyNodes(s)).toEqual([])
  })
})
