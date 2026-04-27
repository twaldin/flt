function formatTokenCount(value: number): string {
  return value >= 1000 ? `${Math.round(value / 1000)}k` : `${Math.round(value)}`
}

export function computeColumnWidths(
  minWidths: readonly number[],
  terminalWidth: number,
  separatorOverhead = Math.max(0, minWidths.length - 1),
): number[] {
  const widths = minWidths.map(v => Math.max(0, Math.floor(v)))
  if (widths.length === 0) return widths

  const available = Math.max(0, Math.floor(terminalWidth) - Math.max(0, Math.floor(separatorOverhead)))
  const sum = widths.reduce((s, w) => s + w, 0)
  let slack = available - sum
  if (slack <= 0) return widths

  const order = widths
    .map((width, index) => ({ width, index }))
    .sort((a, b) => b.width - a.width || a.index - b.index)
    .map(item => item.index)

  let cursor = 0
  while (slack > 0) {
    widths[order[cursor]] += 1
    cursor = (cursor + 1) % order.length
    slack -= 1
  }

  return widths
}

export function joinWithSeparators(cells: string[], sep: string): string {
  return cells.join(sep)
}

export function formatTokenPair(tokensIn: number, tokensOut: number): string {
  if (tokensIn === 0 && tokensOut === 0) return '—'
  return `${formatTokenCount(tokensIn)}/${formatTokenCount(tokensOut)}`
}

export function truncateEllipsis(text: string, max: number): string {
  if (max <= 0) return ''
  const chars = Array.from(text)
  if (chars.length <= max) return text
  if (max <= 1) return '…'
  return chars.slice(0, max - 1).join('') + '…'
}
