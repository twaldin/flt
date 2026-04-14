import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  addPreset,
  getPreset,
  getPresetsPath,
  listPresets,
  loadPresets,
  removePreset,
  savePresets,
} from '../../src/presets'

describe('presets', () => {
  let tempDir: string
  let originalHome: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'flt-test-presets-'))
    originalHome = process.env.HOME
    process.env.HOME = tempDir
  })

  afterEach(() => {
    process.env.HOME = originalHome
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('seeds default preset when presets file does not exist', () => {
    expect(loadPresets()).toEqual({
      default: { cli: 'claude-code', model: 'sonnet', description: 'Default agent' },
    })
  })

  it('saves and loads presets', () => {
    savePresets({
      reviewer: { cli: 'claude-code', model: 'opus', description: 'Detailed review' },
      coder: { cli: 'codex', model: 'gpt-5.3-codex' },
    })

    const loaded = loadPresets()
    expect(loaded.coder).toEqual({ cli: 'codex', model: 'gpt-5.3-codex', description: undefined })
    expect(loaded.reviewer).toEqual({ cli: 'claude-code', model: 'opus', description: 'Detailed review' })

    const persisted = readFileSync(getPresetsPath(), 'utf-8')
    expect(persisted).toContain('"coder"')
    expect(persisted).toContain('"reviewer"')
  })

  it('adds presets and lists them by name', () => {
    addPreset('reviewer', { cli: 'claude-code', model: 'opus', description: 'Thorough review' })
    addPreset('coder', { cli: 'codex', model: 'gpt-5.3-codex' })

    const names = listPresets().map((preset) => preset.name)
    expect(names).toEqual(['coder', 'default', 'reviewer'])
    expect(getPreset('coder')).toEqual({ cli: 'codex', model: 'gpt-5.3-codex', description: undefined })
  })

  it('throws when adding an existing preset', () => {
    addPreset('coder', { cli: 'codex', model: 'gpt-5.3-codex' })
    expect(() => addPreset('coder', { cli: 'codex', model: 'gpt-5.4-mini' })).toThrow('already exists')
  })

  it('removes presets', () => {
    addPreset('coder', { cli: 'codex', model: 'gpt-5.3-codex' })
    expect(removePreset('coder')).toBe(true)
    expect(removePreset('coder')).toBe(false)
    expect(getPreset('coder')).toBeUndefined()
  })

  it('throws on invalid preset file shape', () => {
    const fltDir = join(tempDir, '.flt')
    mkdirSync(fltDir, { recursive: true })
    writeFileSync(join(fltDir, 'presets.json'), '{"bad":{"cli":"codex"}}\n')
    expect(() => loadPresets()).toThrow('missing "model"')
  })

  it('throws on invalid preset name', () => {
    expect(() => addPreset('bad name', { cli: 'codex', model: 'gpt-5.3-codex' })).toThrow('Preset name must')
  })
})
