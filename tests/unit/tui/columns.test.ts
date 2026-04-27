import { describe, expect, it } from 'bun:test'
import { computeColumnWidths, formatTokenPair } from '../../../src/tui/columns'

describe('computeColumnWidths', () => {
  it('keeps widths on exact fit', () => {
    expect(computeColumnWidths([5, 8, 3], 18, 2)).toEqual([5, 8, 3])
  })

  it('does not shrink on narrow terminals', () => {
    expect(computeColumnWidths([10, 10, 10], 20, 2)).toEqual([10, 10, 10])
  })

  it('grows widest first', () => {
    expect(computeColumnWidths([5, 8, 3], 30, 2)).toEqual([9, 12, 7])
  })

  it('breaks ties by lower index', () => {
    expect(computeColumnWidths([4, 4, 4], 18, 2)).toEqual([6, 5, 5])
  })
})

describe('formatTokenPair', () => {
  it('formats token pairs', () => {
    expect(formatTokenPair(0, 0)).toBe('—')
    expect(formatTokenPair(105, 97_000)).toBe('105/97k')
    expect(formatTokenPair(105_000, 97_000)).toBe('105k/97k')
  })
})
