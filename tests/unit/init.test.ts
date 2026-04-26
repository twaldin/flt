import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { seedFlt } from '../../src/commands/init'

describe('init: seedFlt', () => {
  let testHome: string
  let origHome: string | undefined

  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), 'flt-init-test-'))
    origHome = process.env.HOME
    process.env.HOME = testHome
  })

  afterEach(() => {
    process.env.HOME = origHome
    rmSync(testHome, { recursive: true, force: true })
  })

  it('creates the 9 expected subdirs', () => {
    seedFlt()
    const subdirs = ['roles', 'agents', 'skills', 'workflows', 'templates', 'runs', 'logs', 'bin', 'backups']
    for (const sub of subdirs) {
      expect(existsSync(join(testHome, '.flt', sub))).toBe(true)
    }
  })

  it('writes the 5 expected seed files', () => {
    seedFlt()
    const files = ['state.json', '.managed-skills.json', 'config.json', 'models.json', 'presets.json']
    for (const file of files) {
      expect(existsSync(join(testHome, '.flt', file))).toBe(true)
    }
  })

  it('presets.json round-trips through JSON.parse and contains orchestrator key', () => {
    seedFlt()
    const presetsPath = join(testHome, '.flt', 'presets.json')
    const raw = readFileSync(presetsPath, 'utf-8')
    const presets = JSON.parse(raw)
    expect(typeof presets).toBe('object')
    expect(presets).toHaveProperty('orchestrator')
  })

  it('copies non-empty template files', () => {
    seedFlt()
    const templates = ['system-block-root.md', 'system-block-subagent.md', 'workflow-block.md']
    for (const tmpl of templates) {
      const path = join(testHome, '.flt', 'templates', tmpl)
      expect(existsSync(path)).toBe(true)
      expect(readFileSync(path, 'utf-8').length).toBeGreaterThan(0)
    }
  })

  it('is idempotent — second call does not throw and preserves user-modified files', () => {
    seedFlt()

    // user modifies presets.json + state.json after first init
    const presetsPath = join(testHome, '.flt', 'presets.json')
    const statePath = join(testHome, '.flt', 'state.json')
    const userPresets = '{"my-custom-preset":{"cli":"claude-code","model":"sonnet"}}'
    const userState = '{"agents":{"existing-agent":{"name":"existing-agent"}},"config":{"maxDepth":3}}'
    require('fs').writeFileSync(presetsPath, userPresets)
    require('fs').writeFileSync(statePath, userState)

    // simulate partial loss: delete a workflow + a template
    rmSync(join(testHome, '.flt', 'workflows', 'idea-to-pr.yaml'), { force: true })
    rmSync(join(testHome, '.flt', 'templates', 'system-block-root.md'), { force: true })

    // second seed should not throw
    expect(() => seedFlt()).not.toThrow()

    // user customizations preserved
    expect(readFileSync(presetsPath, 'utf-8')).toBe(userPresets)
    expect(readFileSync(statePath, 'utf-8')).toBe(userState)

    // missing files restored
    expect(existsSync(join(testHome, '.flt', 'workflows', 'idea-to-pr.yaml'))).toBe(true)
    expect(existsSync(join(testHome, '.flt', 'templates', 'system-block-root.md'))).toBe(true)
  })

  it('idempotent re-seed does not overwrite routing yamls', () => {
    seedFlt()
    const policyPath = join(testHome, '.flt', 'routing', 'policy.yaml')
    const userPolicy = 'orchestrator: my-custom-orchestrator-preset\n'
    require('fs').writeFileSync(policyPath, userPolicy)

    seedFlt()

    expect(readFileSync(policyPath, 'utf-8')).toBe(userPolicy)
  })
})
