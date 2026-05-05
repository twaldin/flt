import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export interface RemoteEntry {
  host: string
  user?: string
  port?: number
  identityFile?: string
}

export type RemoteMap = Record<string, RemoteEntry>

function home(): string {
  return process.env.HOME || homedir()
}

export function getRemotesDir(): string {
  return join(home(), '.flt')
}

export function getRemotesPath(): string {
  return join(getRemotesDir(), 'remotes.json')
}

function isValidAlias(alias: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(alias)
}

function validateAlias(alias: string): void {
  if (!isValidAlias(alias)) {
    throw new Error('Remote alias must be alphanumeric with dashes/underscores only.')
  }
}

function validateAliasOrHost(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('Remote alias/host must be non-empty.')
  }
  return trimmed
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new Error('Expected string.')
  }
  const trimmed = value.trim()
  return trimmed || undefined
}

function validateRemoteEntry(name: string, value: unknown): RemoteEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid remote "${name}": expected an object.`)
  }

  const entry = value as Record<string, unknown>
  if (typeof entry.host !== 'string' || !entry.host.trim()) {
    throw new Error(`Invalid remote "${name}": "host" must be a non-empty string.`)
  }
  if (entry.user !== undefined && typeof entry.user !== 'string') {
    throw new Error(`Invalid remote "${name}": "user" must be a string.`)
  }
  if (entry.port !== undefined && (!Number.isInteger(entry.port) || (entry.port as number) <= 0)) {
    throw new Error(`Invalid remote "${name}": "port" must be a positive integer.`)
  }
  if (entry.identityFile !== undefined && typeof entry.identityFile !== 'string') {
    throw new Error(`Invalid remote "${name}": "identityFile" must be a string.`)
  }

  return {
    host: entry.host.trim(),
    user: normalizeOptionalString(entry.user),
    port: typeof entry.port === 'number' ? entry.port : undefined,
    identityFile: normalizeOptionalString(entry.identityFile),
  }
}

function sortRemoteMap(remotes: RemoteMap): RemoteMap {
  const sorted: RemoteMap = {}
  for (const name of Object.keys(remotes).sort()) {
    sorted[name] = remotes[name]
  }
  return sorted
}

export function loadRemotes(): RemoteMap {
  try {
    const raw = readFileSync(getRemotesPath(), 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Remotes file must contain a JSON object.')
    }

    const loaded: RemoteMap = {}
    for (const [alias, value] of Object.entries(parsed)) {
      validateAlias(alias)
      loaded[alias] = validateRemoteEntry(alias, value)
    }
    return loaded
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }
    if (error instanceof Error) {
      throw new Error(`Failed to load remotes from ${getRemotesPath()}: ${error.message}`)
    }
    throw error
  }
}

export function saveRemotes(remotes: RemoteMap): void {
  const normalized: RemoteMap = {}
  for (const [alias, value] of Object.entries(remotes)) {
    validateAlias(alias)
    normalized[alias] = validateRemoteEntry(alias, value)
  }

  mkdirSync(getRemotesDir(), { recursive: true })
  const path = getRemotesPath()
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(sortRemoteMap(normalized), null, 2) + '\n')
  renameSync(tmp, path)
}

export function addRemote(alias: string, entry: RemoteEntry): void {
  validateAlias(alias)
  const remotes = loadRemotes()
  if (remotes[alias]) {
    throw new Error(`Remote "${alias}" already exists.`)
  }
  remotes[alias] = validateRemoteEntry(alias, entry)
  saveRemotes(remotes)
}

export function removeRemote(alias: string): boolean {
  validateAlias(alias)
  const remotes = loadRemotes()
  if (!(alias in remotes)) {
    return false
  }
  delete remotes[alias]
  saveRemotes(remotes)
  return true
}

export function getRemote(alias: string): RemoteEntry | undefined {
  validateAlias(alias)
  return loadRemotes()[alias]
}

export function resolveRemote(aliasOrHost: string): RemoteEntry {
  const value = validateAliasOrHost(aliasOrHost)
  const remotes = loadRemotes()
  const hit = remotes[value]
  if (hit) {
    return hit
  }
  return { host: value }
}
