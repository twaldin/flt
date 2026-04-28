import { describe, expect, it } from 'bun:test'
import { shouldCreatePr } from '../../src/workflow/engine'
import type { SpawnStep, WorkflowDef } from '../../src/workflow/types'

function makeStep(id: string, auto_pr_step?: boolean): SpawnStep {
  return { id, preset: 'p', task: 't', auto_pr_step }
}

function makeDef(auto_pr?: boolean, steps: SpawnStep[] = []): WorkflowDef {
  return { name: 'wf', steps, auto_pr }
}

describe('shouldCreatePr', () => {
  it('returns true when auto_pr is missing', () => {
    expect(shouldCreatePr(makeDef(undefined), 'step1')).toBe(true)
  })

  it('returns true when auto_pr is true', () => {
    expect(shouldCreatePr(makeDef(true), 'step1')).toBe(true)
  })

  it('returns false when auto_pr is false', () => {
    expect(shouldCreatePr(makeDef(false), 'step1')).toBe(false)
  })

  describe('auto_pr_step semantics', () => {
    it('back-compat: no step has auto_pr_step — all steps return true', () => {
      const def = makeDef(undefined, [makeStep('plan'), makeStep('execute'), makeStep('pr')])
      expect(shouldCreatePr(def, 'plan')).toBe(true)
      expect(shouldCreatePr(def, 'execute')).toBe(true)
      expect(shouldCreatePr(def, 'pr')).toBe(true)
    })

    it('one step marked auto_pr_step — only that step returns true', () => {
      const def = makeDef(undefined, [makeStep('plan'), makeStep('execute'), makeStep('pr', true)])
      expect(shouldCreatePr(def, 'plan')).toBe(false)
      expect(shouldCreatePr(def, 'execute')).toBe(false)
      expect(shouldCreatePr(def, 'pr')).toBe(true)
    })

    it('auto_pr=false overrides auto_pr_step — all steps return false', () => {
      const def = makeDef(false, [makeStep('plan'), makeStep('pr', true)])
      expect(shouldCreatePr(def, 'plan')).toBe(false)
      expect(shouldCreatePr(def, 'pr')).toBe(false)
    })
  })
})
