import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { seedFlt, seedDefaultWorkflows } from '../../src/commands/init'
import { loadWorkflowDef } from '../../src/workflow/parser'

describe('init: default workflows', () => {
  let testHome: string
  let origHome: string | undefined

  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), 'flt-init-workflows-test-'))
    origHome = process.env.HOME
    process.env.HOME = testHome
  })

  afterEach(() => {
    process.env.HOME = origHome
    rmSync(testHome, { recursive: true, force: true })
  })

  it('seeds all 5 default workflows and they parse', () => {
    seedFlt()

    const workflowNames = ['idea-to-pr', 'code-and-review', 'new-project', 'fix-bug', 'daily-mutator']
    for (const name of workflowNames) {
      const workflowPath = join(testHome, '.flt', 'workflows', `${name}.yaml`)
      expect(existsSync(workflowPath)).toBe(true)
      const def = loadWorkflowDef(name)
      expect(def.name).toBe(name)
    }
  })

  it('does not overwrite existing user-edited workflow on re-init copy', () => {
    seedFlt()

    const fltDir = join(testHome, '.flt')
    const workflowPath = join(fltDir, 'workflows', 'code-and-review.yaml')
    const custom = 'name: code-and-review\nsteps: []\n'
    writeFileSync(workflowPath, custom)

    seedDefaultWorkflows(fltDir)

    const after = readFileSync(workflowPath, 'utf-8')
    expect(after).toBe(custom)
  })
})
