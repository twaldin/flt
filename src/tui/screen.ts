import { parseAnsi } from './ansi-parser'

export const ATTR_BOLD = 1
export const ATTR_DIM = 2
export const ATTR_ITALIC = 4
export const ATTR_UNDERLINE = 8
export const ATTR_INVERSE = 16

export interface Cell {
  char: string
  fg: string
  bg: string
  attrs: number
}

interface WritableLike {
  write(chunk: string): unknown
}

const EMPTY_CELL: Cell = Object.freeze({
  char: ' ',
  fg: '',
  bg: '',
  attrs: 0,
})

function cloneCell(cell: Cell): Cell {
  return { char: cell.char, fg: cell.fg, bg: cell.bg, attrs: cell.attrs }
}

function makeGrid(cols: number, rows: number): Cell[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => cloneCell(EMPTY_CELL)),
  )
}

function cellEquals(a: Cell, b: Cell): boolean {
  return a.char === b.char && a.fg === b.fg && a.bg === b.bg && a.attrs === b.attrs
}

function resolvedBg(cell: Cell, defaultBg: string): string {
  return cell.bg || defaultBg
}

function styleKey(cell: Cell, defaultBg: string): string {
  return `${cell.attrs}|${cell.fg}|${resolvedBg(cell, defaultBg)}`
}

function sgrForCell(cell: Cell, defaultBg: string): string {
  const codes: string[] = ['0']

  if (cell.attrs & ATTR_BOLD) codes.push('1')
  if (cell.attrs & ATTR_DIM) codes.push('2')
  if (cell.attrs & ATTR_ITALIC) codes.push('3')
  if (cell.attrs & ATTR_UNDERLINE) codes.push('4')
  if (cell.attrs & ATTR_INVERSE) codes.push('7')

  if (cell.fg) codes.push(cell.fg)
  const bg = resolvedBg(cell, defaultBg)
  if (bg) codes.push(bg)

  return `\x1b[${codes.join(';')}m`
}

const BOX_STYLES: Record<'single' | 'double' | 'round', {
  topLeft: string
  topRight: string
  bottomLeft: string
  bottomRight: string
  h: string
  v: string
}> = {
  single: {
    topLeft: '┌',
    topRight: '┐',
    bottomLeft: '└',
    bottomRight: '┘',
    h: '─',
    v: '│',
  },
  double: {
    topLeft: '╔',
    topRight: '╗',
    bottomLeft: '╚',
    bottomRight: '╝',
    h: '═',
    v: '║',
  },
  round: {
    topLeft: '╭',
    topRight: '╮',
    bottomLeft: '╰',
    bottomRight: '╯',
    h: '─',
    v: '│',
  },
}

export class Screen {
  cols: number
  rows: number
  front: Cell[][]
  back: Cell[][]

  private forceFullRedraw = true
  private writer: WritableLike
  private syncOutput: boolean
  private defaultBg: string

  constructor(cols: number, rows: number, writer: WritableLike = process.stdout, syncOutput = true, defaultBg = '') {
    this.cols = Math.max(1, cols)
    this.rows = Math.max(1, rows)
    this.front = makeGrid(this.cols, this.rows)
    this.back = makeGrid(this.cols, this.rows)
    this.writer = writer
    this.syncOutput = syncOutput
    this.defaultBg = defaultBg
  }

  put(row: number, col: number, text: string, fg = '', bg = '', attrs = 0): void {
    if (!text || row < 0 || row >= this.rows || col >= this.cols) return

    let c = Math.max(0, col)
    for (const ch of text) {
      if (c >= this.cols) break
      if (c >= 0) {
        this.back[row][c] = { char: ch, fg, bg, attrs }
      }
      c += 1
    }
  }

  putAnsi(row: number, col: number, width: number, height: number, ansiText: string): void {
    if (width <= 0 || height <= 0) return
    this.clear(row, col, width, height)
    parseAnsi(ansiText, this.back, row, col, width, height)
  }

