import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'

export type ArtifactType = 'spec' | 'design' | 'handoff' | 'scratch' | 'blocker' | 'eval' | 'diff' | 'log' | 'screenshot' | 'summary'
export type ArtifactStatus = 'active' | 'consumed' | 'expired' | 'durable'

export interface ArtifactEntry {
  path: string
  type: ArtifactType
  owner_agent: string
  status: ArtifactStatus
  keep: boolean
}

export interface ArtifactManifest {
  artifacts: ArtifactEntry[]
}

function manifestPath(runDir: string): string {
  return join(runDir, 'manifest.json')
}

export function readManifest(runDir: string): ArtifactManifest {
  const path = manifestPath(runDir)
  if (!existsSync(path)) return { artifacts: [] }
  return JSON.parse(readFileSync(path, 'utf-8')) as ArtifactManifest
}

export function writeManifest(runDir: string, manifest: ArtifactManifest): void {
  mkdirSync(runDir, { recursive: true })
  const path = manifestPath(runDir)
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n')
  renameSync(tmp, path)
}

export function addArtifact(runDir: string, entry: ArtifactEntry): void {
  const manifest = readManifest(runDir)
  manifest.artifacts.push(entry)
  writeManifest(runDir, manifest)
}

export function markConsumed(runDir: string, path: string): void {
  const manifest = readManifest(runDir)
  for (const artifact of manifest.artifacts) {
    if (artifact.path === path) artifact.status = 'consumed'
  }
  writeManifest(runDir, manifest)
}

export function markExpired(runDir: string, path: string): void {
  const manifest = readManifest(runDir)
  for (const artifact of manifest.artifacts) {
    if (artifact.path === path) artifact.status = 'expired'
  }
  writeManifest(runDir, manifest)
}
