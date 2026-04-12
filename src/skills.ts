import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import type { CliAdapter } from './adapters/types'

const SKILLS_MARKER_START = '<!-- flt:skills:start -->'
const SKILLS_MARKER_END = '<!-- flt:skills:end -->'
const FLT_MANAGED_COMMENT = '<!-- flt-managed -->'

function home(): string {
  return process.env.HOME || require('os').homedir()
}

export interface SkillEntry {
  name: string
  description: string
  cliSupport: string[]
  content: string
  source: 'global' | 'agent-local'
}

interface ParsedFrontmatter {
  name?: string
  description?: string
  cliSupport?: string[]
  body: string
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
    const raw = cliMatch[1].trim()
    try {
      const parsed = JSON.parse(raw.replace(/'/g, '"'))
      result.cliSupport = Array.isArray(parsed) ? parsed : [String(parsed)]
    } catch {
      result.cliSupport = [raw.replace(/[[\]"']/g, '').trim()]
    }
  }

  return result
}

function loadSkillsFromDir(dir: string, source: 'global' | 'agent-local'): SkillEntry[] {
  if (!existsSync(dir)) return []

  let files: string[]
  try {
    files = readdirSync(dir).filter(f => f.endsWith('.md'))
  } catch {
    return []
  }

  const skills: SkillEntry[] = []
  for (const file of files) {
    const raw = readFileSync(join(dir, file), 'utf-8')
    const parsed = parseFrontmatter(raw)
    skills.push({
      name: parsed.name ?? file.replace(/\.md$/, ''),
      description: parsed.description ?? '',
      cliSupport: parsed.cliSupport ?? ['*'],
      content: parsed.body.trim(),
      source,
    })
  }

  return skills
}

// Load all skills from ~/.flt/skills/ and optionally ~/.flt/agents/<agentName>/skills/
// Filter by cli-support matching the target CLI ('*' as cli matches all)
// Returns array of { name, description, content } objects
export function loadSkills(agentName: string, cli: string): SkillEntry[] {
  const globalDir = join(home(), '.flt', 'skills')
  const agentDir = join(home(), '.flt', 'agents', agentName, 'skills')

  const globalSkills = loadSkillsFromDir(globalDir, 'global')
  const agentSkills = loadSkillsFromDir(agentDir, 'agent-local')

  // Agent-local takes precedence on name collision
  const merged = new Map<string, SkillEntry>()
  for (const skill of globalSkills) merged.set(skill.name, skill)
  for (const skill of agentSkills) merged.set(skill.name, skill)

  return Array.from(merged.values()).filter(skill =>
    cli === '*' || skill.cliSupport.includes('*') || skill.cliSupport.includes(cli)
  )
}

// Project skills into a workspace.
// For claude-code: register each skill as ~/.claude/commands/<name>.md
// For all other CLIs: append skills as sections to the instruction file
export function projectSkills(workDir: string, adapter: CliAdapter, agentName: string): void {
  const skills = loadSkills(agentName, adapter.name)
  if (skills.length === 0) return

  if (adapter.name === 'claude-code') {
    const commandsDir = join(home(), '.claude', 'commands')
    mkdirSync(commandsDir, { recursive: true })

    for (const skill of skills) {
      writeFileSync(
        join(commandsDir, `${skill.name}.md`),
        `${FLT_MANAGED_COMMENT}\n${skill.content}\n`,
      )
    }
  } else {
    if (!adapter.instructionFile) return

    const filePath = join(workDir, adapter.instructionFile)
    if (!existsSync(filePath)) return

    const existing = readFileSync(filePath, 'utf-8')
    const skillsBlock = buildSkillsBlock(skills)

    if (existing.includes(SKILLS_MARKER_START)) {
      const re = new RegExp(
        `${escapeRegex(SKILLS_MARKER_START)}[\\s\\S]*?${escapeRegex(SKILLS_MARKER_END)}`,
      )
      writeFileSync(filePath, existing.replace(re, skillsBlock))
    } else {
      writeFileSync(filePath, existing + '\n\n' + skillsBlock + '\n')
    }
  }
}

// Remove projected skills (cleanup on kill)
export function cleanupSkills(workDir: string, adapter: CliAdapter, agentName: string): void {
  if (adapter.name === 'claude-code') {
    const commandsDir = join(home(), '.claude', 'commands')
    const skills = loadSkills(agentName, adapter.name)

    for (const skill of skills) {
      const commandPath = join(commandsDir, `${skill.name}.md`)
      if (!existsSync(commandPath)) continue
      const content = readFileSync(commandPath, 'utf-8')
      if (content.includes(FLT_MANAGED_COMMENT)) {
        try { unlinkSync(commandPath) } catch {}
      }
    }
  } else {
    if (!adapter.instructionFile) return

    const filePath = join(workDir, adapter.instructionFile)
    if (!existsSync(filePath)) return

    const existing = readFileSync(filePath, 'utf-8')
    if (!existing.includes(SKILLS_MARKER_START)) return

    const re = new RegExp(
      `\\n*${escapeRegex(SKILLS_MARKER_START)}[\\s\\S]*?${escapeRegex(SKILLS_MARKER_END)}\\n*`,
    )
    writeFileSync(filePath, existing.replace(re, ''))
  }
}

function buildSkillsBlock(skills: SkillEntry[]): string {
  const parts = [SKILLS_MARKER_START]

  for (const skill of skills) {
    parts.push(`\n## Skill: ${skill.name}`)
    if (skill.description) parts.push(`_${skill.description}_`)
    parts.push('')
    parts.push(skill.content)
  }

  parts.push(SKILLS_MARKER_END)
  return parts.join('\n')
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
