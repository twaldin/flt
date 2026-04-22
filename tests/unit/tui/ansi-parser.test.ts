import { describe, it, expect } from 'bun:test'
import { parseAnsi } from '../../../src/tui/ansi-parser'
import { ATTR_BOLD, createEmptyCell, type Cell } from '../../../src/tui/screen'

function makeGrid(rows: number, cols: number): Cell[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => createEmptyCell()),
  )
}

describe('ansi-parser', () => {
  it('parses sgr color and reset', () => {
    const grid = makeGrid(1, 4)
    parseAnsi('\x1b[31;1mR\x1b[0mN', grid, 0, 0, 4, 1)

    expect(grid[0][0].char).toBe('R')
    expect(grid[0][0].fg).toBe('31')
    expect(grid[0][0].attrs & ATTR_BOLD).toBe(ATTR_BOLD)

    expect(grid[0][1].char).toBe('N')
    expect(grid[0][1].fg).toBe('')
    expect(grid[0][1].attrs).toBe(0)
  })

  it('handles cursor movement', () => {
    const grid = makeGrid(1, 4)
    parseAnsi('A\x1b[1;3HZ', grid, 0, 0, 4, 1)

    expect(grid[0][0].char).toBe('A')
    expect(grid[0][2].char).toBe('Z')
  })

  it('handles 256 and truecolor sequences', () => {
    const grid = makeGrid(1, 3)
    parseAnsi('\x1b[38;5;196mX\x1b[48;2;1;2;3mY', grid, 0, 0, 3, 1)

    expect(grid[0][0].fg).toBe('38;5;196')
    expect(grid[0][1].bg).toBe('48;2;1;2;3')
  })

  it('advances column by display width for wide unicode chars', () => {
    const grid = makeGrid(1, 4)
    parseAnsi('A你B', grid, 0, 0, 4, 1)

    expect(grid[0][0].char).toBe('A')
    expect(grid[0][1].char).toBe('你')
    expect(grid[0][2].char).toBe('')
    expect(grid[0][3].char).toBe('B')
  })

  it('attaches combining marks to previous cell', () => {
    const grid = makeGrid(1, 3)
    parseAnsi('e\u0301X', grid, 0, 0, 3, 1)

    expect(grid[0][0].char).toBe('e\u0301')
    expect(grid[0][1].char).toBe('X')
  })

  it('uses current style for erase-in-line blanks', () => {
    const grid = makeGrid(1, 4)
    parseAnsi('\x1b[48;5;240mX\x1b[K', grid, 0, 0, 4, 1)

    expect(grid[0][1].char).toBe(' ')
    expect(grid[0][1].bg).toBe('48;5;240')
    expect(grid[0][3].bg).toBe('48;5;240')
  })
})
