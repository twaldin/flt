import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  pathCompleter,
  agentNameCompleter,
  slashCommandCompleter,
} from '../../../src/tui/widgets/completers'

describe('pathCompleter', () => {
  const root = mkdtempSync(join(tmpdir(), 'flt-pathc-'))
  mkdirSync(join(root, 'subdir'))
  mkdirSync(join(root, 'sub_other'))
  writeFileSync(join(root, 'a.txt'), '')
  writeFileSync(join(root, 'b.txt'), '')

  test('lists matching entries with file/dir labels', () => {
    const c = pathCompleter({ cwd: () => root })
    const r = c('s', 1)
    if (r instanceof Promise) throw new Error('expected sync result')
    const values = r.items.map(i => i.value).sort()
    expect(values).toEqual(['sub_other/', 'subdir/'])
    expect(r.items.every(i => i.label === 'dir')).toBe(true)
  })

  test('with dirsOnly filters out files', () => {
    const c = pathCompleter({ cwd: () => root, dirsOnly: true })
    const r = c('', 0)
    if (r instanceof Promise) throw new Error('expected sync result')
    expect(r.items.length).toBe(0)
  })

  test('expands ~/', () => {
    const c = pathCompleter({ cwd: () => root })
    const r = c('~/', 2)
    if (r instanceof Promise) throw new Error('expected sync result')
    // We can't assert exact contents (depends on the host home), but the
    // returned values should preserve the ~/ prefix.
    for (const item of r.items) {
      expect(item.value.startsWith('~/')).toBe(true)
    }
  })

  test('returns empty when prefix is empty', () => {
    const c = pathCompleter({ cwd: () => root })
    const r = c('', 0)
    if (r instanceof Promise) throw new Error('expected sync result')
    expect(r.items).toEqual([])
  })

  test('replaceFrom marks the start of the path token', () => {
    const c = pathCompleter({ cwd: () => root })
    const buf = 'cd s'
    const r = c(buf, buf.length)
    if (r instanceof Promise) throw new Error('expected sync result')
    expect(r.replaceFrom).toBe(3) // start of 's'
  })
})

describe('agentNameCompleter', () => {
  test('matches by prefix on the current token', () => {
    const c = agentNameCompleter(() => ['alpha', 'beta', 'apex'])
    const buf = 'send a'
    const r = c(buf, buf.length)
    if (r instanceof Promise) throw new Error('expected sync result')
    expect(r.items.map(i => i.value).sort()).toEqual(['alpha', 'apex'])
    expect(r.replaceFrom).toBe(5)
  })
})

describe('slashCommandCompleter', () => {
  test('only fires when the token starts with /', () => {
    const c = slashCommandCompleter(() => ['grill', 'handoff'])
    const r1 = c('foo', 3)
    if (r1 instanceof Promise) throw new Error('expected sync result')
    expect(r1.items).toEqual([])
    const r2 = c('/g', 2)
    if (r2 instanceof Promise) throw new Error('expected sync result')
    expect(r2.items.map(i => i.value)).toEqual(['/grill'])
  })
})
