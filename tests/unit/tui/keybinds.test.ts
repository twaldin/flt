import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getKeybindAction, getModeHint, reloadKeybinds } from '../../../src/tui/keybinds'

describe('keybinds', () => {
  it('uses defaults when no user config exists', () => {
    const home = mkdtempSync(join(tmpdir(), 'flt-keybinds-default-'))
    const prevHome = process.env.HOME
    process.env.HOME = home

    try {
      reloadKeybinds()
      expect(getKeybindAction('normal', 'j')).toBe('selectNext')
      expect(getKeybindAction('normal', 'enter')).toBe('focusLog')
      expect(getKeybindAction('normal', 'tab')).toBe('focusLog')
      expect(getKeybindAction('log-focus', 'ctrl-d')).toBe('pageDown')
      expect(getModeHint('normal')).toContain('j/k select')
    } finally {
      process.env.HOME = prevHome
      reloadKeybinds()
    }
  })

  it('deep merges per-mode per-key overrides from ~/.flt/keybinds.json', () => {
    const home = mkdtempSync(join(tmpdir(), 'flt-keybinds-override-'))
    const prevHome = process.env.HOME
    process.env.HOME = home

    mkdirSync(join(home, '.flt'), { recursive: true })
    writeFileSync(
      join(home, '.flt', 'keybinds.json'),
      JSON.stringify({
        normal: {
          j: 'selectPrev',
          x: 'quit',
          enter: 'toggleCollapse',
        },
        inbox: {
          u: 'msgUp',
        },
      }),
      'utf-8',
    )

    try {
      reloadKeybinds()

      // overridden
      expect(getKeybindAction('normal', 'j')).toBe('selectPrev')
      expect(getKeybindAction('normal', 'x')).toBe('quit')
      expect(getKeybindAction('normal', 'Enter')).toBe('toggleCollapse')
      expect(getKeybindAction('inbox', 'u')).toBe('msgUp')

      // fallback from defaults still present
      expect(getKeybindAction('normal', 'k')).toBe('selectPrev')
      expect(getKeybindAction('normal', ':')).toBe('openCommand')
      expect(getKeybindAction('inbox', 'd')).toBe('delete')
    } finally {
      process.env.HOME = prevHome
      reloadKeybinds()
    }
  })

  it('formats mode hints from configured bindings', () => {
    const home = mkdtempSync(join(tmpdir(), 'flt-keybinds-hints-'))
    const prevHome = process.env.HOME
    process.env.HOME = home

    mkdirSync(join(home, '.flt'), { recursive: true })
    writeFileSync(
      join(home, '.flt', 'keybinds.json'),
      JSON.stringify({
        normal: {
          j: 'selectNext',
          k: 'selectPrev',
          q: 'quit',
        },
      }),
      'utf-8',
    )

    try {
      reloadKeybinds()
      const hint = getModeHint('normal')
      expect(hint).toContain('j/k select')
      expect(hint).toContain('q quit')
      expect(getModeHint('insert')).toBe('typing to agent | Ctrl-c interrupt | Esc exit')
    } finally {
      process.env.HOME = prevHome
      reloadKeybinds()
    }
  })
})
