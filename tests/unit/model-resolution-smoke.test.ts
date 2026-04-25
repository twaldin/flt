import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { smokeModel, smokeModelCached, clearSmokeCache } from '../../src/model-resolution-smoke'

let tmpHome: string
const origHome = process.env.HOME
const origPath = process.env.PATH

function makeFakeBin(bin: string, body: string): string {
  const dir = join(tmpHome, 'fake-bin')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, bin)
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  return dir
}

beforeEach(() => {
  tmpHome = join(tmpdir(), `flt-smoke-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpHome, { recursive: true })
  process.env.HOME = tmpHome
})

afterEach(() => {
  process.env.HOME = origHome
  process.env.PATH = origPath
  if (existsSync(tmpHome)) rmSync(tmpHome, { recursive: true, force: true })
})

describe('smokeModel', () => {
  it('returns ok=true when fake CLI exits 0', async () => {
    const dir = makeFakeBin('claude', 'exit 0')
    process.env.PATH = `${dir}:${origPath}`
    const result = await smokeModel({ cli: 'claude-code', model: 'sonnet' })
    expect(result.ok).toBe(true)
    expect(result.exitCode).toBe(0)
  })

  it('returns ok=false with reason when CLI emits "unknown model"', async () => {
    const dir = makeFakeBin('claude', 'echo "Error: unknown model" 1>&2; exit 1')
    process.env.PATH = `${dir}:${origPath}`
    const result = await smokeModel({ cli: 'claude-code', model: 'bogus' })
    expect(result.ok).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(result.reason).toBe('model rejected by cli')
  })

  it('returns ok=false with reason when CLI exits non-zero without rejection text', async () => {
    const dir = makeFakeBin('claude', 'exit 2')
    process.env.PATH = `${dir}:${origPath}`
    const result = await smokeModel({ cli: 'claude-code', model: 'sonnet' })
    expect(result.ok).toBe(false)
    expect(result.exitCode).toBe(2)
    expect(result.reason).toContain('non-zero exit')
  })

  it('handles missing binary cleanly (no throw)', async () => {
    process.env.PATH = '/nonexistent-path-only'
    const result = await smokeModel({ cli: 'claude-code', model: 'sonnet' })
    expect(result.ok).toBe(false)
    expect(result.exitCode).toBe(-1)
    expect(result.reason).toContain('not found')
  })

  it('times out long-running CLI', async () => {
    const dir = makeFakeBin('claude', 'sleep 10')
    process.env.PATH = `${dir}:${origPath}`
    const result = await smokeModel({ cli: 'claude-code', model: 'sonnet', timeoutMs: 100 })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('timeout')
  })

  it('returns inconclusive for unknown CLI', async () => {
    const result = await smokeModel({ cli: 'never-was-a-cli', model: 'x' })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('no smoke recipe')
  })
})

describe('smokeModelCached', () => {
  it('caches result; second call hits cache', async () => {
    const dir = makeFakeBin('claude', 'exit 0')
    process.env.PATH = `${dir}:${origPath}`

    const first = await smokeModelCached({ cli: 'claude-code', model: 'sonnet' })
    expect(first.ok).toBe(true)
    expect(first.reason).toBeUndefined()

    // Replace fake bin with a failing one — if cache is hit, second call still reports ok.
    writeFileSync(join(dir, 'claude'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })

    const second = await smokeModelCached({ cli: 'claude-code', model: 'sonnet' })
    expect(second.ok).toBe(true)
    expect(second.reason).toContain('cached')
  })

  it('force=true bypasses cache', async () => {
    const dir = makeFakeBin('claude', 'exit 0')
    process.env.PATH = `${dir}:${origPath}`

    const first = await smokeModelCached({ cli: 'claude-code', model: 'sonnet' })
    expect(first.ok).toBe(true)

    writeFileSync(join(dir, 'claude'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })

    const second = await smokeModelCached({ cli: 'claude-code', model: 'sonnet', force: true })
    expect(second.ok).toBe(false)
  })

  it('persists cache to ~/.flt/model-smoke-cache.json', async () => {
    const dir = makeFakeBin('claude', 'exit 0')
    process.env.PATH = `${dir}:${origPath}`

    await smokeModelCached({ cli: 'claude-code', model: 'sonnet' })
    const cachePath = join(tmpHome, '.flt', 'model-smoke-cache.json')
    expect(existsSync(cachePath)).toBe(true)
    const parsed = JSON.parse(readFileSync(cachePath, 'utf-8'))
    expect(parsed.entries['claude-code::sonnet']).toBeDefined()
    expect(parsed.entries['claude-code::sonnet'].ok).toBe(true)
  })

  it('clearSmokeCache wipes entries', async () => {
    const dir = makeFakeBin('claude', 'exit 0')
    process.env.PATH = `${dir}:${origPath}`

    await smokeModelCached({ cli: 'claude-code', model: 'sonnet' })
    clearSmokeCache()

    const cachePath = join(tmpHome, '.flt', 'model-smoke-cache.json')
    const parsed = JSON.parse(readFileSync(cachePath, 'utf-8'))
    expect(parsed.entries).toEqual({})
  })
})
