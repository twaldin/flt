import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

type ThemeModule = typeof import('../../../src/tui/theme')

const originalHome = process.env.HOME
let tempHome = ''

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'flt-theme-files-'))
  mkdirSync(join(tempHome, '.flt'), { recursive: true })
  process.env.HOME = tempHome
})

afterEach(() => {
  process.env.HOME = originalHome
  if (tempHome) {
    rmSync(tempHome, { recursive: true, force: true })
    tempHome = ''
  }
})

async function importFreshThemeModule(seed: string): Promise<ThemeModule> {
  return import(`../../../src/tui/theme?${seed}`)
}

describe('theme file loading', () => {
  it('includes user themes from ~/.flt/themes and sorts names', async () => {
    const themesDir = join(tempHome, '.flt', 'themes')
    mkdirSync(themesDir, { recursive: true })
    writeFileSync(join(themesDir, 'zeta.json'), JSON.stringify({ extends: 'dark', sidebarBorder: '31' }))
    writeFileSync(join(themesDir, 'alpha.json'), JSON.stringify({ extends: 'light', sidebarBorder: '32' }))

    const theme = await importFreshThemeModule(`names-${Date.now()}`)
    const names = theme.getThemeNames()

    expect(names).toContain('alpha')
    expect(names).toContain('zeta')
    expect(names).toEqual([...names].sort())
  })

  it('loads a user theme that extends a built-in theme', async () => {
    const themesDir = join(tempHome, '.flt', 'themes')
    mkdirSync(themesDir, { recursive: true })
    writeFileSync(
      join(themesDir, 'mytheme.json'),
      JSON.stringify({ extends: 'light', sidebarBorder: '31', background: '48;2;1;2;3' }),
    )

    const theme = await importFreshThemeModule(`user-${Date.now()}`)
    expect(theme.setTheme('mytheme')).toBe(true)
    expect(theme.getCurrentThemeName()).toBe('mytheme')
    expect(theme.getTheme().sidebarBorder).toBe('31')
    expect(theme.getTheme().background).toBe('48;2;1;2;3')
  })

  it('keeps legacy ~/.flt/theme.json startup behavior (extends + overrides)', async () => {
    writeFileSync(
      join(tempHome, '.flt', 'theme.json'),
      JSON.stringify({ extends: 'light', sidebarBorder: '31' }),
    )

    const theme = await importFreshThemeModule(`legacy-startup-${Date.now()}`)
    expect(theme.getCurrentThemeName()).toBe('light')
    expect(theme.getTheme().sidebarBorder).toBe('31')
  })

  it('applies legacy ~/.flt/theme.json overrides after setTheme()', async () => {
    writeFileSync(
      join(tempHome, '.flt', 'theme.json'),
      JSON.stringify({ extends: 'light', sidebarBorder: '31' }),
    )

    const theme = await importFreshThemeModule(`legacy-set-${Date.now()}`)
    expect(theme.setTheme('dark')).toBe(true)
    expect(theme.getCurrentThemeName()).toBe('dark')
    expect(theme.getTheme().sidebarBorder).toBe('31')
  })
})
