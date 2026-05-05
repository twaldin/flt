import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export interface Preset {
  cli: string
  model: string
  description?: string
  soul?: string       // path to SOUL.md: "roles/<role>.md" (template) or "agents/<name>/SOUL.md" (persistent), relative to ~/.flt/. Absolute paths also accepted.
  dir?: string        // working directory (~ expanded at resolve time)
  parent?: string     // parent agent name
  worktree?: boolean  // false = --no-worktree
  persistent?: boolean
  pr_adapter?: 'gh' | 'gt' | 'manual'
  skills?: string[]   // opt-in skills enabled for this preset
  allSkills?: boolean // enable all discoverable skills
  env?: Record<string, string>  // extra env vars merged into the spawn; ${VAR} expands from process.env at resolve time
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
  if (preset.soul !== undefined && typeof preset.soul !== 'string') {
    throw new Error(`Invalid preset "${name}": "soul" must be a string path.`)
  }
  if (preset.dir !== undefined && typeof preset.dir !== 'string') {
    throw new Error(`Invalid preset "${name}": "dir" must be a string path.`)
  }
  if (preset.parent !== undefined && typeof preset.parent !== 'string') {
    throw new Error(`Invalid preset "${name}": "parent" must be a string.`)
  }
  if (preset.worktree !== undefined && typeof preset.worktree !== 'boolean') {
    throw new Error(`Invalid preset "${name}": "worktree" must be a boolean.`)
  }
  if (preset.persistent !== undefined && typeof preset.persistent !== 'boolean') {
    throw new Error(`Invalid preset "${name}": "persistent" must be a boolean.`)
  }
  if (preset.pr_adapter !== undefined && preset.pr_adapter !== 'gh' && preset.pr_adapter !== 'gt' && preset.pr_adapter !== 'manual') {
    throw new Error(`Invalid preset "${name}": "pr_adapter" must be one of: gh, gt, manual`)
  }
  let envNormalized: Record<string, string> | undefined
  if (preset.skills !== undefined) {
    if (!Array.isArray(preset.skills) || preset.skills.some(v => typeof v !== 'string' || !v.trim())) {
      throw new Error(`Invalid preset "${name}": "skills" must be an array of non-empty strings.`)
    }
  }
  if (preset.allSkills !== undefined && typeof preset.allSkills !== 'boolean') {
    throw new Error(`Invalid preset "${name}": "allSkills" must be a boolean.`)
  }

  if (preset.env !== undefined) {
    if (typeof preset.env !== 'object' || preset.env === null || Array.isArray(preset.env)) {
      throw new Error(`Invalid preset "${name}": "env" must be an object mapping string to string.`)
    }
    const entries: Record<string, string> = {}
    for (const [k, v] of Object.entries(preset.env as Record<string, unknown>)) {
      if (typeof v !== 'string') {
        throw new Error(`Invalid preset "${name}": env["${k}"] must be a string.`)
      }
      entries[k] = v
    }
    envNormalized = Object.keys(entries).length > 0 ? entries : undefined
  }

  return {
    cli: preset.cli,
    model: preset.model,
    description: normalizeDescription(preset.description as string | undefined),
    soul: typeof preset.soul === 'string' ? preset.soul.trim() || undefined : undefined,
    dir: typeof preset.dir === 'string' ? preset.dir.trim() || undefined : undefined,
    parent: typeof preset.parent === 'string' ? preset.parent.trim() || undefined : undefined,
    worktree: typeof preset.worktree === 'boolean' ? preset.worktree : undefined,
    persistent: typeof preset.persistent === 'boolean' ? preset.persistent : undefined,
    pr_adapter: preset.pr_adapter === 'gh' || preset.pr_adapter === 'gt' || preset.pr_adapter === 'manual' ? preset.pr_adapter : undefined,
    skills: Array.isArray(preset.skills) ? preset.skills.map(v => String(v).trim()).filter(Boolean) : undefined,
    allSkills: typeof preset.allSkills === 'boolean' ? preset.allSkills : undefined,
    env: envNormalized,
  }
}

// Lazy-load ~/.env into a cached lookup map so daemons/crons that didn't
// source .env themselves can still resolve ${VAR} placeholders. Reloaded
// on each call to pick up edits between spawns.
function loadDotenv(): Record<string, string> {
  const path = join(home(), '.env')
  try {
    const raw = readFileSync(path, 'utf-8')
    const out: Record<string, string> = {}
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i)
      if (!m) continue
      let v = m[2].trim()
      // Strip surrounding quotes if symmetric
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      out[m[1]] = v
    }
    return out
  } catch {
    return {}
  }
}

// ${VAR} → process.env[VAR] first, then ~/.env fallback, else literal.
// Literal fallback surfaces missing secrets visibly instead of producing
// empty strings that silently fail downstream auth.
export function resolvePresetEnv(env: Record<string, string> | undefined): Record<string, string> {
  if (!env) return {}
  const dotenv = loadDotenv()
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    out[k] = v.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/gi, (_m, name) => {
      return process.env[name] ?? dotenv[name] ?? `\${${name}}`
    })
  }
  return out
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
