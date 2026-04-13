import {
  ATTR_BOLD,
  ATTR_DIM,
  ATTR_ITALIC,
  ATTR_UNDERLINE,
  ATTR_INVERSE,
  type Cell,
} from './screen'

interface StyleState {
  fg: string
  bg: string
  attrs: number
}

function applySgr(style: StyleState, params: number[]): void {
  const values = params.length === 0 ? [0] : params

  for (let i = 0; i < values.length; i += 1) {
    const code = values[i]

    if (code === 0) {
      style.fg = ''
      style.bg = ''
      style.attrs = 0
      continue
    }

    if (code === 1) {
      style.attrs |= ATTR_BOLD
      continue
    }
    if (code === 2) {
      style.attrs |= ATTR_DIM
      continue
    }
    if (code === 3) {
      style.attrs |= ATTR_ITALIC
      continue
    }
    if (code === 4) {
      style.attrs |= ATTR_UNDERLINE
      continue
    }
    if (code === 7) {
      style.attrs |= ATTR_INVERSE
      continue
    }

    if (code === 22) {
      style.attrs &= ~(ATTR_BOLD | ATTR_DIM)
      continue
    }
    if (code === 23) {
      style.attrs &= ~ATTR_ITALIC
      continue
    }
    if (code === 24) {
      style.attrs &= ~ATTR_UNDERLINE
      continue
    }
    if (code === 27) {
      style.attrs &= ~ATTR_INVERSE
      continue
    }

    if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
      style.fg = String(code)
      continue
    }
    if (code === 39) {
      style.fg = ''
      continue
    }

    if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
      style.bg = String(code)
      continue
    }
    if (code === 49) {
      style.bg = ''
      continue
    }

    if (code === 38 || code === 48) {
      const isFg = code === 38
      const mode = values[i + 1]
      if (mode === 5 && i + 2 < values.length) {
        const n = values[i + 2]
        if (isFg) style.fg = `38;5;${n}`
        else style.bg = `48;5;${n}`
        i += 2
        continue
      }

      if (mode === 2 && i + 4 < values.length) {
        const r = values[i + 2]
        const g = values[i + 3]
        const b = values[i + 4]
        if (isFg) style.fg = `38;2;${r};${g};${b}`
        else style.bg = `48;2;${r};${g};${b}`
        i += 4
        continue
      }
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function writeCell(grid: Cell[][], row: number, col: number, style: StyleState, char: string): void {
  grid[row][col] = {
    char,
    fg: style.fg,
    bg: style.bg,
    attrs: style.attrs,
  }
}

function parseParams(params: string): number[] {
  if (!params) return []
  return params.split(';').map((value) => {
    if (value === '') return 0
    const n = Number.parseInt(value, 10)
    return Number.isFinite(n) ? n : 0
  })
}

export function parseAnsi(
  text: string,
  grid: Cell[][],
  startRow: number,
  startCol: number,
  maxWidth: number,
  maxHeight: number,
): void {
  if (maxWidth <= 0 || maxHeight <= 0) return

  const style: StyleState = {
    fg: '',
    bg: '',
    attrs: 0,
  }

  let row = 0
  let col = 0

  const maxRow = maxHeight - 1
  const maxCol = maxWidth - 1

  const absRow = (r: number) => startRow + r
  const absCol = (c: number) => startCol + c

  const writeChar = (char: string): void => {
    if (row < 0 || row > maxRow || col < 0 || col > maxCol) {
      // Overflow: don't wrap to next row — just discard.
      // Wrapping is handled by the terminal (tmux), not us.
      // Each \n in the captured output already marks a new row.
      return
    }

    writeCell(grid, absRow(row), absCol(col), style, char)
    col += 1
  }

  let i = 0
  while (i < text.length) {
    if (row > maxRow) break

    const ch = text[i]

    if (ch === '\u001b') {
      const next = text[i + 1]
      if (next !== '[') {
        i += 1
        continue
      }

      const seqStart = i + 2
      let j = seqStart
      while (j < text.length) {
        const code = text.charCodeAt(j)
        if (code >= 0x40 && code <= 0x7e) break
        j += 1
      }

      if (j >= text.length) break

      const paramsRaw = text.slice(seqStart, j)
      const final = text[j]
      const params = parseParams(paramsRaw)

      if (final === 'm') {
        applySgr(style, params)
      } else if (final === 'H' || final === 'f') {
        const r = clamp((params[0] || 1) - 1, 0, maxRow)
        const c = clamp((params[1] || 1) - 1, 0, maxCol)
        row = r
        col = c
      } else if (final === 'A') {
        const n = params[0] || 1
        row = clamp(row - n, 0, maxRow)
      } else if (final === 'B') {
        const n = params[0] || 1
        row = clamp(row + n, 0, maxRow)
      } else if (final === 'C') {
        const n = params[0] || 1
        col = clamp(col + n, 0, maxCol)
      } else if (final === 'D') {
        const n = params[0] || 1
        col = clamp(col - n, 0, maxCol)
      } else if (final === 'G') {
        const c = clamp((params[0] || 1) - 1, 0, maxCol)
        col = c
      } else if (final === 'd') {
        const r = clamp((params[0] || 1) - 1, 0, maxRow)
        row = r
      } else if (final === 'J') {
        const mode = params[0] || 0
        if (mode === 2) {
          for (let r = 0; r <= maxRow; r += 1) {
            for (let c = 0; c <= maxCol; c += 1) {
              writeCell(grid, absRow(r), absCol(c), { fg: '', bg: '', attrs: 0 }, ' ')
            }
          }
          row = 0
          col = 0
        }
      } else if (final === 'K') {
        const mode = params[0] || 0
        if (row >= 0 && row <= maxRow) {
          const start = mode === 1 ? 0 : mode === 2 ? 0 : col
          const end = mode === 1 ? col : mode === 2 ? maxCol : maxCol
          for (let c = start; c <= end; c += 1) {
            writeCell(grid, absRow(row), absCol(c), { fg: '', bg: '', attrs: 0 }, ' ')
          }
        }
      }

      i = j + 1
      continue
    }

    if (ch === '\n') {
      row += 1
      col = 0
      i += 1
      continue
    }

    if (ch === '\r') {
      col = 0
      i += 1
      continue
    }

    if (ch === '\b') {
      col = Math.max(0, col - 1)
      i += 1
      continue
    }

    if (ch === '\t') {
      const nextTab = Math.min(maxCol + 1, col + (8 - (col % 8)))
      while (col < nextTab) {
        writeChar(' ')
      }
      i += 1
      continue
    }

    const code = text.codePointAt(i)
    if (code === undefined) break
    const char = String.fromCodePoint(code)
    writeChar(char)
    i += char.length
  }
}
