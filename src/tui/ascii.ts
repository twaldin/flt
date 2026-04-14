import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import figlet from 'figlet'

export interface AsciiConfig {
  word: string
  font: string | null
}

let currentConfig: AsciiConfig = { word: 'flt', font: null }
let cachedLines: string[] = []
let cachedRawWidth = 0

function getConfigPath(): string {
  return `${process.env.HOME || homedir()}/.flt/config.json`
}

const DEFAULT_FONT = 'DOS Rebel'

function renderLines(word: string, fontPath: string | null): string[] {
  try {
    let text: string
    if (fontPath) {
      const fontData = readFileSync(fontPath, 'utf-8')
      figlet.parseFont('_ascii_custom', fontData)
      text = figlet.textSync(word, { font: '_ascii_custom' as figlet.Fonts })
    } else {
      text = figlet.textSync(word, { font: DEFAULT_FONT as figlet.Fonts })
    }
    const lines = text.split('\n')
    while (lines.length > 0 && !lines[lines.length - 1].trim()) {
      lines.pop()
    }
    return lines
  } catch {
    return [word]
  }
}

function rebuildCache(): void {
  cachedLines = renderLines(currentConfig.word, currentConfig.font)
  cachedRawWidth = cachedLines.reduce((max, line) => Math.max(max, Array.from(line).length), 0)
}

function loadAsciiConfig(): void {
  try {
    const configPath = getConfigPath()
    if (!existsSync(configPath)) return
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    if (config.ascii && typeof config.ascii === 'object') {
      const { word, font } = config.ascii as { word?: unknown; font?: unknown }
      if (typeof word === 'string' && word) {
        currentConfig.word = word
      }
      if (font === null || typeof font === 'string') {
        currentConfig.font = font as string | null
      }
    }
  } catch {}
}

export function persistAsciiConfig(word: string, font: string | null): void {
  try {
    const dir = `${process.env.HOME || homedir()}/.flt`
    mkdirSync(dir, { recursive: true })
    const configPath = getConfigPath()
    let config: Record<string, unknown> = {}
    if (existsSync(configPath)) {
      config = JSON.parse(readFileSync(configPath, 'utf-8'))
    }
    config.ascii = { word, font }
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
  } catch {}
}

export function setAsciiWord(word: string, fontPath: string | null = null): void {
  currentConfig = { word, font: fontPath }
  rebuildCache()
  persistAsciiConfig(word, fontPath)
}

export function resetAscii(): void {
  setAsciiWord('flt', null)
}

export function getCurrentAsciiConfig(): AsciiConfig {
  return { ...currentConfig }
}

/** Returns logo lines, each truncated to maxWidth characters */
export function getAsciiLogo(maxWidth: number): string[] {
  if (cachedLines.length === 0) rebuildCache()
  if (maxWidth <= 0) return []
  return cachedLines.map(line => {
    const chars = Array.from(line)
    if (chars.length <= maxWidth) return line
    return chars.slice(0, maxWidth).join('')
  })
}

/** Returns the max line width of the logo before any truncation */
export function getAsciiLogoWidth(): number {
  if (cachedLines.length === 0) rebuildCache()
  return cachedRawWidth
}

// Initialize: load persisted config, then build cache
loadAsciiConfig()
rebuildCache()
