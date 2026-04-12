import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { loadSkills, projectSkills, cleanupSkills } from '../../src/skills'
import type { CliAdapter } from '../../src/adapters/types'

const claudeAdapter: CliAdapter = {
  name: 'claude-code',
  cliCommand: 'claude',
  instructionFile: 'CLAUDE.md',
  submitKeys: ['Enter'],
  spawnArgs: () => ['claude'],
  detectReady: () => 'ready',
  handleDialog: () => null,
  detectStatus: () => 'idle',
}

const aiderAdapter: CliAdapter = {
  name: 'aider',
  cliCommand: 'aider',
  instructionFile: '.flt-instructions.md',
  submitKeys: ['Enter'],
  spawnArgs: () => ['aider'],
  detectReady: () => 'ready',
  handleDialog: () => null,
  detectStatus: () => 'idle',
}

describe('skills', () => {
  let tempDir: string
  let origHome: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'flt-test-skills-'))
    origHome = process.env.HOME
    process.env.HOME = tempDir
  })

  afterEach(() => {
    process.env.HOME = origHome
    rmSync(tempDir, { recursive: true, force: true })
  })

  function createSkill(dir: string, filename: string, content: string) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, filename), content)
  }

  describe('loadSkills', () => {
    it('returns empty array when no skills dir exists', () => {
      expect(loadSkills('agent1', 'claude-code')).toEqual([])
    })

    it('loads global skills', () => {
      const skillsDir = join(tempDir, '.flt', 'skills')
      createSkill(skillsDir, 'my-skill.md', `---
name: my-skill
description: A test skill
cli-support: ["*"]
---
Do the thing.`)

      const skills = loadSkills('agent1', 'claude-code')
      expect(skills).toHaveLength(1)
      expect(skills[0].name).toBe('my-skill')
      expect(skills[0].description).toBe('A test skill')
      expect(skills[0].cliSupport).toEqual(['*'])
      expect(skills[0].content).toBe('Do the thing.')
      expect(skills[0].source).toBe('global')
    })

    it('filters skills by specific cli', () => {
      const skillsDir = join(tempDir, '.flt', 'skills')
      createSkill(skillsDir, 'claude-only.md', `---
name: claude-only
cli-support: ["claude-code"]
---
Claude skill.`)
      createSkill(skillsDir, 'aider-only.md', `---
name: aider-only
cli-support: ["aider"]
---
Aider skill.`)

      const claudeSkills = loadSkills('agent1', 'claude-code')
      expect(claudeSkills.map(s => s.name)).toContain('claude-only')
      expect(claudeSkills.map(s => s.name)).not.toContain('aider-only')

      const aiderSkills = loadSkills('agent1', 'aider')
      expect(aiderSkills.map(s => s.name)).not.toContain('claude-only')
      expect(aiderSkills.map(s => s.name)).toContain('aider-only')
    })

    it('wildcard cli-support in frontmatter matches all CLIs', () => {
      const skillsDir = join(tempDir, '.flt', 'skills')
      createSkill(skillsDir, 'universal.md', `---
name: universal
cli-support: ["*"]
---
Works everywhere.`)

      expect(loadSkills('agent1', 'claude-code')).toHaveLength(1)
      expect(loadSkills('agent1', 'aider')).toHaveLength(1)
      expect(loadSkills('agent1', 'codex')).toHaveLength(1)
    })

    it('cli="*" returns all skills regardless of cli-support', () => {
      const skillsDir = join(tempDir, '.flt', 'skills')
      createSkill(skillsDir, 'claude-only.md', `---
name: claude-only
cli-support: ["claude-code"]
---
Claude only.`)
      createSkill(skillsDir, 'any-cli.md', `---
name: any-cli
cli-support: ["*"]
---
Any CLI.`)

      const all = loadSkills('agent1', '*')
      expect(all.map(s => s.name)).toContain('claude-only')
      expect(all.map(s => s.name)).toContain('any-cli')
    })

    it('agent-local skills take precedence over global on name collision', () => {
      const globalDir = join(tempDir, '.flt', 'skills')
      const agentDir = join(tempDir, '.flt', 'agents', 'agent1', 'skills')

      createSkill(globalDir, 'shared.md', `---
name: shared
description: global version
cli-support: ["*"]
---
Global content.`)
      createSkill(agentDir, 'shared.md', `---
name: shared
description: agent version
cli-support: ["*"]
---
Agent content.`)

      const skills = loadSkills('agent1', 'claude-code')
      expect(skills).toHaveLength(1)
      expect(skills[0].description).toBe('agent version')
      expect(skills[0].source).toBe('agent-local')
    })

    it('loads agent-local skills not present in global', () => {
      const agentDir = join(tempDir, '.flt', 'agents', 'agent1', 'skills')
      createSkill(agentDir, 'agent-specific.md', `---
name: agent-specific
cli-support: ["*"]
---
Only for this agent.`)

      const skills = loadSkills('agent1', 'claude-code')
      expect(skills).toHaveLength(1)
      expect(skills[0].source).toBe('agent-local')
    })

    it('falls back to filename as name when no frontmatter', () => {
      const skillsDir = join(tempDir, '.flt', 'skills')
      createSkill(skillsDir, 'no-frontmatter.md', 'Just content.')

      const skills = loadSkills('agent1', 'claude-code')
      expect(skills).toHaveLength(1)
      expect(skills[0].name).toBe('no-frontmatter')
      expect(skills[0].cliSupport).toEqual(['*'])
      expect(skills[0].description).toBe('')
    })
  })

  describe('projectSkills for claude-code', () => {
    it('creates flt-managed command files in ~/.claude/commands/', () => {
      const skillsDir = join(tempDir, '.flt', 'skills')
      createSkill(skillsDir, 'my-skill.md', `---
name: my-skill
cli-support: ["*"]
---
Do the thing.`)

      const workDir = mkdtempSync(join(tmpdir(), 'flt-proj-'))
      try {
        projectSkills(workDir, claudeAdapter, 'agent1')

        const commandPath = join(tempDir, '.claude', 'commands', 'my-skill.md')
        expect(existsSync(commandPath)).toBe(true)
        const content = readFileSync(commandPath, 'utf-8')
        expect(content).toContain('<!-- flt-managed -->')
        expect(content).toContain('Do the thing.')
      } finally {
        rmSync(workDir, { recursive: true, force: true })
      }
    })

    it('does nothing when no skills exist', () => {
      const workDir = mkdtempSync(join(tmpdir(), 'flt-proj-'))
      try {
        projectSkills(workDir, claudeAdapter, 'agent1')
        expect(existsSync(join(tempDir, '.claude', 'commands'))).toBe(false)
      } finally {
        rmSync(workDir, { recursive: true, force: true })
      }
    })

    it('skips skills not matching the CLI', () => {
      const skillsDir = join(tempDir, '.flt', 'skills')
      createSkill(skillsDir, 'aider-only.md', `---
name: aider-only
cli-support: ["aider"]
---
Aider skill.`)

      const workDir = mkdtempSync(join(tmpdir(), 'flt-proj-'))
      try {
        projectSkills(workDir, claudeAdapter, 'agent1')
        expect(existsSync(join(tempDir, '.claude', 'commands', 'aider-only.md'))).toBe(false)
      } finally {
        rmSync(workDir, { recursive: true, force: true })
      }
    })
  })

  describe('projectSkills for non-claude-code', () => {
    it('appends skills block to instruction file', () => {
      const skillsDir = join(tempDir, '.flt', 'skills')
      createSkill(skillsDir, 'my-skill.md', `---
name: my-skill
cli-support: ["*"]
---
Do the thing.`)

      const workDir = mkdtempSync(join(tmpdir(), 'flt-proj-'))
      try {
        writeFileSync(join(workDir, '.flt-instructions.md'), '# Instructions')
        projectSkills(workDir, aiderAdapter, 'agent1')

        const content = readFileSync(join(workDir, '.flt-instructions.md'), 'utf-8')
        expect(content).toContain('<!-- flt:skills:start -->')
        expect(content).toContain('<!-- flt:skills:end -->')
        expect(content).toContain('Do the thing.')
        expect(content).toContain('# Instructions')
      } finally {
        rmSync(workDir, { recursive: true, force: true })
      }
    })

    it('replaces existing skills block on re-projection', () => {
      const skillsDir = join(tempDir, '.flt', 'skills')
      createSkill(skillsDir, 'my-skill.md', `---
name: my-skill
cli-support: ["*"]
---
Do the thing.`)

      const workDir = mkdtempSync(join(tmpdir(), 'flt-proj-'))
      try {
        writeFileSync(join(workDir, '.flt-instructions.md'), '# Instructions')
        projectSkills(workDir, aiderAdapter, 'agent1')

        writeFileSync(join(skillsDir, 'my-skill.md'), `---
name: my-skill
cli-support: ["*"]
---
Do the new thing.`)

        projectSkills(workDir, aiderAdapter, 'agent1')

        const content = readFileSync(join(workDir, '.flt-instructions.md'), 'utf-8')
        expect(content).toContain('Do the new thing.')
        expect(content).not.toContain('Do the thing.')
        expect(content.split('<!-- flt:skills:start -->').length - 1).toBe(1)
      } finally {
        rmSync(workDir, { recursive: true, force: true })
      }
    })

    it('does nothing when instruction file does not exist', () => {
      const skillsDir = join(tempDir, '.flt', 'skills')
      createSkill(skillsDir, 'my-skill.md', `---
name: my-skill
cli-support: ["*"]
---
Content.`)

      const workDir = mkdtempSync(join(tmpdir(), 'flt-proj-'))
      try {
        // No instruction file created — should not throw
        projectSkills(workDir, aiderAdapter, 'agent1')
        expect(existsSync(join(workDir, '.flt-instructions.md'))).toBe(false)
      } finally {
        rmSync(workDir, { recursive: true, force: true })
      }
    })
  })

  describe('cleanupSkills for claude-code', () => {
    it('removes flt-managed command files', () => {
      const skillsDir = join(tempDir, '.flt', 'skills')
      createSkill(skillsDir, 'my-skill.md', `---
name: my-skill
cli-support: ["*"]
---
Do the thing.`)

      const workDir = mkdtempSync(join(tmpdir(), 'flt-proj-'))
      try {
        projectSkills(workDir, claudeAdapter, 'agent1')
        const commandPath = join(tempDir, '.claude', 'commands', 'my-skill.md')
        expect(existsSync(commandPath)).toBe(true)

        cleanupSkills(workDir, claudeAdapter, 'agent1')
        expect(existsSync(commandPath)).toBe(false)
      } finally {
        rmSync(workDir, { recursive: true, force: true })
      }
    })

    it('does not remove non-flt-managed command files', () => {
      const commandsDir = join(tempDir, '.claude', 'commands')
      mkdirSync(commandsDir, { recursive: true })
      const manualPath = join(commandsDir, 'manual-skill.md')
      writeFileSync(manualPath, '# Manual skill\nNot managed by flt.')

      const workDir = mkdtempSync(join(tmpdir(), 'flt-proj-'))
      try {
        cleanupSkills(workDir, claudeAdapter, 'agent1')
        expect(existsSync(manualPath)).toBe(true)
      } finally {
        rmSync(workDir, { recursive: true, force: true })
      }
    })

    it('handles missing commands dir gracefully', () => {
      const skillsDir = join(tempDir, '.flt', 'skills')
      createSkill(skillsDir, 'my-skill.md', `---
name: my-skill
cli-support: ["*"]
---
Content.`)

      const workDir = mkdtempSync(join(tmpdir(), 'flt-proj-'))
      try {
        // No commands dir exists — should not throw
        cleanupSkills(workDir, claudeAdapter, 'agent1')
      } finally {
        rmSync(workDir, { recursive: true, force: true })
      }
    })
  })

  describe('cleanupSkills for non-claude-code', () => {
    it('removes skills block from instruction file', () => {
      const skillsDir = join(tempDir, '.flt', 'skills')
      createSkill(skillsDir, 'my-skill.md', `---
name: my-skill
cli-support: ["*"]
---
Do the thing.`)

      const workDir = mkdtempSync(join(tmpdir(), 'flt-proj-'))
      try {
        writeFileSync(join(workDir, '.flt-instructions.md'), '# Instructions')
        projectSkills(workDir, aiderAdapter, 'agent1')
        cleanupSkills(workDir, aiderAdapter, 'agent1')

        const content = readFileSync(join(workDir, '.flt-instructions.md'), 'utf-8')
        expect(content).not.toContain('<!-- flt:skills:start -->')
        expect(content).not.toContain('<!-- flt:skills:end -->')
        expect(content).toContain('# Instructions')
      } finally {
        rmSync(workDir, { recursive: true, force: true })
      }
    })

    it('handles missing instruction file gracefully', () => {
      const workDir = mkdtempSync(join(tmpdir(), 'flt-proj-'))
      try {
        cleanupSkills(workDir, aiderAdapter, 'agent1') // Should not throw
      } finally {
        rmSync(workDir, { recursive: true, force: true })
      }
    })

    it('handles instruction file with no skills block gracefully', () => {
      const workDir = mkdtempSync(join(tmpdir(), 'flt-proj-'))
      try {
        writeFileSync(join(workDir, '.flt-instructions.md'), '# Instructions only')
        cleanupSkills(workDir, aiderAdapter, 'agent1') // Should not throw or modify
        expect(readFileSync(join(workDir, '.flt-instructions.md'), 'utf-8')).toBe('# Instructions only')
      } finally {
        rmSync(workDir, { recursive: true, force: true })
      }
    })
  })
})
