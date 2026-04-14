import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { tmpdir } from 'os'
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'

// Override HOME to a temp dir to avoid touching real ~/.flt/config.json
const tempHome = join(tmpdir(), `flt-ascii-test-${process.pid}`)
const origHome = process.env.HOME
beforeEach(() => {
  mkdirSync(join(tempHome, '.flt'), { recursive: true })
  process.env.HOME = tempHome
})
afterEach(() => {
  process.env.HOME = origHome
  if (existsSync(tempHome)) {
    rmSync(tempHome, { recursive: true, force: true })
  }
})

// Re-import fresh after each test to reset module state
// We test the functions via dynamic require to pick up HOME changes
async function getAsciiModule() {
  // Use dynamic import with cache-busting to isolate tests
  // Since Bun caches modules, we test via the exported functions directly
  const mod = await import('../../../src/tui/ascii')
  return mod
}

describe('ascii module', () => {
  describe('getAsciiLogo', () => {
    it('returns a non-empty array of strings', async () => {
      const { getAsciiLogo } = await getAsciiModule()
      const lines = getAsciiLogo(80)
      expect(Array.isArray(lines)).toBe(true)
      expect(lines.length).toBeGreaterThan(0)
    })

    it('each line fits within maxWidth', async () => {
      const { getAsciiLogo } = await getAsciiModule()
      const maxWidth = 20
      const lines = getAsciiLogo(maxWidth)
      for (const line of lines) {
        expect(Array.from(line).length).toBeLessThanOrEqual(maxWidth)
      }
    })

    it('returns empty array for maxWidth <= 0', async () => {
      const { getAsciiLogo } = await getAsciiModule()
      expect(getAsciiLogo(0)).toEqual([])
      expect(getAsciiLogo(-1)).toEqual([])
    })

    it('truncates lines at maxWidth boundary', async () => {
      const { getAsciiLogo } = await getAsciiModule()
      const narrow = getAsciiLogo(5)
      const wide = getAsciiLogo(200)
      // At least some lines should differ (truncation happened)
      const narrowTotal = narrow.reduce((s, l) => s + Array.from(l).length, 0)
      const wideTotal = wide.reduce((s, l) => s + Array.from(l).length, 0)
      expect(narrowTotal).toBeLessThanOrEqual(wideTotal)
    })
  })

  describe('getAsciiLogoWidth', () => {
    it('returns a positive number', async () => {
      const { getAsciiLogoWidth } = await getAsciiModule()
      const w = getAsciiLogoWidth()
      expect(typeof w).toBe('number')
      expect(w).toBeGreaterThan(0)
    })

    it('equals max line width from getAsciiLogo(9999)', async () => {
      const { getAsciiLogo, getAsciiLogoWidth } = await getAsciiModule()
      const lines = getAsciiLogo(9999)
      const maxW = lines.reduce((m, l) => Math.max(m, Array.from(l).length), 0)
      expect(getAsciiLogoWidth()).toBe(maxW)
    })
  })

  describe('setAsciiWord', () => {
    it('changes the rendered output', async () => {
      const { getAsciiLogo, setAsciiWord } = await getAsciiModule()
      const before = getAsciiLogo(200).join('\n')
      setAsciiWord('xyz')
      const after = getAsciiLogo(200).join('\n')
      expect(before).not.toBe(after)
    })

    it('reflects the new word in rendered lines', async () => {
      const { getAsciiLogo, setAsciiWord } = await getAsciiModule()
      setAsciiWord('hi')
      const lines = getAsciiLogo(200)
      expect(lines.length).toBeGreaterThan(0)
    })

    it('persists config to config.json', async () => {
      const { setAsciiWord } = await getAsciiModule()
      setAsciiWord('saved')
      const configPath = join(tempHome, '.flt', 'config.json')
      expect(existsSync(configPath)).toBe(true)
      const config = JSON.parse(require('fs').readFileSync(configPath, 'utf-8'))
      expect(config.ascii?.word).toBe('saved')
      expect(config.ascii?.font).toBe(null)
    })

    it('persists font path when provided', async () => {
      const { setAsciiWord } = await getAsciiModule()
      // Use a fake path — setAsciiWord persists it without validating
      setAsciiWord('test', '/some/font.flf')
      const configPath = join(tempHome, '.flt', 'config.json')
      const config = JSON.parse(require('fs').readFileSync(configPath, 'utf-8'))
      expect(config.ascii?.font).toBe('/some/font.flf')
    })

    it('preserves existing config keys when persisting', async () => {
      // Pre-populate config with theme key
      const configPath = join(tempHome, '.flt', 'config.json')
      writeFileSync(configPath, JSON.stringify({ theme: 'dark' }, null, 2))
      const { setAsciiWord } = await getAsciiModule()
      setAsciiWord('hello')
      const config = JSON.parse(require('fs').readFileSync(configPath, 'utf-8'))
      expect(config.theme).toBe('dark')
      expect(config.ascii?.word).toBe('hello')
    })
  })

  describe('resetAscii', () => {
    it('restores word to flt', async () => {
      const { setAsciiWord, resetAscii, getCurrentAsciiConfig } = await getAsciiModule()
      setAsciiWord('other')
      resetAscii()
      expect(getCurrentAsciiConfig().word).toBe('flt')
    })

    it('clears font path', async () => {
      const { setAsciiWord, resetAscii, getCurrentAsciiConfig } = await getAsciiModule()
      setAsciiWord('other', '/some/font.flf')
      resetAscii()
      expect(getCurrentAsciiConfig().font).toBe(null)
    })
  })

  describe('getCurrentAsciiConfig', () => {
    it('returns current config', async () => {
      const { setAsciiWord, getCurrentAsciiConfig } = await getAsciiModule()
      setAsciiWord('myword')
      const cfg = getCurrentAsciiConfig()
      expect(cfg.word).toBe('myword')
      expect(cfg.font).toBe(null)
    })

    it('returns a copy, not a reference', async () => {
      const { getCurrentAsciiConfig } = await getAsciiModule()
      const cfg = getCurrentAsciiConfig()
      cfg.word = 'mutated'
      const cfg2 = getCurrentAsciiConfig()
      expect(cfg2.word).not.toBe('mutated')
    })
  })
})
