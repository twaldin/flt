import { createHash } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getPreset } from '../presets'
import { loadSkills } from '../skills'
import type { WorkflowTreatment } from './types'

export function permuteTreatmentMap(n: number, presets: string[], seed: number): Record<string, string> {
  if (n < 1 || n > 26) {
    throw new Error('n must be between 1 and 26')
  }

  if (presets.length !== n) {
    throw new Error('presets.length must equal n')
  }

  const rand = mulberry32(seed)
  const shuffled = presets.slice()

  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = shuffled[i]
    shuffled[i] = shuffled[j]
    shuffled[j] = tmp
  }

  const map: Record<string, string> = {}
  for (let i = 0; i < n; i += 1) {
    map[String.fromCharCode(97 + i)] = shuffled[i]
  }

  return map
}

export function buildWorkflowTreatment(workflowName: string, presetName: string): WorkflowTreatment {
  const preset = getPreset(presetName)
  const rolePath = preset?.soul
    ? (preset.soul.startsWith('/') ? preset.soul : join(getFltDir(), preset.soul))
    : ''

  const roleContent = rolePath && existsSync(rolePath)
    ? readFileSync(rolePath, 'utf-8')
    : ''

  const availableSkills = new Map(loadSkills('*').map(skill => [skill.name, skill]))
  const selectedSkillNames = preset?.allSkills
    ? Array.from(availableSkills.keys())
    : (preset?.skills ?? [])

  const skillHashes: Record<string, string> = {}
  for (const name of selectedSkillNames.slice().sort()) {
    const entry = availableSkills.get(name)
    if (!entry) continue
    const skillPath = join(entry.path, 'SKILL.md')
    if (!existsSync(skillPath)) continue
    skillHashes[name] = sha256(readFileSync(skillPath, 'utf-8'))
  }

  const workflowPath = resolveWorkflowPath(workflowName)
  const workflowContent = workflowPath && existsSync(workflowPath)
    ? readFileSync(workflowPath, 'utf-8')
    : ''

  return {
    roleHash: sha256(roleContent),
    skillHashes,
    workflowHash: sha256(workflowContent),
  }
}

function resolveWorkflowPath(workflowName: string): string {
  const workflowsDir = join(getFltDir(), 'workflows')
  const yamlPath = join(workflowsDir, `${workflowName}.yaml`)
  if (existsSync(yamlPath)) return yamlPath
  return join(workflowsDir, `${workflowName}.yml`)
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
}

function getFltDir(): string {
  return join(process.env.HOME ?? require('os').homedir(), '.flt')
}

function mulberry32(seed: number): () => number {
  let t = seed
  return () => {
    t += 0x6D2B79F5
    let x = Math.imul(t ^ (t >>> 15), t | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}
