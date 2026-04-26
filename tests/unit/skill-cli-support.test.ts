import { describe, it, expect } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

function getSkillFiles(): Array<{ name: string; path: string }> {
  const home = process.env.HOME
  if (!home) return []

  const skillsDir = join(home, '.flt', 'skills')
  if (!existsSync(skillsDir)) return []

  return readdirSync(skillsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const path = join(skillsDir, entry.name, 'SKILL.md')
      return { name: entry.name, path }
    })
    .filter(entry => existsSync(entry.path))
}

function getFrontmatter(content: string): string | null {
  if (!content.startsWith('---\n')) return null
  const end = content.indexOf('\n---\n', 4)
  if (end === -1) return null
  return content.slice(4, end)
}

function getCliSupport(frontmatter: string | null): string[] {
  if (!frontmatter) return []
  const match = frontmatter.match(/^cli-support:\s*\[(.*?)\]\s*$/m)
  if (!match) return []
  return match[1]
    .split(',')
    .map(v => v.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
}

describe('skill cli-support frontmatter', () => {
  it('ensures every SKILL.md has cli-support', () => {
    const skills = getSkillFiles()

    for (const skill of skills) {
      const content = readFileSync(skill.path, 'utf8')
      const frontmatter = getFrontmatter(content)
      expect(frontmatter, `${skill.name} must have frontmatter`).not.toBeNull()
      expect(frontmatter, `${skill.name} must define cli-support`).toContain('cli-support:')
    }
  })

  it('tags claude-api as [claude-code] when present', () => {
    const skill = getSkillFiles().find(s => s.name === 'claude-api')
    if (!skill) return

    const content = readFileSync(skill.path, 'utf8')
    const cliSupport = getCliSupport(getFrontmatter(content))
    expect(cliSupport).toContain('claude-code')
  })

  it('tags at least one universal skill (pdf/xlsx) as [all] when present', () => {
    const candidates = getSkillFiles().filter(s => s.name === 'pdf' || s.name === 'xlsx')
    if (candidates.length === 0) return

    const universalCount = candidates.filter(skill => {
      const content = readFileSync(skill.path, 'utf8')
      const cliSupport = getCliSupport(getFrontmatter(content))
      return cliSupport.includes('all')
    }).length

    expect(universalCount).toBeGreaterThan(0)
  })
})
