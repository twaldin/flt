import { createHash } from 'crypto'
import { existsSync, lstatSync, readdirSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { isAbsolute, join } from 'path'
import type { Preset } from '../presets'
import type { Treatment } from './types'

function hash(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

function resolveRolePath(soul: string): string {
  return isAbsolute(soul) ? soul : join(process.env.HOME ?? homedir(), '.flt', soul)
}

function listAllSkillNames(): string[] {
  const skillsDir = join(process.env.HOME ?? homedir(), '.flt', 'skills')
  if (!existsSync(skillsDir)) return []
  try {
    return readdirSync(skillsDir).filter(name => {
      const dir = join(skillsDir, name)
      try {
        return lstatSync(dir).isDirectory() && existsSync(join(dir, 'SKILL.md'))
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

export function computeTreatment(preset: Preset, workflowYamlPath: string): Treatment {
  let roleContent = ''
  if (preset.soul) {
    try {
      roleContent = readFileSync(resolveRolePath(preset.soul), 'utf-8')
    } catch {
      roleContent = ''
    }
  }

  const enabledSkills = preset.allSkills ? listAllSkillNames() : (preset.skills ?? [])
  const skillHashes: Record<string, string> = {}
  for (const skillName of enabledSkills) {
    const skillPath = join(process.env.HOME ?? homedir(), '.flt', 'skills', skillName, 'SKILL.md')
    try {
      skillHashes[skillName] = hash(readFileSync(skillPath, 'utf-8'))
    } catch {
      // omit missing/unreadable skill files
    }
  }

  return {
    roleHash: hash(roleContent),
    skillHashes,
    workflowHash: hash(readFileSync(workflowYamlPath)),
  }
}

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

function mulberry32(seed: number): () => number {
  let t = seed
  return () => {
    t += 0x6D2B79F5
    let x = Math.imul(t ^ (t >>> 15), t | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}
