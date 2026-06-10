/**
 * Regression: fresh-dir spawn for inject-only CLIs (codex, gemini, qwen, …)
 * must get BOTH the flt:start instruction block AND the flt:skills index.
 *
 * Root cause: projectSkills only injects the skills index when the instruction
 * file already exists. Previously, projectSkills ran BEFORE projectInstructions,
 * so a fresh directory would have no AGENTS.md at skills-injection time — the
 * agent was taught to read a skill it could not find (dangling pointer).
 *
 * The fix: projectInstructions runs first (creating the file), then
 * projectSkills injects the index into the existing file.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { projectInstructions } from '../../src/instructions'
import { projectSkills } from '../../src/skills'
import type { CliAdapter } from '../../src/adapters/types'

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

describe('spawn projection order (instructions before skills)', () => {
  let tempHome: string
  let workDir: string
  let origHome: string | undefined

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'flt-proj-order-home-'))
    workDir = mkdtempSync(join(tmpdir(), 'flt-proj-order-work-'))
    origHome = process.env.HOME
    process.env.HOME = tempHome
  })

  afterEach(() => {
    process.env.HOME = origHome
    rmSync(tempHome, { recursive: true, force: true })
    rmSync(workDir, { recursive: true, force: true })
  })

  function makeSyntheticFltSkill(): void {
    // projectSkills looks for skills in ~/.flt/skills — we install a minimal
    // flt skill there so projectSkills has something real to install.
    const skillDir = join(tempHome, '.flt', 'skills', 'flt')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: flt\ndescription: flt protocol\ncli-support: ["*"]\n---\n# /flt protocol\n',
    )
  }

  it('fresh-dir codex spawn: AGENTS.md has flt:start block AND flt:skills index listing flt', () => {
    makeSyntheticFltSkill()

    // Simulate the new spawn order: instructions first, then skills
    projectInstructions(workDir, 'AGENTS.md', {
      agentName: 'coder-1',
      parentName: 'human',
      cli: 'codex',
      model: 'gpt-4o',
    })

    projectSkills(workDir, codexAdapter, {
      requested: ['flt'],
    })

    const content = readFileSync(join(workDir, 'AGENTS.md'), 'utf-8')

    // Must have the flt:start block
    expect(content).toContain('<!-- flt:start -->')
    expect(content).toContain('<!-- flt:end -->')
    expect(content).toContain('Fleet Agent: coder-1')
    // Must have the skills index with flt listed
    expect(content).toContain('<!-- flt:skills:start -->')
    expect(content).toContain('<!-- flt:skills:end -->')
    expect(content).toContain('flt:')
    // System block must contain the per-CLI skill path for codex
    expect(content).toContain('./.flt/skills/flt/SKILL.md')
  })

  it('pre-existing AGENTS.md codex spawn: still gets both blocks', () => {
    makeSyntheticFltSkill()
    writeFileSync(join(workDir, 'AGENTS.md'), '# Project Instructions\nDo the thing.\n')

    projectInstructions(workDir, 'AGENTS.md', {
      agentName: 'coder-2',
      parentName: 'orchestrator',
      cli: 'codex',
      model: 'gpt-4o',
    })

    projectSkills(workDir, codexAdapter, {
      requested: ['flt'],
    })

    const content = readFileSync(join(workDir, 'AGENTS.md'), 'utf-8')
    expect(content).toContain('<!-- flt:start -->')
    expect(content).toContain('<!-- flt:skills:start -->')
    expect(content).toContain('# Project Instructions')
    // flt block before existing content
    const fltIdx = content.indexOf('<!-- flt:start -->')
    const projIdx = content.indexOf('# Project Instructions')
    expect(fltIdx).toBeLessThan(projIdx)
  })
})
