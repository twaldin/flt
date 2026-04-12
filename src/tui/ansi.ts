/**
 * ANSI-aware utilities for handling colorized terminal output
 */

// ANSI escape sequence regex
const ansiRegex = /\u001B\[[0-9;]*m/g

/**
 * Strip ANSI codes from a string
 */
export function stripAnsi(str: string): string {
  return str.replace(ansiRegex, '')
}

/**
 * Split content into lines, preserving ANSI codes
 * ANSI codes don't count toward line length
 */
export function splitLines(content: string): string[] {
  return content.split('\n')
}

/**
 * Get visible length of a string (ignoring ANSI codes)
 */
export function visibleLength(str: string): number {
  return stripAnsi(str).length
}

/**
 * Truncate a string to visible length, preserving ANSI codes
 */
export function truncateToVisibleLength(str: string, maxLen: number): string {
  let visibleCount = 0
  let result = ''
  let i = 0

  while (i < str.length && visibleCount < maxLen) {
    const match = str.substring(i).match(/^\u001B\[[0-9;]*m/)
    if (match) {
      // ANSI code — copy it as-is
      result += match[0]
      i += match[0].length
    } else {
      // Regular character
      result += str[i]
      visibleCount++
      i++
    }
  }

  return result
}

/**
 * Search for lines containing a query (case-insensitive)
 * Returns array of [lineIndex, line] tuples
 */
export function searchLines(lines: string[], query: string): [number, string][] {
  const lowerQuery = query.toLowerCase()
  return lines
    .map((line, idx): [number, string] => [idx, line])
    .filter(([_, line]) => stripAnsi(line).toLowerCase().includes(lowerQuery))
}
