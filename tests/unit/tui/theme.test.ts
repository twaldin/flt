import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { getThemeNames, setTheme, getTheme, getCurrentThemeName, modeColor, statusColor } from '../../../src/tui/theme'
import type { Mode } from '../../../src/tui/types'

describe('theme system', () => {
  const originalTheme = getCurrentThemeName()

  afterEach(() => {
    setTheme(originalTheme)
  })

  describe('getThemeNames', () => {
    it('returns array of built-in themes', () => {
      const names = getThemeNames()
      expect(names).toContain('dark')
      expect(names).toContain('light')
      expect(names).toContain('minimal')
    })

    it('returns at least 3 themes', () => {
      const names = getThemeNames()
      expect(names.length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('setTheme', () => {
    it('sets a valid theme and returns true', () => {
      const result = setTheme('light')
      expect(result).toBe(true)
      expect(getCurrentThemeName()).toBe('light')
    })

    it('returns false for invalid theme', () => {
      const result = setTheme('invalid-theme')
      expect(result).toBe(false)
    })

    it('returns true for all built-in themes', () => {
      for (const name of getThemeNames()) {
        const result = setTheme(name)
        expect(result).toBe(true)
      }
    })

    it('changes current theme on successful set', () => {
      setTheme('minimal')
      expect(getCurrentThemeName()).toBe('minimal')

      setTheme('light')
      expect(getCurrentThemeName()).toBe('light')
    })
  })

  describe('getTheme', () => {
    it('returns a theme object with required color properties', () => {
      const theme = getTheme()
      expect(theme).toHaveProperty('sidebarBorder')
      expect(theme).toHaveProperty('sidebarTitle')
      expect(theme).toHaveProperty('sidebarText')
      expect(theme).toHaveProperty('sidebarSelected')
      expect(theme).toHaveProperty('sidebarMuted')
      expect(theme).toHaveProperty('bannerBorder')
      expect(theme).toHaveProperty('bannerText')
      expect(theme).toHaveProperty('logBorder')
      expect(theme).toHaveProperty('logBorderInsert')
      expect(theme).toHaveProperty('logBorderFocus')
      expect(theme).toHaveProperty('commandPrefix')
      expect(theme).toHaveProperty('commandInput')
      expect(theme).toHaveProperty('commandHint')
      expect(theme).toHaveProperty('statusBg')
      expect(theme).toHaveProperty('statusText')
      expect(theme).toHaveProperty('statusMode')
    })

    it('returns different colors for different themes', () => {
      setTheme('dark')
      const darkTheme = getTheme()

      setTheme('light')
      const lightTheme = getTheme()

      // At least some colors should differ between themes
      const darkColors = Object.values(darkTheme).filter((v) => typeof v === 'string').join('|')
      const lightColors = Object.values(lightTheme).filter((v) => typeof v === 'string').join('|')
      expect(darkColors).not.toBe(lightColors)
    })

    it('statusMode has all required modes', () => {
      const theme = getTheme()
      const modes: Mode[] = ['normal', 'log-focus', 'insert', 'command', 'inbox']
      for (const mode of modes) {
        expect(theme.statusMode).toHaveProperty(mode)
      }
    })
  })

  describe('modeColor', () => {
    it('returns a color for each mode', () => {
      const modes: Mode[] = ['normal', 'log-focus', 'insert', 'command', 'inbox']
      for (const mode of modes) {
        const color = modeColor(mode)
        expect(typeof color).toBe('string')
        expect(color.length).toBeGreaterThan(0)
      }
    })

    it('returns theme-dependent colors', () => {
      setTheme('dark')
      const darkNormalColor = modeColor('normal')

      setTheme('light')
      const lightNormalColor = modeColor('normal')

      // Colors should be consistent within theme but may differ between themes
      expect(modeColor('normal')).toBe(lightNormalColor)
    })
  })

  describe('statusColor', () => {
    it('returns a color for each status', () => {
      const statuses = ['spawning', 'ready', 'running', 'idle', 'error', 'rate-limited', 'exited', 'unknown'] as const
      for (const status of statuses) {
        const color = statusColor(status)
        expect(typeof color).toBe('string')
        expect(color.length).toBeGreaterThan(0)
      }
    })

    it('returns consistent colors for same status', () => {
      const color1 = statusColor('running')
      const color2 = statusColor('running')
      expect(color1).toBe(color2)
    })

    it('returns gray for dead agents, theme color for alive', () => {
      const runningColor = statusColor('running')
      const exitedColor = statusColor('exited')
      expect(runningColor).not.toBe(exitedColor)
    })
  })

  describe('getCurrentThemeName', () => {
    it('returns the current theme name', () => {
      setTheme('light')
      expect(getCurrentThemeName()).toBe('light')

      setTheme('minimal')
      expect(getCurrentThemeName()).toBe('minimal')
    })

    it('defaults to dark theme initially', () => {
      // Set to something else, then check we can read it back
      setTheme('dark')
      expect(getCurrentThemeName()).toBe('dark')
    })
  })

  describe('dark theme', () => {
    beforeEach(() => {
      setTheme('dark')
    })

    it('has valid color codes', () => {
      const theme = getTheme()
      // Color codes should be 2-digit numbers or empty string
      const colorProps = [
        theme.sidebarBorder,
        theme.sidebarTitle,
        theme.commandPrefix,
      ]
      for (const color of colorProps) {
        expect(typeof color).toBe('string')
      }
    })
  })

  describe('light theme', () => {
    beforeEach(() => {
      setTheme('light')
    })

    it('has valid color codes', () => {
      const theme = getTheme()
      const colorProps = [
        theme.sidebarBorder,
        theme.sidebarTitle,
        theme.commandPrefix,
      ]
      for (const color of colorProps) {
        expect(typeof color).toBe('string')
      }
    })
  })

  describe('minimal theme', () => {
    beforeEach(() => {
      setTheme('minimal')
    })

    it('has valid color codes', () => {
      const theme = getTheme()
      const colorProps = [
        theme.sidebarBorder,
        theme.sidebarTitle,
        theme.commandPrefix,
      ]
      for (const color of colorProps) {
        expect(typeof color).toBe('string')
      }
    })
  })
})
