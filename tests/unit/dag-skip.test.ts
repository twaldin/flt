import { describe, expect, it } from 'bun:test'
import { transitiveDependents } from '../../src/workflow/engine'
import type { DynamicDagState } from '../../src/workflow/types'

const base: DynamicDagState = {
  nodes: {
    a: { id: 'a', task: 'a', dependsOn: [], preset: 'p', parallel: 1, retries: 0, status: 'pending' },
    b: { id: 'b', task: 'b', dependsOn: ['a'], preset: 'p', parallel: 1, retries: 0, status: 'pending' },
    c: { id: 'c', task: 'c', dependsOn: ['a', 'b'], preset: 'p', parallel: 1, retries: 0, status: 'pending' },
    d: { id: 'd', task: 'd', dependsOn: ['c'], preset: 'p', parallel: 1, retries: 0, status: 'pending' },
  },
  topoOrder: ['a', 'b', 'c', 'd'],
  integrationBranch: 'flt/int',
  integrationWorktree: '/tmp/int',
  skipped: [],
}

describe('transitiveDependents', () => {
  it('walks dependency bfs', () => {
    expect([...transitiveDependents(base, 'a')].sort()).toEqual(['b', 'c', 'd'])
    expect([...transitiveDependents(base, 'b')].sort()).toEqual(['c', 'd'])
    expect([...transitiveDependents(base, 'd')]).toEqual([])
  })
})
