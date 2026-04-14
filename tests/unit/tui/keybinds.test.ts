import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getKeybindAction, getKillConfirmPrompt, getModeHint, reloadKeybinds } from '../../../src/tui/keybinds'

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

  it('ignores invalid actions and keeps defaults', () => {
    const home = mkdtempSync(join(tmpdir(), 'flt-keybinds-invalid-'))
    const prevHome = process.env.HOME
    process.env.HOME = home

    mkdirSync(join(home, '.flt'), { recursive: true })
    writeFileSync(
      join(home, '.flt', 'keybinds.json'),
      JSON.stringify({
        normal: {
          Enter: 'notARealAction',
          q: 'notARealAction',
        },
      }),
      'utf-8',
    )

    try {
      reloadKeybinds()
      expect(getKeybindAction('normal', 'Enter')).toBe('focusLog')
      expect(getKeybindAction('normal', 'q')).toBe('quit')

      const hint = getModeHint('normal')
      expect(hint).toContain('Enter focus')
      expect(hint).toContain('q quit')
      expect(hint).not.toContain('notARealAction')
    } finally {
      process.env.HOME = prevHome
      reloadKeybinds()
    }
  })

  it('ignores printable command-mode bindings', () => {
    const home = mkdtempSync(join(tmpdir(), 'flt-keybinds-command-printable-'))
    const prevHome = process.env.HOME
    process.env.HOME = home

    mkdirSync(join(home, '.flt'), { recursive: true })
    writeFileSync(
      join(home, '.flt', 'keybinds.json'),
      JSON.stringify({
        command: {
          q: 'cancel',
          Enter: 'cancel',
        },
      }),
      'utf-8',
    )

    try {
      reloadKeybinds()
      expect(getKeybindAction('command', 'q')).toBeUndefined()
      expect(getKeybindAction('command', 'Enter')).toBe('cancel')

      const hint = getModeHint('command')
      expect(hint).toContain('Enter cancel')
      expect(hint).not.toContain('q cancel')
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

  it('renders kill-confirm prompt from configured keys', () => {
    const home = mkdtempSync(join(tmpdir(), 'flt-keybinds-kill-prompt-'))
    const prevHome = process.env.HOME
    process.env.HOME = home

    mkdirSync(join(home, '.flt'), { recursive: true })
    writeFileSync(
      join(home, '.flt', 'keybinds.json'),
      JSON.stringify({
        'kill-confirm': {
          x: 'confirm',
          Escape: 'cancel',
        },
      }),
      'utf-8',
    )

    try {
      reloadKeybinds()
      expect(getKillConfirmPrompt('alpha')).toBe('Kill alpha? [y/x confirm | n/Escape cancel]')
    } finally {
      process.env.HOME = prevHome
      reloadKeybinds()
    }
  })
})
