import { describe, expect, it } from 'bun:test'
import { aggregateRuns, type ArchiveEntry } from '../../src/metrics'

const NOW = new Date(2026, 3, 26, 12, 0, 0, 0).getTime()

function isoOffset(msOffset: number): string {
  return new Date(NOW + msOffset).toISOString()
}

function entry(overrides: Partial<ArchiveEntry> = {}): ArchiveEntry {
  return {
    name: 'idea-to-pr-3-coder',
    cli: 'pi',
    model: 'sonnet',
    dir: '/tmp/x',
    spawnedAt: isoOffset(-60 * 60 * 1000),
    killedAt: isoOffset(-30 * 60 * 1000),
    cost_usd: 1,
    tokens_in: 100,
    tokens_out: 200,
    actualModel: 'claude-sonnet-4-6',
    ...overrides,
  }
}

describe('metrics aggregateRuns', () => {
  it('returns zero totals and zeroed sparkline for empty input', () => {
    const result = aggregateRuns([], { period: 'today', groupBy: 'model', now: NOW })
    expect(result.rows).toEqual([])
    expect(result.total).toEqual({ label: 'TOTAL', cost: 0, tokensIn: 0, tokensOut: 0, runs: 0, avgCost: 0 })
    // today period uses 24 hourly buckets; other periods use different bucket counts.
    expect(result.sparkline24h).toHaveLength(24)
    expect(result.sparklineUnit).toBe('1h')
    expect(result.sparkline24h.every(v => v === 0)).toBe(true)
  })

  it('filters by today', () => {
    const sameDay = entry({ spawnedAt: isoOffset(-2 * 60 * 60 * 1000), cost_usd: 2 })
    const yesterday = entry({ spawnedAt: isoOffset(-26 * 60 * 60 * 1000), cost_usd: 7 })
    const result = aggregateRuns([sameDay, yesterday], { period: 'today', groupBy: 'agent', now: NOW })
    expect(result.total.runs).toBe(1)
    expect(result.total.cost).toBe(2)
  })

  it('filters by week and month', () => {
    const sixDays = entry({ spawnedAt: isoOffset(-6 * 24 * 60 * 60 * 1000), cost_usd: 1 })
    const eightDays = entry({ spawnedAt: isoOffset(-8 * 24 * 60 * 60 * 1000), cost_usd: 2 })
    const twentyFive = entry({ spawnedAt: isoOffset(-25 * 24 * 60 * 60 * 1000), cost_usd: 3 })
    const thirtyFive = entry({ spawnedAt: isoOffset(-35 * 24 * 60 * 60 * 1000), cost_usd: 4 })

    const week = aggregateRuns([sixDays, eightDays], { period: 'week', groupBy: 'agent', now: NOW })
    expect(week.total.runs).toBe(1)
    expect(week.total.cost).toBe(1)

    const month = aggregateRuns([twentyFive, thirtyFive], { period: 'month', groupBy: 'agent', now: NOW })
    expect(month.total.runs).toBe(1)
    expect(month.total.cost).toBe(3)
  })

  it('period all keeps all entries', () => {
    const result = aggregateRuns([
      entry({ cost_usd: 1 }),
      entry({ spawnedAt: isoOffset(-90 * 24 * 60 * 60 * 1000), cost_usd: 9 }),
    ], { period: 'all', groupBy: 'agent', now: NOW })
    expect(result.total.runs).toBe(2)
    expect(result.total.cost).toBe(10)
  })

  it('groups by model with fallback', () => {
    const result = aggregateRuns([
      entry({ actualModel: 'claude-opus-4-7', cost_usd: 4 }),
      entry({ name: 'idea-to-pr-3-reviewer', actualModel: 'claude-opus-4-7', cost_usd: 2 }),
      entry({ name: 'idea-to-pr-3-verifier', actualModel: null, model: 'sonnet', cost_usd: 1 }),
    ], { period: 'all', groupBy: 'model', now: NOW })

    expect(result.rows.map(r => r.label)).toEqual(['claude-opus-4-7', 'sonnet'])
    expect(result.rows[0]).toMatchObject({ runs: 2, cost: 6 })
  })

  it('groups by workflow and uses unknown fallback', () => {
    const result = aggregateRuns([
      entry({ name: 'idea-to-pr-3-spec', cost_usd: 1 }),
      entry({ name: 'idea-to-pr-3-architect', cost_usd: 2 }),
      entry({ name: 'code-and-review-2-coder', cost_usd: 3 }),
      entry({ name: 'lonely-agent', cost_usd: 4 }),
    ], { period: 'all', groupBy: 'workflow', now: NOW })

    expect(result.rows.map(r => r.label)).toEqual(['(unknown)', 'code-and-review', 'idea-to-pr'])
    const idea = result.rows.find(r => r.label === 'idea-to-pr')
    expect(idea).toMatchObject({ runs: 2, cost: 3 })
  })

  it('groups by agent one row per unique name', () => {
    const result = aggregateRuns([
      entry({ name: 'a', cost_usd: 1 }),
      entry({ name: 'a', cost_usd: 2 }),
      entry({ name: 'b', cost_usd: 3 }),
    ], { period: 'all', groupBy: 'agent', now: NOW })

    expect(result.rows).toHaveLength(2)
    expect(result.rows[0].label).toBe('a')
    expect(result.rows[0].runs).toBe(2)
  })

  it('computes totals and avgCost', () => {
    const result = aggregateRuns([
      entry({ cost_usd: 1 }),
      entry({ name: 'b', cost_usd: 2 }),
      entry({ name: 'c', cost_usd: 3 }),
    ], { period: 'all', groupBy: 'agent', now: NOW })

    expect(result.total.cost).toBe(6)
    expect(result.total.runs).toBe(3)
    expect(result.total.avgCost).toBe(2)
  })

  it('treats null numerics as zero while keeping run count', () => {
    const result = aggregateRuns([
      entry({ cost_usd: null, tokens_in: null, tokens_out: null }),
    ], { period: 'all', groupBy: 'agent', now: NOW })

    expect(result.total).toMatchObject({ cost: 0, tokensIn: 0, tokensOut: 0, runs: 1, avgCost: 0 })
  })

  it('assigns sparkline buckets by hour and ignores out-of-range values', () => {
    const result = aggregateRuns([
      entry({ spawnedAt: isoOffset(-(1 * 60 * 60 * 1000 + 60 * 1000)), cost_usd: 1 }),
      entry({ spawnedAt: isoOffset(-(5 * 60 * 60 * 1000 + 60 * 1000)), cost_usd: 2 }),
      entry({ spawnedAt: isoOffset(-(23 * 60 * 60 * 1000 + 60 * 1000)), cost_usd: 3 }),
      entry({ spawnedAt: isoOffset(-25 * 60 * 60 * 1000), cost_usd: 4 }),
      entry({ spawnedAt: isoOffset(1 * 60 * 60 * 1000), cost_usd: 5 }),
    ], { period: 'today', groupBy: 'agent', now: NOW })

    expect(result.sparkline24h[22]).toBe(1)
    expect(result.sparkline24h[18]).toBe(2)
    expect(result.sparkline24h[0]).toBe(3)
    expect(result.sparkline24h.reduce((a, b) => a + b, 0)).toBe(6)
  })

  it('sparkline ignores period filter', () => {
    const recent = entry({ spawnedAt: isoOffset(-2 * 60 * 60 * 1000), cost_usd: 2 })
    const old = entry({ spawnedAt: isoOffset(-26 * 60 * 60 * 1000), cost_usd: 7 })

    const today = aggregateRuns([recent, old], { period: 'today', groupBy: 'agent', now: NOW })
    expect(today.total.cost).toBe(2)
    expect(today.sparkline24h.reduce((a, b) => a + b, 0)).toBe(2)
  })

  it('drops invalid spawnedAt values', () => {
    const result = aggregateRuns([
      entry({ spawnedAt: 'not-a-date', cost_usd: 9 }),
      entry({ spawnedAt: isoOffset(-60 * 60 * 1000), cost_usd: 1 }),
    ], { period: 'today', groupBy: 'agent', now: NOW })

    expect(result.total.runs).toBe(1)
    expect(result.total.cost).toBe(1)
    expect(result.sparkline24h.reduce((a, b) => a + b, 0)).toBe(1)
  })

  it('sorts by cost desc then label asc for ties', () => {
    const result = aggregateRuns([
      entry({ name: 'zeta', cost_usd: 2 }),
      entry({ name: 'alpha', cost_usd: 2 }),
      entry({ name: 'beta', cost_usd: 3 }),
    ], { period: 'all', groupBy: 'agent', now: NOW })

    expect(result.rows.map(r => r.label)).toEqual(['beta', 'alpha', 'zeta'])
  })
})
