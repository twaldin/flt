import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  buildSystemBlock,
  buildFullInstructions,
  projectInstructions,
  restoreInstructions,
} from '../../src/instructions'

describe('instructions', () => {
  let tempDir: string
  let origHome: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'flt-test-instr-'))
    origHome = process.env.HOME
    process.env.HOME = tempDir
  })

  afterEach(() => {
    process.env.HOME = origHome
    rmSync(tempDir, { recursive: true, force: true })
  })

  const baseOpts = {
    agentName: 'coder-1',
    parentName: 'orchestrator',
    cli: 'claude-code',
    model: 'opus-4-6',
  }

  it('builds system block with template substitution', () => {
    const block = buildSystemBlock(baseOpts)
    expect(block).toContain('Fleet Agent: coder-1')
    expect(block).toContain('Parent: orchestrator')
    expect(block).toContain('CLI: claude-code')
    expect(block).toContain('Model: opus-4-6')
    // Minimal block points the agent at the /flt skill — full protocol lives there.
    expect(block).toContain('Read the /flt skill')
  })

  it('uses root template when parent is human', () => {
    const block = buildSystemBlock({ ...baseOpts, parentName: 'human' })
    expect(block).toContain('Mode: root')
    expect(block).toContain('Parent: human')
    expect(block).toContain('Read the /flt skill')
  })

  it('uses subagent template when parent is another agent', () => {
    const block = buildSystemBlock({ ...baseOpts, parentName: 'orchestrator' })
    expect(block).toContain('Mode: subagent')
    expect(block).toContain('Parent: orchestrator')
    expect(block).toContain('Read the /flt skill')
  })

  it('uses workflow template when in a workflow', () => {
    const block = buildSystemBlock({ ...baseOpts, workflow: 'idea-to-pr', step: 'coder' })
    expect(block).toContain('Mode: workflow')
    expect(block).toContain('Workflow: idea-to-pr')
    expect(block).toContain('Step: coder')
    expect(block).toContain('Read the /flt skill')
  })

  it('builds full instructions without SOUL.md', () => {
    const full = buildFullInstructions(baseOpts)
    expect(full).toContain('<!-- flt:start -->')
    expect(full).toContain('<!-- flt:end -->')
    expect(full).toContain('Fleet Agent: coder-1')
  })

  it('builds full instructions with SOUL.md', () => {
    const soulDir = join(tempDir, '.flt', 'agents', 'coder-1')
    mkdirSync(soulDir, { recursive: true })
    writeFileSync(join(soulDir, 'SOUL.md'), '# Identity\nI am an adversarial reviewer.')

    const full = buildFullInstructions(baseOpts)
    expect(full).toContain('Fleet Agent: coder-1')
    expect(full).toContain('I am an adversarial reviewer.')
  })

  it('points droid skill references at Factory native skill discovery', () => {
    const full = buildFullInstructions({ ...baseOpts, cli: 'droid', skillNames: ['flt', 'browser'] })

    expect(full).toContain('./.factory/skills/flt/SKILL.md')
    expect(full).toContain('./.factory/skills/browser/SKILL.md')
    expect(full).not.toContain('./.flt/skills/flt/SKILL.md')
  })

  it('points pi skill references at pi native skill discovery', () => {
    const full = buildFullInstructions({ ...baseOpts, cli: 'pi', skillNames: ['flt', 'browser'] })

    expect(full).toContain('./.pi/skills/flt/SKILL.md')
    expect(full).toContain('./.pi/skills/browser/SKILL.md')
    expect(full).not.toContain('./.flt/skills/flt/SKILL.md')
  })

  it('projects instructions to new file', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'flt-proj-'))
    projectInstructions(workDir, 'CLAUDE.md', baseOpts)

    const content = readFileSync(join(workDir, 'CLAUDE.md'), 'utf-8')
    expect(content).toContain('<!-- flt:start -->')
    expect(content).toContain('Fleet Agent: coder-1')
    rmSync(workDir, { recursive: true, force: true })
  })

  it('prepends to existing file and creates backup', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'flt-proj-'))
    writeFileSync(join(workDir, 'CLAUDE.md'), '# Existing Project Rules\nDo stuff.')

    projectInstructions(workDir, 'CLAUDE.md', baseOpts)

    const content = readFileSync(join(workDir, 'CLAUDE.md'), 'utf-8')
    expect(content).toContain('<!-- flt:start -->')
    expect(content).toContain('# Existing Project Rules')
    // flt block should be before existing content
    const fltIdx = content.indexOf('<!-- flt:start -->')
    const existIdx = content.indexOf('# Existing Project Rules')
    expect(fltIdx).toBeLessThan(existIdx)

    // Backup should exist
    expect(existsSync(join(workDir, '.harness-backup-CLAUDE.md'))).toBe(true)
    const backup = readFileSync(join(workDir, '.harness-backup-CLAUDE.md'), 'utf-8')
    expect(backup).toBe('# Existing Project Rules\nDo stuff.')

    rmSync(workDir, { recursive: true, force: true })
  })

  it('replaces existing flt block on re-projection', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'flt-proj-'))

    projectInstructions(workDir, 'CLAUDE.md', baseOpts)
    projectInstructions(workDir, 'CLAUDE.md', { ...baseOpts, model: 'sonnet-4-6' })

    const content = readFileSync(join(workDir, 'CLAUDE.md'), 'utf-8')
    expect(content).toContain('Model: sonnet-4-6')
    expect(content).not.toContain('Model: opus-4-6')
    // Should only have one flt block
    const starts = content.split('<!-- flt:start -->').length - 1
    expect(starts).toBe(1)

    rmSync(workDir, { recursive: true, force: true })
  })

  it('restores instructions from backup', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'flt-proj-'))
    writeFileSync(join(workDir, 'CLAUDE.md'), '# Original')
    const projection = projectInstructions(workDir, 'CLAUDE.md', baseOpts)

    restoreInstructions(projection)

    const content = readFileSync(join(workDir, 'CLAUDE.md'), 'utf-8')
    expect(content).toBe('# Original')
    expect(existsSync(join(workDir, '.harness-backup-CLAUDE.md'))).toBe(false)

    rmSync(workDir, { recursive: true, force: true })
  })

  it('restore removes projected file when it did not exist pre-spawn', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'flt-proj-'))
    const projection = projectInstructions(workDir, '.opencode/agents/flt.md', baseOpts)

    restoreInstructions(projection)

    expect(existsSync(join(workDir, '.opencode/agents/flt.md'))).toBe(false)
    expect(existsSync(join(workDir, '.opencode/agents'))).toBe(false)
    expect(existsSync(join(workDir, '.opencode'))).toBe(false)

    rmSync(workDir, { recursive: true, force: true })
  })

  // Real-world bug: repos collected stale flt-managed content from past
  // spawns that crashed before restoreInstructions ran. The next agent
  // spawned saw the stale text (with old role text saying "use flt
  // send parent") layered above the new flt block (saying "do NOT").
  // projectInstructions sweeps orphaned content idempotently before
  // writing the new block.
  describe('orphan-content sweep on projection', () => {
    it('removes a well-formed leftover flt:start..flt:end block', () => {
      const workDir = mkdtempSync(join(tmpdir(), 'flt-orphan-'))
      const stale = `<!-- flt:start -->
# Fleet Agent: stale-old-spawn
Old workflow protocol that says use flt send parent.
<!-- flt:end -->

# Real Project Conventions
Use TypeScript strict mode.`
      writeFileSync(join(workDir, 'AGENTS.md'), stale)

      projectInstructions(workDir, 'AGENTS.md', baseOpts)
      const content = readFileSync(join(workDir, 'AGENTS.md'), 'utf-8')

      expect(content).not.toContain('stale-old-spawn')
      expect(content).not.toContain('Old workflow protocol')
      expect(content).toContain('Fleet Agent: coder-1')
      expect(content).toContain('# Real Project Conventions')
      expect(content).toContain('TypeScript strict mode')

      rmSync(workDir, { recursive: true, force: true })
    })

    it('removes an unterminated leftover flt:start block (crash-mid-write scenario)', () => {
      const workDir = mkdtempSync(join(tmpdir(), 'flt-orphan-'))
      const stale = `<!-- flt:start -->
# Fleet Agent: crashed-mid-spawn
Use flt send parent for status updates.

# Code Reviewer
Old soul content with no flt:end marker — file was never finished.`
      writeFileSync(join(workDir, 'CLAUDE.md'), stale)

      projectInstructions(workDir, 'CLAUDE.md', baseOpts)
      const content = readFileSync(join(workDir, 'CLAUDE.md'), 'utf-8')

      expect(content).not.toContain('crashed-mid-spawn')
      expect(content).not.toContain('Code Reviewer')
      expect(content).toContain('Fleet Agent: coder-1')

      rmSync(workDir, { recursive: true, force: true })
    })

    it('removes legacy "# Fleet Agent:" header without markers (pre-marker era)', () => {
      const workDir = mkdtempSync(join(tmpdir(), 'flt-orphan-'))
      const stale = `# Fleet Agent: legacy-no-markers
Old flt didn't emit markers. The block ends at the next h2.

## Project conventions
Use TypeScript strict mode. The real content starts here.`
      writeFileSync(join(workDir, 'AGENTS.md'), stale)

      projectInstructions(workDir, 'AGENTS.md', baseOpts)
      const content = readFileSync(join(workDir, 'AGENTS.md'), 'utf-8')

      expect(content).not.toContain('legacy-no-markers')
      expect(content).not.toContain("Old flt didn't emit markers")
      expect(content).toContain('Fleet Agent: coder-1')
      expect(content).toContain('## Project conventions')
      expect(content).toContain('TypeScript strict mode')

      rmSync(workDir, { recursive: true, force: true })
    })

    it('treats a file containing ONLY orphaned flt content as if it never existed', () => {
      const workDir = mkdtempSync(join(tmpdir(), 'flt-orphan-'))
      const stale = `<!-- flt:start -->
# Fleet Agent: stale-only
This whole file is leftover from a crashed spawn — nothing else.
<!-- flt:end -->`
      writeFileSync(join(workDir, 'AGENTS.md'), stale)

      const projection = projectInstructions(workDir, 'AGENTS.md', baseOpts)
      const content = readFileSync(join(workDir, 'AGENTS.md'), 'utf-8')

      expect(projection.existedBefore).toBe(false)
      expect(content).toContain('Fleet Agent: coder-1')
      expect(content).not.toContain('stale-only')

      rmSync(workDir, { recursive: true, force: true })
    })

    it('leaves a clean file untouched when there is no orphaned content', () => {
      const workDir = mkdtempSync(join(tmpdir(), 'flt-orphan-'))
      const original = `# Project Conventions

Use TypeScript strict mode. This file has never been touched by flt.`
      writeFileSync(join(workDir, 'CLAUDE.md'), original)

      projectInstructions(workDir, 'CLAUDE.md', baseOpts)
      const content = readFileSync(join(workDir, 'CLAUDE.md'), 'utf-8')

      expect(content).toContain('Fleet Agent: coder-1')
      expect(content).toContain('Use TypeScript strict mode')

      rmSync(workDir, { recursive: true, force: true })
    })

    it('restoreInstructions correctly restores after a sweep of an orphaned-only file', () => {
      const workDir = mkdtempSync(join(tmpdir(), 'flt-orphan-'))
      const stale = `<!-- flt:start -->
# Fleet Agent: stale-only
<!-- flt:end -->`
      writeFileSync(join(workDir, 'AGENTS.md'), stale)

      const projection = projectInstructions(workDir, 'AGENTS.md', baseOpts)
      restoreInstructions(projection)

      expect(existsSync(join(workDir, 'AGENTS.md'))).toBe(false)

      rmSync(workDir, { recursive: true, force: true })
    })
  })

})
