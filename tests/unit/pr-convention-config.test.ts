import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { renderPrTemplate } from '../../src/workflow/engine'
import { addPreset, getPreset, savePresets } from '../../src/presets'
import { validateWorkflowDef } from '../../src/workflow/parser'

// ── renderPrTemplate ───────────────────────────────────────────────────────

describe('renderPrTemplate', () => {
  const vars = { task: 'Fix the bug', run_id: 'run-42', branch: 'feature/my-branch', step: 'code' }

  it('substitutes {task}', () => {
    expect(renderPrTemplate('[{task}]', vars)).toBe('[Fix the bug]')
  })

  it('substitutes {run_id}', () => {
    expect(renderPrTemplate('run={run_id}', vars)).toBe('run=run-42')
  })

  it('substitutes {branch}', () => {
    expect(renderPrTemplate('branch={branch}', vars)).toBe('branch=feature/my-branch')
  })

  it('substitutes {step}', () => {
    expect(renderPrTemplate('step={step}', vars)).toBe('step=code')
  })

  it('substitutes multiple placeholders', () => {
    expect(renderPrTemplate('[JIRA-123] {task} ({step})', vars)).toBe('[JIRA-123] Fix the bug (code)')
  })

  it('replaces all occurrences of the same placeholder', () => {
    expect(renderPrTemplate('{task} / {task}', vars)).toBe('Fix the bug / Fix the bug')
  })

  it('returns template unchanged when no placeholders match', () => {
    expect(renderPrTemplate('No placeholders here', vars)).toBe('No placeholders here')
  })
})

// ── preset validation: new PR fields ──────────────────────────────────────

describe('preset PR convention fields', () => {
  let tempDir: string
  let originalHome: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'flt-test-pr-preset-'))
    originalHome = process.env.HOME
    process.env.HOME = tempDir
    mkdirSync(join(tempDir, '.flt'), { recursive: true })
    savePresets({ default: { cli: 'cc', model: 'sonnet' } })
  })

  afterEach(() => {
    process.env.HOME = originalHome
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('accepts all PR fields on a preset', () => {
    addPreset('corp', {
      cli: 'claude-code',
      model: 'sonnet',
      pr_title_template: '[JIRA] {task}',
      pr_branch_prefix: 'feature/',
      pr_base_branch: 'develop',
      pr_reviewers: ['alice', 'bob'],
      pr_labels: ['automated', 'flt'],
      pr_body_template: 'PR for {task} in {run_id}',
    })
    const p = getPreset('corp')!
    expect(p.pr_title_template).toBe('[JIRA] {task}')
    expect(p.pr_branch_prefix).toBe('feature/')
    expect(p.pr_base_branch).toBe('develop')
    expect(p.pr_reviewers).toEqual(['alice', 'bob'])
    expect(p.pr_labels).toEqual(['automated', 'flt'])
    expect(p.pr_body_template).toBe('PR for {task} in {run_id}')
  })

  it('omits PR fields when not set (backward compat)', () => {
    const p = getPreset('default')!
    expect(p.pr_title_template).toBeUndefined()
    expect(p.pr_branch_prefix).toBeUndefined()
    expect(p.pr_base_branch).toBeUndefined()
    expect(p.pr_reviewers).toBeUndefined()
    expect(p.pr_labels).toBeUndefined()
    expect(p.pr_body_template).toBeUndefined()
  })

  it('throws when pr_title_template is not a string', () => {
    expect(() => addPreset('bad', { cli: 'cc', model: 's', pr_title_template: 42 as unknown as string }))
      .toThrow('"pr_title_template" must be a string')
  })

  it('throws when pr_reviewers contains non-string', () => {
    expect(() => addPreset('bad', { cli: 'cc', model: 's', pr_reviewers: [123] as unknown as string[] }))
      .toThrow('"pr_reviewers" must be an array')
  })

  it('throws when pr_labels contains empty string', () => {
    expect(() => addPreset('bad', { cli: 'cc', model: 's', pr_labels: [''] }))
      .toThrow('"pr_labels" must be an array')
  })

  it('normalizes empty pr_reviewers array to undefined', () => {
    addPreset('norev', { cli: 'cc', model: 's', pr_reviewers: [] })
    expect(getPreset('norev')!.pr_reviewers).toBeUndefined()
  })
})

// ── workflow yaml parser: PR fields on spawn steps ─────────────────────────

describe('workflow parser PR fields', () => {
  let tempDir: string
  let originalHome: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'flt-test-pr-parser-'))
    originalHome = process.env.HOME
    process.env.HOME = tempDir
    mkdirSync(join(tempDir, '.flt'), { recursive: true })
    savePresets({ coder: { cli: 'cc', model: 'sonnet' } })
  })

  afterEach(() => {
    process.env.HOME = originalHome
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('parses PR fields on a spawn step', () => {
    const def = validateWorkflowDef({
      name: 'wf',
      steps: [{
        id: 'code',
        preset: 'coder',
        task: 'do it',
        pr_title_template: '[JIRA] {task}',
        pr_branch_prefix: 'feature/',
        pr_base_branch: 'develop',
        pr_reviewers: ['alice'],
        pr_labels: ['auto'],
        pr_body_template: 'body text',
      }],
    })
    const step = def.steps[0]
    expect(step.pr_title_template).toBe('[JIRA] {task}')
    expect(step.pr_branch_prefix).toBe('feature/')
    expect(step.pr_base_branch).toBe('develop')
    expect(step.pr_reviewers).toEqual(['alice'])
    expect(step.pr_labels).toEqual(['auto'])
    expect(step.pr_body_template).toBe('body text')
  })

  it('step PR fields are undefined when absent (backward compat)', () => {
    const def = validateWorkflowDef({
      name: 'wf',
      steps: [{ id: 'code', preset: 'coder', task: 'do it' }],
    })
    const step = def.steps[0]
    expect(step.pr_title_template).toBeUndefined()
    expect(step.pr_branch_prefix).toBeUndefined()
    expect(step.pr_base_branch).toBeUndefined()
    expect(step.pr_reviewers).toBeUndefined()
    expect(step.pr_labels).toBeUndefined()
    expect(step.pr_body_template).toBeUndefined()
  })

  it('throws when pr_title_template on step is not a string', () => {
    expect(() => validateWorkflowDef({
      name: 'wf',
      steps: [{ id: 'code', preset: 'coder', task: 'do it', pr_title_template: 99 }],
    })).toThrow('"pr_title_template" must be a string')
  })

  it('throws when pr_reviewers on step contains a non-string', () => {
    expect(() => validateWorkflowDef({
      name: 'wf',
      steps: [{ id: 'code', preset: 'coder', task: 'do it', pr_reviewers: [42] }],
    })).toThrow('"pr_reviewers" must be an array')
  })
})
