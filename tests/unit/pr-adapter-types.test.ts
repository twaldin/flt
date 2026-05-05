import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadPresets } from '../../src/presets'
import { loadWorkflowDef } from '../../src/workflow/parser'

describe('pr_adapter typing and parsing', () => {
  let tempDir: string
  let originalHome: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'flt-pr-adapter-'))
    originalHome = process.env.HOME
    process.env.HOME = tempDir
    mkdirSync(join(tempDir, '.flt'), { recursive: true })
  })

  afterEach(() => {
    process.env.HOME = originalHome
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('loads presets with pr_adapter gh/gt/manual and keeps value', () => {
    writeFileSync(
      join(tempDir, '.flt', 'presets.json'),
      JSON.stringify({
        gh: { cli: 'codex', model: 'gpt-5', pr_adapter: 'gh' },
        gt: { cli: 'codex', model: 'gpt-5', pr_adapter: 'gt' },
        manual: { cli: 'codex', model: 'gpt-5', pr_adapter: 'manual' },
      }),
    )

    const presets = loadPresets()
    expect(presets.gh.pr_adapter).toBe('gh')
    expect(presets.gt.pr_adapter).toBe('gt')
    expect(presets.manual.pr_adapter).toBe('manual')
  })

  it('throws on invalid preset pr_adapter', () => {
    writeFileSync(
      join(tempDir, '.flt', 'presets.json'),
      JSON.stringify({ bad: { cli: 'codex', model: 'gpt-5', pr_adapter: 'bogus' } }),
    )

    expect(() => loadPresets()).toThrow('Invalid preset "bad": "pr_adapter" must be one of: gh, gt, manual')
  })

  it('loads presets without pr_adapter for back-compat', () => {
    writeFileSync(join(tempDir, '.flt', 'presets.json'), JSON.stringify({ plain: { cli: 'codex', model: 'gpt-5' } }))
    const presets = loadPresets()
    expect(presets.plain.pr_adapter).toBeUndefined()
  })

  it('parses workflow with step pr_adapter', () => {
    writeFileSync(
      join(tempDir, '.flt', 'presets.json'),
      JSON.stringify({ pi: { cli: 'pi', model: 'gpt-5' } }),
    )
    mkdirSync(join(tempDir, '.flt', 'workflows'), { recursive: true })
    writeFileSync(
      join(tempDir, '.flt', 'workflows', 'wf.yaml'),
      `name: wf
steps:
  - id: s
    preset: pi
    task: do it
    pr_adapter: gt
`,
    )

    const def = loadWorkflowDef('wf')
    expect(def.steps[0].pr_adapter).toBe('gt')
  })

  it('throws on invalid workflow step pr_adapter', () => {
    writeFileSync(
      join(tempDir, '.flt', 'presets.json'),
      JSON.stringify({ pi: { cli: 'pi', model: 'gpt-5' } }),
    )
    mkdirSync(join(tempDir, '.flt', 'workflows'), { recursive: true })
    writeFileSync(
      join(tempDir, '.flt', 'workflows', 'wf.yaml'),
      `name: wf
steps:
  - id: s
    preset: pi
    task: do it
    pr_adapter: bogus
`,
    )

    expect(() => loadWorkflowDef('wf')).toThrow('Step "s": "pr_adapter" must be one of: gh, gt, manual')
  })

  it('parses workflow with no pr_adapter and leaves undefined on all steps', () => {
    writeFileSync(
      join(tempDir, '.flt', 'presets.json'),
      JSON.stringify({ pi: { cli: 'pi', model: 'gpt-5' } }),
    )
    mkdirSync(join(tempDir, '.flt', 'workflows'), { recursive: true })
    writeFileSync(
      join(tempDir, '.flt', 'workflows', 'wf.yaml'),
      `name: wf
steps:
  - id: one
    preset: pi
    task: a
  - id: two
    type: human_gate
`,
    )

    const def = loadWorkflowDef('wf')
    expect(def.steps.every(step => step.pr_adapter === undefined)).toBe(true)
  })
})
