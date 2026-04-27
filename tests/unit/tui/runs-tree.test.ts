import { describe, expect, it } from 'bun:test'
import { buildRunsTree, type RunJson } from '../../../src/tui/metrics-modal'
import type { ArchiveEntry } from '../../../src/metrics'

function archive(name: string, spawnedAt: string, cost = 1): ArchiveEntry {
  return {
    name,
    cli: 'cli',
    model: 'model',
    dir: '/tmp',
    spawnedAt,
    killedAt: spawnedAt,
    cost_usd: cost,
    tokens_in: 10,
    tokens_out: 9,
    actualModel: null,
  }
}

describe('buildRunsTree', () => {
  it('renders single archive as root', () => {
    const rows = buildRunsTree([archive('agent-a', '2026-01-01T00:00:00Z')], [], {}, 'human')
    expect(rows.map(r => `${r.connector}${r.label}`)).toEqual(['human', 'agent-a'])
  })

  it('nests workflow agents and recursive sub-agents', () => {
    const archives = [
      archive('wf-a-step1', '2026-01-01T01:00:00Z', 3),
      archive('wf-a-step2', '2026-01-01T02:00:00Z', 2),
      archive('wf-a-sub', '2026-01-01T03:00:00Z', 1),
    ]
    const runs: RunJson[] = [{
      id: 'run-1',
      workflow: 'idea-to-pr',
      parentName: 'human',
      history: [{ agent: 'wf-a-step1' }, { agent: 'wf-a-step2' }],
    }]
    const parents = { 'wf-a-sub': 'wf-a-step1' }

    const rows = buildRunsTree(archives, runs, parents, 'human')
    const labels = rows.map(r => `${r.continuation}${r.connector}${r.label}`)
    expect(labels).toContain('   └─ idea-to-pr')
    expect(labels).toContain('   │  ├─ wf-a-step2')
    expect(labels).toContain('      └─ wf-a-step1')
    expect(labels).toContain('         └─ wf-a-sub')
  })

  it('floats orphan archives as separate roots', () => {
    const archives = [
      archive('wf-a-step1', '2026-01-01T01:00:00Z', 3),
      archive('orphan', '2026-01-01T05:00:00Z', 1),
    ]
    const runs: RunJson[] = [{
      id: 'run-1',
      workflow: 'idea-to-pr',
      parentName: 'human',
      history: [{ agent: 'wf-a-step1' }],
    }]

    const rows = buildRunsTree(archives, runs, {}, 'human')
    const roots = rows.filter(r => r.depth === 0).map(r => r.label)
    expect(roots).toContain('human')
    expect(roots).toContain('orphan')
  })

  it('does not loop forever on parent cycles', () => {
    const archives = [archive('a', '2026-01-01T00:00:00Z'), archive('b', '2026-01-01T00:00:01Z')]
    const rows = buildRunsTree(archives, [], { a: 'b', b: 'a' }, 'human')
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(rows.some(r => r.label === 'a')).toBe(true)
    expect(rows.some(r => r.label === 'b')).toBe(true)
  })
})
