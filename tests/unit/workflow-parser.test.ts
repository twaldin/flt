import { beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { parse } from 'yaml'
import { validateWorkflowDef } from '../../src/workflow/parser'

function validate(yamlText: string) {
  return validateWorkflowDef(parse(yamlText))
}

describe('validateWorkflowDef', () => {
  beforeEach(() => {
    const home = mkdtempSync(join(tmpdir(), 'flt-workflow-parser-'))
    process.env.HOME = home
    mkdirSync(join(home, '.flt'), { recursive: true })
    writeFileSync(
      join(home, '.flt', 'presets.json'),
      JSON.stringify({
        default: { cli: 'claude-code', model: 'sonnet' },
        'pi-coder': { cli: 'pi', model: 'gpt-5' },
        'cc-opus': { cli: 'claude-code', model: 'opus' },
        'cc-sonnet': { cli: 'claude-code', model: 'sonnet' },
        'cc-architect': { cli: 'claude-code', model: 'opus' },
        'cc-evaluator': { cli: 'claude-code', model: 'opus' },
        'cc-mutator': { cli: 'claude-code', model: 'opus' },
        'cc-coder': { cli: 'claude-code', model: 'sonnet' },
        'cc-reviewer': { cli: 'claude-code', model: 'sonnet' },
        'codex-reviewer': { cli: 'codex', model: 'gpt-5' },
        'codex-coder': { cli: 'codex', model: 'gpt-5' },
        'gemini-coder': { cli: 'gemini', model: 'gemini-2.5-pro' },
        'opencode-coder': { cli: 'opencode', model: 'sonnet' },
        'glm-fast': { cli: 'pi', model: 'glm' },
      }),
    )
  })

  it('parses legacy untyped preset+task step', () => {
    const def = validate(`
name: wf
steps:
  - id: coder
    preset: pi-coder
    task: do it
`)
    const step = def.steps[0] as { type?: string }
    expect(step.id).toBe('coder')
    expect(step.type === undefined || step.type === 'spawn').toBe(true)
  })

  it('parses legacy run-only step', () => {
    const def = validate(`
name: wf
steps:
  - id: shell
    run: echo hi
`)
    expect(def.steps[0].id).toBe('shell')
  })

  it('throws on duplicate ids', () => {
    expect(() => validate(`
name: wf
steps:
  - id: one
    preset: pi-coder
    task: a
  - id: one
    preset: pi-coder
    task: b
`)).toThrow('Duplicate step id')
  })

  it('throws when on_complete/on_fail target unknown step', () => {
    expect(() => validate(`
name: wf
steps:
  - id: one
    preset: pi-coder
    task: a
    on_complete: missing
`)).toThrow('on_complete references unknown step')

    expect(() => validate(`
name: wf
steps:
  - id: one
    preset: pi-coder
    task: a
    on_fail: missing
`)).toThrow('on_fail references unknown step')
  })

  it('parses valid parallel with explicit presets', () => {
    const def = validate(`
name: wf
steps:
  - id: fanout
    type: parallel
    n: 3
    presets: [cc-opus, pi-coder, glm-fast]
    step:
      id: coder
      preset: pi-coder
      task: x
`)
    expect(def.steps[0].id).toBe('fanout')
  })

  it('parses valid parallel without presets', () => {
    const def = validate(`
name: wf
steps:
  - id: fanout
    type: parallel
    n: 3
    step:
      id: coder
      preset: pi-coder
      task: x
`)
    expect(def.steps[0].id).toBe('fanout')
  })

  it('throws for parallel n < 2', () => {
    expect(() => validate(`
name: wf
steps:
  - id: fanout
    type: parallel
    n: 1
    step:
      id: coder
      preset: pi-coder
      task: x
`)).toThrow()
  })

  it('throws for parallel presets length mismatch', () => {
    expect(() => validate(`
name: wf
steps:
  - id: fanout
    type: parallel
    n: 3
    presets: [cc-opus, pi-coder]
    step:
      id: coder
      preset: pi-coder
      task: x
`)).toThrow(/length === n|must equal n/)
  })

  it('throws for unknown parallel preset entry', () => {
    expect(() => validate(`
name: wf
steps:
  - id: fanout
    type: parallel
    n: 2
    presets: [cc-opus, missing-preset]
    step:
      id: coder
      preset: pi-coder
      task: x
`)).toThrow()
  })

  it('throws when parallel step.step missing', () => {
    expect(() => validate(`
name: wf
steps:
  - id: fanout
    type: parallel
    n: 3
`)).toThrow()
  })

  it('parses dynamic_dag step with defaults', () => {
    const def = validate(`
name: wf
steps:
  - id: dag
    type: dynamic_dag
    plan_from: '{dir}/plan.json'
`)
    const step = def.steps[0] as { type?: string; max_nodes?: number }
    expect(step.type).toBe('dynamic_dag')
    expect(step.max_nodes).toBe(12)
  })

  it('parses condition forward jump', () => {
    const def = validate(`
name: wf
steps:
  - id: gate
    type: condition
    if: "{x} == '1'"
    then: after
  - id: after
    preset: pi-coder
    task: t
`)
    expect(def.steps[0].id).toBe('gate')
  })

  it('throws condition backward jump', () => {
    expect(() => validate(`
name: wf
steps:
  - id: before
    preset: pi-coder
    task: t
  - id: gate
    type: condition
    if: "{x} == '1'"
    then: before
`)).toThrow('backward jump')
  })

  it('parses condition self-jump', () => {
    const def = validate(`
name: wf
steps:
  - id: gate
    type: condition
    if: "{x} == '1'"
    then: gate
`)
    expect(def.steps[0].id).toBe('gate')
  })

  it('throws for condition missing if', () => {
    expect(() => validate(`
name: wf
steps:
  - id: gate
    type: condition
    then: gate
`)).toThrow()
  })

  it('throws for condition missing then', () => {
    expect(() => validate(`
name: wf
steps:
  - id: gate
    type: condition
    if: "{x} == '1'"
`)).toThrow()
  })

  it('throws for condition then/else referencing unknown step', () => {
    expect(() => validate(`
name: wf
steps:
  - id: gate
    type: condition
    if: "{x} == '1'"
    then: missing
`)).toThrow()

    expect(() => validate(`
name: wf
steps:
  - id: gate
    type: condition
    if: "{x} == '1'"
    then: gate
    else: missing
`)).toThrow()
  })

  it('parses minimal human_gate', () => {
    const def = validate(`
name: wf
steps:
  - id: approval
    type: human_gate
`)
    expect(def.steps[0].id).toBe('approval')
  })

  it('parses human_gate with notify', () => {
    const def = validate(`
name: wf
steps:
  - id: approval
    type: human_gate
    notify: please approve
`)
    expect(def.steps[0].id).toBe('approval')
  })

  it('parses merge_best referencing parallel step', () => {
    const def = validate(`
name: wf
steps:
  - id: fanout
    type: parallel
    n: 2
    step:
      id: coder
      preset: pi-coder
      task: x
  - id: merge
    type: merge_best
    candidate_var: fanout
`)
    expect(def.steps[1].id).toBe('merge')
  })

  it('throws merge_best when candidate_var points to non-parallel step', () => {
    expect(() => validate(`
name: wf
steps:
  - id: coder
    preset: pi-coder
    task: x
  - id: merge
    type: merge_best
    candidate_var: coder
`)).toThrow('must reference a parallel step')
  })

  it('throws merge_best when candidate_var is unknown', () => {
    expect(() => validate(`
name: wf
steps:
  - id: merge
    type: merge_best
    candidate_var: missing
`)).toThrow()
  })

  it('parses collect_artifacts valid shape', () => {
    const def = validate(`
name: wf
steps:
  - id: coder
    preset: pi-coder
    task: x
  - id: gather
    type: collect_artifacts
    from: [coder]
    files: [summary.md]
    into: handoffs
`)
    expect(def.steps[1].id).toBe('gather')
  })

  it('throws collect_artifacts when from references unknown step', () => {
    expect(() => validate(`
name: wf
steps:
  - id: gather
    type: collect_artifacts
    from: [missing]
    files: [summary.md]
    into: handoffs
`)).toThrow()
  })

  it('throws on unknown step type', () => {
    expect(() => validate(`
name: wf
steps:
  - id: weird
    type: foobar
`)).toThrow('unknown step type')
  })

  it('parses bundled daily-mutator workflow', () => {
    const workflowPath = join(import.meta.dir, '..', '..', 'templates', 'workflows', 'daily-mutator.yaml')
    const def = validate(readFileSync(workflowPath, 'utf-8'))
    expect(def.name).toBe('daily-mutator')
    expect(def.steps.map(step => step.id)).toEqual(['collect', 'redact', 'find_skills', 'mutate', 'eval', 'gate', 'open-gate'])
  })

  it('auto_pr: true round-trips', () => {
    const def = validate(`
name: wf
auto_pr: true
steps:
  - id: s
    run: echo hi
`)
    expect(def.auto_pr).toBe(true)
  })

  it('auto_pr: false round-trips', () => {
    const def = validate(`
name: wf
auto_pr: false
steps:
  - id: s
    run: echo hi
`)
    expect(def.auto_pr).toBe(false)
  })

  it('omitting auto_pr leaves field undefined', () => {
    const def = validate(`
name: wf
steps:
  - id: s
    run: echo hi
`)
    expect(def.auto_pr).toBeUndefined()
  })

  it('non-boolean auto_pr throws', () => {
    expect(() => validate(`
name: wf
auto_pr: "yes"
steps:
  - id: s
    run: echo hi
`)).toThrow()
  })
})
