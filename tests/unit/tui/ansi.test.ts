import { describe, it, expect } from 'bun:test'
import { stripAnsi, visibleLength, searchLines, truncateToVisibleLength } from '../../../src/tui/ansi'

describe('ansi utilities', () => {
  it('strips ANSI codes', () => {
    const text = '\u001B[31mred\u001B[0m'
    expect(stripAnsi(text)).toBe('red')
  })

  it('calculates visible length correctly', () => {
    const text = '\u001B[31mred\u001B[0m'
    expect(visibleLength(text)).toBe(3)
  })

  it('searches lines case-insensitive', () => {
    const lines = ['hello world', 'foo bar', 'HELLO again']
    const results = searchLines(lines, 'hello')
    expect(results.length).toBe(2)
    expect(results[0][1]).toBe('hello world')
    expect(results[1][1]).toBe('HELLO again')
  })

  it('ignores ANSI codes when searching', () => {
    const lines = ['\u001B[31mred\u001B[0m hello']
    const results = searchLines(lines, 'hello')
    expect(results.length).toBe(1)
  })

  it('truncates to visible length', () => {
    const text = '\u001B[31mhello\u001B[0m world'
    const truncated = truncateToVisibleLength(text, 5)
    // Should contain the ANSI codes + first 5 visible chars
    expect(stripAnsi(truncated)).toBe('hello')
  })
})
