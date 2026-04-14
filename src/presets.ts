import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export interface Preset {
  cli: string
  model: string
  description?: string
}

export interface NamedPreset extends Preset {
  name: string
}

export type PresetMap = Record<string, Preset>

function home(): string {
  return process.env.HOME || homedir()
}

export function getPresetsDir(): string {
  return join(home(), '.flt')
}

export function getPresetsPath(): string {
  return join(getPresetsDir(), 'presets.json')
}

function isValidName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name)
}

function validatePresetName(name: string): void {
  if (!isValidName(name)) {
    throw new Error('Preset name must be alphanumeric with dashes/underscores only.')
  }
}

function normalizeDescription(description: string | undefined): string | undefined {
  if (!description) return undefined
  const trimmed = description.trim()
  return trimmed ? trimmed : undefined
}

function validatePresetValue(name: string, value: unknown): Preset {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid preset "${name}": expected an object.`)
  }

  const preset = value as Record<string, unknown>
  if (typeof preset.cli !== 'string' || !preset.cli.trim()) {
    throw new Error(`Invalid preset "${name}": missing "cli".`)
  }
  if (typeof preset.model !== 'string' || !preset.model.trim()) {
    throw new Error(`Invalid preset "${name}": missing "model".`)
  }
  if (preset.description !== undefined && typeof preset.description !== 'string') {
    throw new Error(`Invalid preset "${name}": "description" must be a string.`)
  }

  return {
    cli: preset.cli,
    model: preset.model,
    description: normalizeDescription(preset.description as string | undefined),
  }
}

function sortPresetMap(presets: PresetMap): PresetMap {
  const sorted: PresetMap = {}
  for (const name of Object.keys(presets).sort()) {
    sorted[name] = presets[name]
  }
  return sorted
}

const DEFAULT_PRESETS: PresetMap = {
  default: { cli: 'claude-code', model: 'sonnet', description: 'Default agent' },
}

export function loadPresets(): PresetMap {
  try {
    const raw = readFileSync(getPresetsPath(), 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Preset file must contain a JSON object.')
    }

    const loaded: PresetMap = {}
    for (const [name, value] of Object.entries(parsed)) {
      validatePresetName(name)
      loaded[name] = validatePresetValue(name, value)
    }

    if (Object.keys(loaded).length === 0) {
      savePresets(DEFAULT_PRESETS)
      return { ...DEFAULT_PRESETS }
    }

    return loaded
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      savePresets(DEFAULT_PRESETS)
      return { ...DEFAULT_PRESETS }
    }
    if (error instanceof Error) {
      throw new Error(`Failed to load presets from ${getPresetsPath()}: ${error.message}`)
    }
    throw error
  }
}

export function savePresets(presets: PresetMap): void {
  const normalized: PresetMap = {}
  for (const [name, preset] of Object.entries(presets)) {
    validatePresetName(name)
    normalized[name] = validatePresetValue(name, preset)
  }

  mkdirSync(getPresetsDir(), { recursive: true })
  writeFileSync(getPresetsPath(), JSON.stringify(sortPresetMap(normalized), null, 2) + '\n')
}

export function listPresets(): NamedPreset[] {
  return Object.entries(loadPresets())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, preset]) => ({ name, ...preset }))
}

export function getPreset(name: string): Preset | undefined {
  validatePresetName(name)
  const presets = loadPresets()
  return presets[name]
}

export function addPreset(name: string, preset: Preset): void {
  validatePresetName(name)
  const presets = loadPresets()
  if (presets[name]) {
    throw new Error(`Preset "${name}" already exists.`)
  }

  presets[name] = validatePresetValue(name, preset)
  savePresets(presets)
}

export function removePreset(name: string): boolean {
  validatePresetName(name)
  const presets = loadPresets()
  if (!(name in presets)) {
    return false
  }

  delete presets[name]
  savePresets(presets)
  return true
}
