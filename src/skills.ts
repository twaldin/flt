import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'
import type { CliAdapter } from './adapters/types'

const SKILL_FILE = 'SKILL.md'
const MANIFEST_PATH = join('.flt', '.managed-skills.json')
const SKILLS_MARKER_START = '<!-- flt:skills:start -->'
const SKILLS_MARKER_END = '<!-- flt:skills:end -->'

function home(): string {
  return process.env.HOME || require('os').homedir()
}

export interface SkillEntry {
  name: string
  description: string
  source: 'global'
  path: string
  cliSupport: string[]
  content?: string
}

interface ParsedFrontmatter {
  name?: string
  description?: string
  cliSupport?: string[]
  body: string
}

export interface ProjectSkillsResult {
  names: string[]
  warnings: string[]
}

interface ProjectSkillsOpts {
  requested?: string[]
  all?: boolean
}

function parseFrontmatter(raw: string): ParsedFrontmatter {
  const result: ParsedFrontmatter = { body: raw }

  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!match) return result

  const [, frontmatter, body] = match
  result.body = body

  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m)
  if (nameMatch) result.name = nameMatch[1].trim()

  const descMatch = frontmatter.match(/^description:\s*(.+)$/m)
  if (descMatch) result.description = descMatch[1].trim()

  const cliMatch = frontmatter.match(/^cli-support:\s*(.+)$/m)
  if (cliMatch) {
    const rawCli = cliMatch[1].trim()
    try {
      const parsed = JSON.parse(rawCli.replace(/'/g, '"'))
      result.cliSupport = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)]
    } catch {
      result.cliSupport = [rawCli.replace(/[\[\]"']/g, '').trim()]
    }
  }

  return result
}

function loadGlobalSkills(): Map<string, SkillEntry> {
  const globalDir = join(home(), '.flt', 'skills')
  if (!existsSync(globalDir)) return new Map()

  let entries: string[]
  try {
    entries = readdirSync(globalDir)
  } catch {
    return new Map()
  }

  const skills = new Map<string, SkillEntry>()
  for (const name of entries) {
    const skillDir = join(globalDir, name)
    try {
      if (!lstatSync(skillDir).isDirectory()) continue
    } catch {
      continue
    }

    const skillFile = join(skillDir, SKILL_FILE)
    if (!existsSync(skillFile)) continue

    let description = ''
    let content = ''
    let cliSupport: string[] = ['*']
    try {
      const raw = readFileSync(skillFile, 'utf-8')
      const parsed = parseFrontmatter(raw)
      description = parsed.description ?? ''
      content = parsed.body.trim()
      if (parsed.cliSupport) cliSupport = parsed.cliSupport
    } catch {
      // Best effort
    }

    skills.set(name, {
      name,
      description,
      source: 'global',
      path: skillDir,
      cliSupport,
      content,
    })
  }

  return skills
}

export function loadSkills(cli: string): SkillEntry[] {
  const skills = Array.from(loadGlobalSkills().values())
    .sort((a, b) => a.name.localeCompare(b.name))

  if (cli === '*') return skills
  return skills.filter(s => s.cliSupport.includes('*') || s.cliSupport.includes(cli))
}

function readManagedManifest(workDir: string): { files: string[] } {
  const manifest = join(workDir, MANIFEST_PATH)
  if (!existsSync(manifest)) return { files: [] }
  try {
    const parsed = JSON.parse(readFileSync(manifest, 'utf-8'))
    const files = Array.isArray(parsed?.files)
      ? parsed.files.filter((v: unknown) => typeof v === 'string')
      : []
    return { files }
  } catch {
    return { files: [] }
  }
}

function writeManagedManifest(workDir: string, files: string[]): void {
  const manifest = join(workDir, MANIFEST_PATH)
  mkdirSync(join(workDir, '.flt'), { recursive: true })
  writeFileSync(manifest, JSON.stringify({ files }, null, 2) + '\n', 'utf-8')
}

function removeManagedManifest(workDir: string): void {
  const manifest = join(workDir, MANIFEST_PATH)
  if (!existsSync(manifest)) return
  try { unlinkSync(manifest) } catch {}
}

export function projectSkills(
  workDir: string,
  adapter: CliAdapter,
  opts?: ProjectSkillsOpts,
): ProjectSkillsResult {
  const requested = (opts?.requested ?? []).map(v => v.trim()).filter(Boolean)
  const all = Boolean(opts?.all)
  const available = loadGlobalSkills()
  const warnings: string[] = []

  const selected: SkillEntry[] = []
  if (all) {
    selected.push(...Array.from(available.values()).sort((a, b) => a.name.localeCompare(b.name)))
  } else {
    for (const name of requested) {
      const skill = available.get(name)
      if (!skill) {
        warnings.push(`Skill "${name}" not found (looked in ${join(home(), '.flt', 'skills')})`)
        continue
      }
      selected.push(skill)
    }
  }

  const prior = readManagedManifest(workDir)
  for (const target of prior.files) {
    const full = join(workDir, target)
    try { rmSync(full, { force: true }) } catch {}
  }

  if (selected.length === 0) {
    writeManagedManifest(workDir, [])
    return { names: [], warnings }
  }

  const managedFiles: string[] = []
  const cliName = adapter.name

  if (cliName === 'claude-code') {
    const skillsRoot = join(workDir, '.claude', 'skills')
    for (const skill of selected) {
      const destDir = join(skillsRoot, skill.name)
      const destFile = join(destDir, SKILL_FILE)
      try {
        mkdirSync(destDir, { recursive: true })
        copyFileSync(join(skill.path, SKILL_FILE), destFile)
        managedFiles.push(join('.claude', 'skills', skill.name, SKILL_FILE))
      } catch {
        warnings.push(`Failed to copy skill "${skill.name}" to ${destFile}`)
      }
    }
  } else if (cliName === 'opencode') {
    const skillsRoot = join(workDir, '.opencode', 'skills')
    for (const skill of selected) {
      const destDir = join(skillsRoot, skill.name)
      const destFile = join(destDir, SKILL_FILE)
      try {
        mkdirSync(destDir, { recursive: true })
        copyFileSync(join(skill.path, SKILL_FILE), destFile)
        managedFiles.push(join('.opencode', 'skills', skill.name, SKILL_FILE))
      } catch {
        warnings.push(`Failed to copy skill "${skill.name}" to ${destFile}`)
      }
    }
  } else {
    // codex, gemini, swe-agent, pi — write mirrors + inject list into instruction file
    const mirrorsRoot = join(workDir, '.flt', 'skills')
    for (const skill of selected) {
      const destDir = join(mirrorsRoot, skill.name)
      const destFile = join(destDir, SKILL_FILE)
      try {
        mkdirSync(destDir, { recursive: true })
        copyFileSync(join(skill.path, SKILL_FILE), destFile)
        managedFiles.push(join('.flt', 'skills', skill.name, SKILL_FILE))
      } catch {
        warnings.push(`Failed to mirror skill "${skill.name}" to ${destFile}`)
      }
    }

    if (adapter.instructionFile) {
      const filePath = join(workDir, adapter.instructionFile)
      if (existsSync(filePath)) {
        const existing = readFileSync(filePath, 'utf-8')
        const block = buildSkillsListBlock(selected)
        if (existing.includes(SKILLS_MARKER_START)) {
          const re = new RegExp(
            `${escapeRegex(SKILLS_MARKER_START)}[\\s\\S]*?${escapeRegex(SKILLS_MARKER_END)}`,
          )
          writeFileSync(filePath, existing.replace(re, block))
        } else {
          writeFileSync(filePath, existing + '\n\n' + block + '\n')
        }
      }
    }
  }

  writeManagedManifest(workDir, managedFiles)
  return { names: selected.map(s => s.name), warnings }
}

export function cleanupSkills(workDir: string, adapter?: CliAdapter): void {
  const prior = readManagedManifest(workDir)
  for (const target of prior.files) {
    const full = join(workDir, target)
    try { rmSync(full, { force: true }) } catch {}
  }
  removeManagedManifest(workDir)

  if (!adapter) return

  const cliName = adapter.name
  if (cliName !== 'claude-code' && cliName !== 'opencode' && adapter.instructionFile) {
    const filePath = join(workDir, adapter.instructionFile)
    if (!existsSync(filePath)) return
    try {
      const existing = readFileSync(filePath, 'utf-8')
      if (!existing.includes(SKILLS_MARKER_START)) return
      const re = new RegExp(
        `\\n*${escapeRegex(SKILLS_MARKER_START)}[\\s\\S]*?${escapeRegex(SKILLS_MARKER_END)}\\n*`,
      )
      writeFileSync(filePath, existing.replace(re, '\n'))
    } catch {}
  }
}

function buildSkillsListBlock(skills: SkillEntry[]): string {
  const lines = [SKILLS_MARKER_START, '', '## Available Skills']
  for (const skill of skills) {
    lines.push(`- ${skill.name}: ${skill.description}`)
  }
  lines.push(SKILLS_MARKER_END)
  return lines.join('\n')
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
