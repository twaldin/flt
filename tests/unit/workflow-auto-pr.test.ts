import { describe, expect, it } from 'bun:test'
import { shouldCreatePr } from '../../src/workflow/engine'
import type { WorkflowDef } from '../../src/workflow/types'

function makeDef(auto_pr?: boolean): WorkflowDef {
  return { name: 'wf', steps: [], auto_pr }
}

describe('shouldCreatePr', () => {
  it('returns true when auto_pr is missing', () => {
    expect(shouldCreatePr(makeDef(undefined))).toBe(true)
  })

  it('returns true when auto_pr is true', () => {
    expect(shouldCreatePr(makeDef(true))).toBe(true)
  })

  it('returns false when auto_pr is false', () => {
    expect(shouldCreatePr(makeDef(false))).toBe(false)
  })
})
