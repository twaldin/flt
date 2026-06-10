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

const opencodeAdapter: CliAdapter = {
  name: 'opencode',
  cliCommand: 'opencode',
  instructionFile: '.opencode/AGENTS.md',
  submitKeys: ['Enter'],
  spawnArgs: () => ['opencode'],
  detectReady: () => 'ready',
  handleDialog: () => null,
  detectStatus: () => 'idle',
}

const codexAdapter: CliAdapter = {
  name: 'codex',
  cliCommand: 'codex',
  instructionFile: 'AGENTS.md',
  submitKeys: ['Enter'],
  spawnArgs: () => ['codex'],
  detectReady: () => 'ready',
  handleDialog: () => null,
  detectStatus: () => 'idle',
}

const droidAdapter: CliAdapter = {
  name: 'droid',
  cliCommand: 'droid',
  instructionFile: 'AGENTS.md',
  submitKeys: ['Enter'],
  spawnArgs: () => ['droid'],
  detectReady: () => 'ready',
  handleDialog: () => null,
  detectStatus: () => 'idle',
}

describe('skills', () => {
  let skillsDir: string
  let workDir: string
  let origSkillsDir: string | undefined

  beforeEach(() => {
    const tempBase = mkdtempSync(join(tmpdir(), 'flt-test-home-'))
    skillsDir = join(tempBase, '.flt', 'skills')
    mkdirSync(skillsDir, { recursive: true })
    workDir = mkdtempSync(join(tmpdir(), 'flt-test-work-'))
    origSkillsDir = process.env.FLT_SKILLS_DIR
    process.env.FLT_SKILLS_DIR = skillsDir
  })

  afterEach(() => {
    if (origSkillsDir === undefined) delete process.env.FLT_SKILLS_DIR
    else process.env.FLT_SKILLS_DIR = origSkillsDir
    rmSync(skillsDir, { recursive: true, force: true })
    rmSync(workDir, { recursive: true, force: true })
  })

  function makeSkill(name: string, description: string, body: string): string {
    const skillDir = join(skillsDir, name)
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\ncli-support: ["*"]\n---\n${body}`)
    return skillDir
  }

  describe('loadSkills', () => {
    it('returns empty array when no skills dir exists', () => {
      expect(loadSkills('*')).toEqual([])
    })

    it('returns fixture skill with source global and path pointing to skill dir', () => {
      const skillDir = makeSkill('my-skill', 'A test skill', 'Do the thing.')
      const skills = loadSkills('*')
      expect(skills).toHaveLength(1)
      expect(skills[0].name).toBe('my-skill')
      expect(skills[0].description).toBe('A test skill')
      expect(skills[0].source).toBe('global')
      expect(skills[0].path).toBe(skillDir)
    })

    it('filters skills by specific cli', () => {
      const ccDir = join(skillsDir, 'cc-only')
      mkdirSync(ccDir, { recursive: true })
      writeFileSync(join(ccDir, 'SKILL.md'), `---\nname: cc-only\ncli-support: ["claude-code"]\n---\nCC only.`)

      const codexDir = join(skillsDir, 'codex-only')
      mkdirSync(codexDir, { recursive: true })
      writeFileSync(join(codexDir, 'SKILL.md'), `---\nname: codex-only\ncli-support: ["codex"]\n---\nCodex only.`)

      const ccSkills = loadSkills('claude-code')
      expect(ccSkills.map(s => s.name)).toContain('cc-only')
      expect(ccSkills.map(s => s.name)).not.toContain('codex-only')

      const codexSkills = loadSkills('codex')
      expect(codexSkills.map(s => s.name)).not.toContain('cc-only')
      expect(codexSkills.map(s => s.name)).toContain('codex-only')
    })

    it('cli="*" returns all skills regardless of cli-support', () => {
      const ccDir = join(skillsDir, 'cc-only')
      mkdirSync(ccDir, { recursive: true })
      writeFileSync(join(ccDir, 'SKILL.md'), `---\nname: cc-only\ncli-support: ["claude-code"]\n---\nCC only.`)

      const anyDir = join(skillsDir, 'any-cli')
      mkdirSync(anyDir, { recursive: true })
      writeFileSync(join(anyDir, 'SKILL.md'), `---\nname: any-cli\ncli-support: ["*"]\n---\nAny CLI.`)

      const all = loadSkills('*')
      expect(all.map(s => s.name)).toContain('cc-only')
      expect(all.map(s => s.name)).toContain('any-cli')
    })
  })

  describe('projectSkills for claude-code', () => {
    it('copies SKILL.md to <workDir>/.claude/skills/<name>/SKILL.md', () => {
      const rawContent = `---\nname: my-skill\ndescription: A skill\ncli-support: ["*"]\n---\nDo the thing.`
      const skillDir = join(skillsDir, 'my-skill')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), rawContent)

      const result = projectSkills(workDir, claudeAdapter, { requested: ['my-skill'] })

      expect(result.names).toEqual(['my-skill'])
      expect(result.warnings).toHaveLength(0)

      const destPath = join(workDir, '.claude', 'skills', 'my-skill', 'SKILL.md')
      expect(existsSync(destPath)).toBe(true)
      expect(readFileSync(destPath, 'utf-8')).toBe(rawContent)
    })

    it('returns a warning for unknown skill names', () => {
      const result = projectSkills(workDir, claudeAdapter, { requested: ['nonexistent'] })
      expect(result.names).toHaveLength(0)
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain('nonexistent')
    })
  })

  describe('projectSkills for opencode', () => {
    it('copies SKILL.md to <workDir>/.opencode/skills/<name>/SKILL.md', () => {
      makeSkill('my-skill', 'A skill', 'Do the thing.')

      projectSkills(workDir, opencodeAdapter, { requested: ['my-skill'] })

      const destPath = join(workDir, '.opencode', 'skills', 'my-skill', 'SKILL.md')
      expect(existsSync(destPath)).toBe(true)
    })
  })

  describe('projectSkills for codex (inject-CLIs)', () => {
    it('mirrors to .flt/skills/<name>/SKILL.md and injects skills block into instruction file', () => {
      makeSkill('my-skill', 'A test skill', 'Do the thing.')
      writeFileSync(join(workDir, 'AGENTS.md'), '# Instructions\n')

      const result = projectSkills(workDir, codexAdapter, { requested: ['my-skill'] })

      expect(result.names).toEqual(['my-skill'])

      const mirrorPath = join(workDir, '.flt', 'skills', 'my-skill', 'SKILL.md')
      expect(existsSync(mirrorPath)).toBe(true)

      const content = readFileSync(join(workDir, 'AGENTS.md'), 'utf-8')
      expect(content).toContain('<!-- flt:skills:start -->')
      expect(content).toContain('<!-- flt:skills:end -->')
      expect(content).toContain('## Available Skills')
      expect(content).toContain('- my-skill: A test skill')
    })

    it('does not inject into instruction file when it does not exist', () => {
      makeSkill('my-skill', 'A test skill', 'Do the thing.')

      const result = projectSkills(workDir, codexAdapter, { requested: ['my-skill'] })

      expect(result.names).toEqual(['my-skill'])
      expect(existsSync(join(workDir, 'AGENTS.md'))).toBe(false)
    })
  })

  describe('projectSkills for droid', () => {
    it('installs project skills under .factory/skills for Droid native discovery', () => {
      makeSkill('my-skill', 'A test skill', 'Do the thing.')
      writeFileSync(join(workDir, 'AGENTS.md'), '# Instructions\n')

      const result = projectSkills(workDir, droidAdapter, { requested: ['my-skill'] })

      expect(result.names).toEqual(['my-skill'])
      expect(existsSync(join(workDir, '.factory', 'skills', 'my-skill', 'SKILL.md'))).toBe(true)
      expect(existsSync(join(workDir, '.flt', 'skills', 'my-skill', 'SKILL.md'))).toBe(false)

      const content = readFileSync(join(workDir, 'AGENTS.md'), 'utf-8')
      expect(content).toContain('- my-skill: A test skill')
    })
  })

  describe('cleanupSkills', () => {
    it('removes managed claude-code skill files after cleanup', () => {
      makeSkill('my-skill', 'A skill', 'Do the thing.')
      projectSkills(workDir, claudeAdapter, { requested: ['my-skill'] })

      const destPath = join(workDir, '.claude', 'skills', 'my-skill', 'SKILL.md')
      expect(existsSync(destPath)).toBe(true)

      cleanupSkills(workDir, claudeAdapter)

      expect(existsSync(destPath)).toBe(false)
    })

    it('removes managed codex mirror and cleans instruction file', () => {
      makeSkill('my-skill', 'A skill', 'Do the thing.')
      writeFileSync(join(workDir, 'AGENTS.md'), '# Instructions\n')
      projectSkills(workDir, codexAdapter, { requested: ['my-skill'] })

      const mirrorPath = join(workDir, '.flt', 'skills', 'my-skill', 'SKILL.md')
      expect(existsSync(mirrorPath)).toBe(true)

      cleanupSkills(workDir, codexAdapter)

      expect(existsSync(mirrorPath)).toBe(false)

      const content = readFileSync(join(workDir, 'AGENTS.md'), 'utf-8')
      expect(content).not.toContain('<!-- flt:skills:start -->')
      expect(content).not.toContain('<!-- flt:skills:end -->')
      expect(content).toContain('# Instructions')
    })

    it('handles missing manifest gracefully', () => {
      expect(() => cleanupSkills(workDir, claudeAdapter)).not.toThrow()
    })
  })

  describe('FLT_SKILLS_DIR override', () => {
    it('uses FLT_SKILLS_DIR when set instead of ~/.flt/skills', () => {
      makeSkill('override-skill', 'From override dir', 'Override content.')
      const skills = loadSkills('*')
      expect(skills.map(s => s.name)).toContain('override-skill')
      expect(skills[0].path).toContain(skillsDir)
    })

    it('falls back to default when FLT_SKILLS_DIR is unset', () => {
      delete process.env.FLT_SKILLS_DIR
      // With the override unset, globalSkillsDir() resolves to join(HOME, '.flt', 'skills').
      // Requesting a nonexistent skill surfaces that path in the warning string,
      // proving the real-home fallback branch is active rather than the temp dir.
      const result = projectSkills(workDir, claudeAdapter, { requested: ['__no_such_skill__'] })
      expect(result.warnings).toHaveLength(1)
      const expectedBase = join(process.env.HOME!, '.flt', 'skills')
      expect(result.warnings[0]).toContain(expectedBase)
    })
  })

  describe('re-spawn idempotency', () => {
    it('calling projectSkills twice does not duplicate the skills block', () => {
      makeSkill('my-skill', 'A skill', 'Do the thing.')
      writeFileSync(join(workDir, 'AGENTS.md'), '# Instructions\n')

      projectSkills(workDir, codexAdapter, { requested: ['my-skill'] })
      projectSkills(workDir, codexAdapter, { requested: ['my-skill'] })

      const content = readFileSync(join(workDir, 'AGENTS.md'), 'utf-8')
      const startCount = content.split('<!-- flt:skills:start -->').length - 1
      expect(startCount).toBe(1)
    })

    it('second projectSkills call overwrites the managed manifest cleanly', () => {
      makeSkill('my-skill', 'A skill', 'Do the thing.')

      projectSkills(workDir, claudeAdapter, { requested: ['my-skill'] })
      const result2 = projectSkills(workDir, claudeAdapter, { requested: ['my-skill'] })

      expect(result2.names).toEqual(['my-skill'])
      expect(result2.warnings).toHaveLength(0)

      const destPath = join(workDir, '.claude', 'skills', 'my-skill', 'SKILL.md')
      expect(existsSync(destPath)).toBe(true)
    })
  })
})
