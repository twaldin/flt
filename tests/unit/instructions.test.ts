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
    expect(block).toContain('Parent agent: orchestrator')
    expect(block).toContain('CLI: claude-code')
    expect(block).toContain('Model: opus-4-6')
    expect(block).toContain('flt send parent')
  })

  it('uses root template when parent is human', () => {
    const block = buildSystemBlock({ ...baseOpts, parentName: 'human' })
    expect(block).toContain('managed root agent')
    expect(block).toContain('Parent: human')
    expect(block).toContain('Terminal output can be useful')
  })

  it('uses subagent template when parent is another agent', () => {
    const block = buildSystemBlock({ ...baseOpts, parentName: 'orchestrator' })
    expect(block).toContain('managed subagent')
    expect(block).toContain('Parent agent: orchestrator')
    expect(block).toContain('never human')
    expect(block).toContain('flt ask oracle')
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

})
