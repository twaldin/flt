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

  it('exits with code 1 when ~/.flt already exists, with message including ~./flt already exists', () => {
    seedFlt()

    const origExit = process.exit
    let stderrMsg = ''
    const origError = console.error
    console.error = (...args: unknown[]) => { stderrMsg = args.join(' ') }

    let exitCode: number | undefined
    ;(process.exit as (code?: number) => never) = ((code?: number) => {
      exitCode = code
      throw new Error(`exit:${code}`)
    }) as (code?: number) => never

    let threw = false
    try {
      seedFlt()
    } catch (e: unknown) {
      threw = true
      expect((e as Error).message).toBe('exit:1')
    } finally {
      process.exit = origExit
      console.error = origError
    }

    expect(threw).toBe(true)
    expect(exitCode).toBe(1)
    expect(stderrMsg).toContain('~/.flt already exists')
  })
})
