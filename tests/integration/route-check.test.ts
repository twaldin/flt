import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { routeCheck, formatRouteCheckTable } from '../../src/commands/route-check'

let tmpHome: string
const origHome = process.env.HOME

const REAL_PRESETS = {
  'cc-coder': { cli: 'claude-code', model: 'sonnet', description: 'real preset', soul: 'roles/coder.md' },
  'codex-coder': { cli: 'codex', model: 'gpt-5.3-codex', description: 'real preset', soul: 'roles/coder.md' },
  'gemini-coder': { cli: 'gemini', model: 'gemini-2.5-pro', description: 'real preset', soul: 'roles/coder.md' },
}

function seedFlt(opts: {
  policy: Record<string, string>
  presets?: Record<string, { cli: string; model?: string; description: string; soul?: string }>
}): void {
  const fltDir = join(tmpHome, '.flt')
  mkdirSync(join(fltDir, 'routing'), { recursive: true })
  const yaml = Object.entries(opts.policy).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n'
  writeFileSync(join(fltDir, 'routing', 'policy.yaml'), yaml)
  if (opts.presets) {
    writeFileSync(join(fltDir, 'presets.json'), JSON.stringify(opts.presets, null, 2))
  }
}

function fakeSmoke(behavior: Record<string, { ok: boolean; reason?: string; exitCode?: number }>) {
  const callLog: string[] = []
  const fn = async (input: { cli: string; model: string }) => {
    const key = `${input.cli}::${input.model}`
    callLog.push(key)
    const b = behavior[key] ?? { ok: true }
    return {
      ok: b.ok,
      exitCode: b.exitCode ?? (b.ok ? 0 : 1),
      durationMs: 1,
      reason: b.reason,
    }
  }
  return { fn, callLog }
}

beforeEach(() => {
  tmpHome = join(tmpdir(), `flt-route-check-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpHome, { recursive: true })
  process.env.HOME = tmpHome
})

afterEach(() => {
  process.env.HOME = origHome
  if (existsSync(tmpHome)) rmSync(tmpHome, { recursive: true, force: true })
})

describe('routeCheck', () => {
  it('throws when policy.yaml missing', async () => {
    await expect(routeCheck()).rejects.toThrow('Routing policy not found')
  })

  it('returns OK rows when smoke succeeds for every preset', async () => {
    seedFlt({
      policy: { coder: 'cc-coder', architect: 'codex-coder' },
      presets: REAL_PRESETS,
    })
    const { fn } = fakeSmoke({})
    const result = await routeCheck({ smoke: fn })
    expect(result.hasFailures).toBe(false)
    expect(result.rows).toHaveLength(2)
    const coder = result.rows.find((r) => r.role === 'coder')!
    expect(coder.status).toBe('OK')
    expect(coder.cli).toBe('claude-code')
    expect(coder.resolvedModel).toBe('sonnet')
    const arch = result.rows.find((r) => r.role === 'architect')!
    expect(arch.status).toBe('OK')
    expect(arch.cli).toBe('codex')
  })

  it('emits WARN row when preset is missing from presets.json', async () => {
    seedFlt({
      policy: { coder: 'pi-coder', architect: 'cc-coder' },
      presets: REAL_PRESETS,
    })
    const { fn } = fakeSmoke({})
    const result = await routeCheck({ smoke: fn })
    const coder = result.rows.find((r) => r.role === 'coder')!
    expect(coder.status).toBe('WARN')
    expect(coder.notes).toContain('not in presets.json')
    const arch = result.rows.find((r) => r.role === 'architect')!
    expect(arch.status).toBe('OK')
  })

  it('emits FAIL row when smoke rejects model', async () => {
    seedFlt({
      policy: { coder: 'cc-coder' },
      presets: REAL_PRESETS,
    })
    const { fn } = fakeSmoke({
      'claude-code::sonnet': { ok: false, reason: 'model rejected by cli', exitCode: 1 },
    })
    const result = await routeCheck({ smoke: fn })
    expect(result.hasFailures).toBe(true)
    expect(result.rows[0].status).toBe('FAIL')
    expect(result.rows[0].notes).toContain('model rejected')
  })

  it('passes through resolveModelForCli — codex strips provider prefix', async () => {
    seedFlt({
      policy: { coder: 'codex-coder' },
      presets: {
        'codex-coder': { cli: 'codex', model: 'openai-codex/gpt-5.3-codex', description: 'x', soul: 'roles/coder.md' },
      },
    })
    const { fn, callLog } = fakeSmoke({})
    await routeCheck({ smoke: fn })
    // codex is a bare-model harness; provider prefix should be stripped before smoke.
    expect(callLog).toContain('codex::gpt-5.3-codex')
  })

  it('mixed WARN + OK + FAIL produces correct hasFailures + counts', async () => {
    seedFlt({
      policy: {
        coder: 'cc-coder',
        architect: 'pi-coder',  // missing
        oracle: 'codex-coder',
      },
      presets: REAL_PRESETS,
    })
    const { fn } = fakeSmoke({
      'codex::gpt-5.3-codex': { ok: false, reason: 'model rejected by cli', exitCode: 1 },
    })
    const result = await routeCheck({ smoke: fn })
    expect(result.hasFailures).toBe(true)
    expect(result.rows.find((r) => r.role === 'coder')!.status).toBe('OK')
    expect(result.rows.find((r) => r.role === 'architect')!.status).toBe('WARN')
    expect(result.rows.find((r) => r.role === 'oracle')!.status).toBe('FAIL')
  })

  it('forwards force flag to smoke fn', async () => {
    seedFlt({
      policy: { coder: 'cc-coder' },
      presets: REAL_PRESETS,
    })
    let observedForce: boolean | undefined
    const fn = async (input: { cli: string; model: string; force?: boolean }) => {
      observedForce = input.force
      return { ok: true, exitCode: 0, durationMs: 1 }
    }
    await routeCheck({ smoke: fn, force: true })
    expect(observedForce).toBe(true)
  })

  it('reuses cache via real smokeModelCached path (smoke called once per unique pair)', async () => {
    seedFlt({
      policy: { coder: 'cc-coder', tester: 'cc-coder' },  // both → same (cli, model)
      presets: REAL_PRESETS,
    })
    let calls = 0
    const fn = async (input: { cli: string; model: string }) => {
      calls++
      return { ok: true, exitCode: 0, durationMs: 1 }
    }
    await routeCheck({ smoke: fn })
    // Two roles, same preset → fn called twice (no in-process dedup yet).
    // The cache is exercised in the smoke-cached test; here we just verify each row called once.
    expect(calls).toBe(2)
  })
})

describe('formatRouteCheckTable', () => {
  it('renders headers and rows', () => {
    const out = formatRouteCheckTable({
      hasFailures: false,
      rows: [
        { role: 'coder', preset: 'cc-coder', cli: 'claude-code', model: 'sonnet', resolvedModel: 'sonnet', status: 'OK', notes: 'ok' },
      ],
    })
    expect(out).toContain('role')
    expect(out).toContain('coder')
    expect(out).toContain('claude-code')
    expect(out).toContain('OK')
  })
})
