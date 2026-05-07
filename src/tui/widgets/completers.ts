// Pluggable completion providers for TextInput.
//
// Each completer is a `CompletionProvider` (see text-input.ts): given a buffer
// + cursor, it returns candidates and the index from which to replace.
//
// Built-in providers:
//   pathCompleter       — files/dirs from a prefix (relative or ~/ expanded)
//   agentNameCompleter  — live agents from state.json
//   slashCommandCompleter — installed skills (/grill, /handoff, …)
//
// `composedCommandCompleter` is the command-bar's combined completer: it
// dispatches to whichever sub-completer matches the current token context
// (path after `cd `, agent after `send `, slash after a leading `/`, …) and
// otherwise falls back to the legacy command/flag completer that already
// lives in input.ts.

import { existsSync, readdirSync, statSync, lstatSync } from 'fs'
import { homedir } from 'os'
import { join, dirname, basename, isAbsolute, resolve as pathResolve } from 'path'
import type { CompletionProvider, CompletionResult, CompletionEntry } from './text-input'

// ── path completion ──

export interface PathCompleterOpts {
  cwd?: () => string
  /** When true, only match directories (good after `cd `). */
  dirsOnly?: boolean
}

export function pathCompleter(opts: PathCompleterOpts = {}): CompletionProvider {
  return (text: string, cursor: number) => {
    const tokenStart = findTokenStart(text, cursor)
    const token = text.slice(tokenStart, cursor)
    return computePathCompletions(token, tokenStart, opts)
  }
}

function computePathCompletions(
  token: string,
  tokenStart: number,
  opts: PathCompleterOpts,
): CompletionResult {
  if (token.length === 0) return { items: [], replaceFrom: tokenStart }
  const cwd = opts.cwd ? opts.cwd() : process.cwd()

  // Expand ~/ and ~
  let expanded = token
  let home = ''
  if (token === '~') {
    expanded = homedir()
  } else if (token.startsWith('~/')) {
    home = homedir()
    expanded = home + token.slice(1)
  }

  const isDirSearch = expanded.endsWith('/') || expanded === ''
  const dir = isDirSearch ? (expanded || '.') : (dirname(expanded) || '.')
  const filterPrefix = isDirSearch ? '' : basename(expanded)

  const absDir = isAbsolute(dir) ? dir : pathResolve(cwd, dir)
  if (!existsSync(absDir)) return { items: [], replaceFrom: tokenStart }
  let entries: string[]
  try {
    entries = readdirSync(absDir)
  } catch {
    return { items: [], replaceFrom: tokenStart }
  }

  const items: CompletionEntry[] = []
  for (const name of entries) {
    if (filterPrefix && !name.toLowerCase().startsWith(filterPrefix.toLowerCase())) continue
    if (name.startsWith('.') && !filterPrefix.startsWith('.')) continue
    let isDir = false
    try {
      const lp = join(absDir, name)
      const st = lstatSync(lp)
      isDir = st.isDirectory() || (st.isSymbolicLink() && (() => {
        try { return statSync(lp).isDirectory() } catch { return false }
      })())
    } catch {
      continue
    }
    if (opts.dirsOnly && !isDir) continue

    // Re-attach the original prefix (preserving ~/ if used).
    const originalDir = isDirSearch ? token : token.slice(0, token.length - filterPrefix.length)
    const value = `${originalDir}${name}${isDir ? '/' : ''}`
    items.push({ value, label: isDir ? 'dir' : 'file' })
  }
  items.sort((a, b) => a.value.localeCompare(b.value))
  return { items, replaceFrom: tokenStart }
}

// ── agent name completion ──

export function agentNameCompleter(getNames: () => string[]): CompletionProvider {
  return (text: string, cursor: number) => {
    const tokenStart = findTokenStart(text, cursor)
    const token = text.slice(tokenStart, cursor)
    const names = getNames()
    const items: CompletionEntry[] = names
      .filter(n => n.toLowerCase().startsWith(token.toLowerCase()))
      .map(n => ({ value: n, label: 'agent' }))
    return { items, replaceFrom: tokenStart }
  }
}

// ── slash command (skill) completion ──

export function slashCommandCompleter(getNames: () => string[]): CompletionProvider {
  return (text: string, cursor: number) => {
    const tokenStart = findTokenStart(text, cursor)
    const token = text.slice(tokenStart, cursor)
    if (!token.startsWith('/')) return { items: [], replaceFrom: tokenStart }
    const prefix = token.slice(1)
    const names = getNames()
    const items: CompletionEntry[] = names
      .filter(n => n.toLowerCase().startsWith(prefix.toLowerCase()))
      .map(n => ({ value: `/${n}`, label: 'skill' }))
    return { items, replaceFrom: tokenStart }
  }
}

// ── helpers ──

function findTokenStart(text: string, cursor: number): number {
  let i = cursor
  while (i > 0 && !/\s/.test(text[i - 1]!)) i -= 1
  return i
}