  box(
    row: number,
    col: number,
    width: number,
    height: number,
    style: 'single' | 'double' | 'round',
    color = '',
  ): void {
    if (width <= 0 || height <= 0) return

    const chars = BOX_STYLES[style]

    if (height === 1) {
      this.put(row, col, chars.h.repeat(width), color)
      return
    }

    if (width === 1) {
      for (let r = 0; r < height; r += 1) {
        this.put(row + r, col, chars.v, color)
      }
      return
    }

    this.put(row, col, chars.topLeft, color)
    this.put(row, col + width - 1, chars.topRight, color)
    this.put(row + height - 1, col, chars.bottomLeft, color)
    this.put(row + height - 1, col + width - 1, chars.bottomRight, color)

    if (width > 2) {
      this.put(row, col + 1, chars.h.repeat(width - 2), color)
      this.put(row + height - 1, col + 1, chars.h.repeat(width - 2), color)
    }

    if (height > 2) {
      for (let r = row + 1; r < row + height - 1; r += 1) {
        this.put(r, col, chars.v, color)
        this.put(r, col + width - 1, chars.v, color)
      }
    }
  }

  clear(row: number, col: number, width: number, height: number): void {
    const r0 = Math.max(0, row)
    const c0 = Math.max(0, col)
    const r1 = Math.min(this.rows, row + height)
    const c1 = Math.min(this.cols, col + width)

    for (let r = r0; r < r1; r += 1) {
      for (let c = c0; c < c1; c += 1) {
        const cell = this.back[r][c]
        cell.char = ' '
        cell.fg = ''
        cell.bg = ''
        cell.attrs = 0
      }
    }
  }

  flush(): void {
    let output = ''

    // Set terminal default background so unfilled areas match the theme
    if (this.defaultBg) {
      output += `\x1b[${this.defaultBg}m`
    }

    let cursorRow = -1
    let cursorCol = -1
    let lastStyle = ''

    for (let r = 0; r < this.rows; r += 1) {
      let c = 0
      while (c < this.cols) {
        const nextCell = this.back[r][c]
        const currentCell = this.front[r][c]
        const dirty = this.forceFullRedraw || !cellEquals(currentCell, nextCell)
        if (!dirty) {
          c += 1
          continue
        }

        if (cursorRow !== r || cursorCol !== c) {
          output += `\x1b[${r + 1};${c + 1}H`
          cursorRow = r
          cursorCol = c
        }

        while (c < this.cols) {
          const runCell = this.back[r][c]
          const prevCell = this.front[r][c]
          const runDirty = this.forceFullRedraw || !cellEquals(prevCell, runCell)
          if (!runDirty) break

          const runStyle = styleKey(runCell, this.defaultBg)
          if (runStyle !== lastStyle) {
            output += sgrForCell(runCell, this.defaultBg)
            lastStyle = runStyle
          }

          output += runCell.char || ' '
          const fCell = this.front[r][c]
          fCell.char = runCell.char
          fCell.fg = runCell.fg
          fCell.bg = runCell.bg
          fCell.attrs = runCell.attrs
          cursorCol += 1
          c += 1
        }
      }
    }

    this.forceFullRedraw = false

    if (!output) return

    output += '\x1b[0m'
    if (this.syncOutput) {
      output = `\x1b[?2026h${output}\x1b[?2026l`
    }

    this.writer.write(output)
  }

  forceDirty(): void {
    this.forceFullRedraw = true
  }

  setDefaultBg(bg: string): void {
    const nextBg = bg.trim()
    if (this.defaultBg === nextBg) return
    this.defaultBg = nextBg
    this.forceFullRedraw = true
  }

  resize(cols: number, rows: number): void {
    this.cols = Math.max(1, cols)
    this.rows = Math.max(1, rows)
    this.front = makeGrid(this.cols, this.rows)
    this.back = makeGrid(this.cols, this.rows)
    this.forceFullRedraw = true
  }
}

export function createEmptyCell(): Cell {
  return cloneCell(EMPTY_CELL)
}
