import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, realpathSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import { harnessExtract, archiveRun } from '../../src/harness'

let origHome: string | undefined

/**
 * Write a fake claude-code session JSONL at the slug claude-code would use
 * for the given workdir. Applies realpath + `/_.` → `-` (matching extractor).
 */
function seedSession(fakeHome: string, workdir: string, lines: unknown[]): string {
  let resolved = workdir
  try { resolved = realpathSync(workdir) } catch {}
  const slug = resolved.replace(/[\/_.]/g, '-')
  const dir = join(fakeHome, '.claude', 'projects', slug)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${crypto.randomUUID()}.jsonl`)
  writeFileSync(path, lines.map(l => JSON.stringify(l)).join('\n') + '\n', 'utf-8')
  return path
}

describe('harnessExtract (claude-code)', () => {
  let tempHome: string
  let workdir: string
  const spawnedAt = new Date().toISOString()

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'flt-test-harness-'))
    workdir = mkdtempSync(join(tmpdir(), 'flt-test-workdir-'))
    origHome = process.env.HOME
    process.env.HOME = tempHome
  })

  afterEach(() => {
    process.env.HOME = origHome
    rmSync(tempHome, { recursive: true, force: true })
    rmSync(workdir, { recursive: true, force: true })
  })

  it('returns null for non-claude-code CLI', () => {
    const r = harnessExtract({ cli: 'opencode', workdir, spawnedAt })
    expect(r).toBeNull()
  })

  it('returns null when no session dir exists', () => {
    const r = harnessExtract({ cli: 'claude-code', workdir, spawnedAt })
    expect(r).toBeNull()
  })

  it('sums tokens across assistant messages', () => {
    seedSession(tempHome, workdir, [
      { type: 'user', message: { content: 'hello' } },
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-4-7-20260101',
          usage: {
            input_tokens: 10,
            output_tokens: 100,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      },
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-4-7-20260101',
          usage: {
            input_tokens: 20,
            output_tokens: 200,
            cache_creation_input_tokens: 1000,
            cache_read_input_tokens: 500,
          },
        },
      },
    ])

    const r = harnessExtract({ cli: 'claude-code', workdir, spawnedAt })
    expect(r).not.toBeNull()
    expect(r!.tokens_in).toBe(30)
    expect(r!.tokens_out).toBe(300)
    expect(r!.model).toBe('claude-opus-4-7-20260101')
    // cost = (30*15 + 300*75 + 1000*18.75 + 500*1.50) / 1_000_000
    //      = (450 + 22500 + 18750 + 750) / 1_000_000 = 42450 / 1_000_000 = 0.04245
    expect(r!.cost_usd).toBeCloseTo(0.04245, 6)
  })

  it('tolerates a truncated final JSONL line', () => {
    const resolved = realpathSync(workdir)
    const slug = resolved.replace(/[\/_.]/g, '-')
    const dir = join(tempHome, '.claude', 'projects', slug)
    mkdirSync(dir, { recursive: true })
    const body =
      JSON.stringify({
        type: 'assistant',
        message: {
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 5, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      }) + '\n' +
      '{"type":"assistant","message":{"model":"claude-sonnet-4-6","usage":{"input_toke'
    writeFileSync(join(dir, 'abc.jsonl'), body, 'utf-8')

    const r = harnessExtract({ cli: 'claude-code', workdir, spawnedAt })
    expect(r).not.toBeNull()
    expect(r!.tokens_in).toBe(5)
    expect(r!.tokens_out).toBe(50)
  })

  it('returns tokens with cost_usd=null for unknown models', () => {
    seedSession(tempHome, workdir, [
      {
        type: 'assistant',
        message: {
          model: 'claude-mystery-99',
          usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      },
    ])
    const r = harnessExtract({ cli: 'claude-code', workdir, spawnedAt })
    expect(r).not.toBeNull()
    expect(r!.tokens_in).toBe(10)
    expect(r!.tokens_out).toBe(10)
    expect(r!.cost_usd).toBeNull()
  })

  it('returns null when session file has no assistant usage entries', () => {
    seedSession(tempHome, workdir, [
      { type: 'permission-mode', permissionMode: 'bypassPermissions' },
      { type: 'user', message: { content: 'hi' } },
    ])
    const r = harnessExtract({ cli: 'claude-code', workdir, spawnedAt })
    expect(r).toBeNull()
  })
})

describe('archiveRun', () => {
  let tempHome: string

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'flt-test-archive-'))
    origHome = process.env.HOME
    process.env.HOME = tempHome
  })

  afterEach(() => {
    process.env.HOME = origHome
    rmSync(tempHome, { recursive: true, force: true })
  })

  it('writes ~/.flt/runs/<name>-<spawnedAt>.json', () => {
    const spawnedAt = '2026-04-19T12:00:00.000Z'
    const path = archiveRun(
      { name: 'coder', cli: 'claude-code', model: 'sonnet', dir: '/tmp/x', spawnedAt },
      { cost_usd: 0.0123, tokens_in: 100, tokens_out: 200, model: 'claude-sonnet-4-6' },
    )
    expect(path).not.toBeNull()
    expect(existsSync(path!)).toBe(true)
    const runsDir = join(tempHome, '.flt', 'runs')
    const files = readdirSync(runsDir)
    expect(files.length).toBe(1)
    expect(files[0]).toMatch(/^coder-2026-04-19T12-00-00-000Z\.json$/)
    const payload = JSON.parse(readFileSync(path!, 'utf-8'))
    expect(payload.cost_usd).toBe(0.0123)
    expect(payload.tokens_in).toBe(100)
    expect(payload.tokens_out).toBe(200)
    expect(payload.actualModel).toBe('claude-sonnet-4-6')
    expect(payload.name).toBe('coder')
  })

  it('writes a null-cost entry when extract returned null', () => {
    const path = archiveRun(
      { name: 'x', cli: 'claude-code', model: 'sonnet', dir: '/tmp/x', spawnedAt: '2026-04-19T12:00:00.000Z' },
      null,
    )
    expect(path).not.toBeNull()
    const payload = JSON.parse(readFileSync(path!, 'utf-8'))
    expect(payload.cost_usd).toBeNull()
    expect(payload.tokens_in).toBeNull()
    expect(payload.actualModel).toBeNull()
  })
})
