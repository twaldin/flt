import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateBugReport } from '../../scripts/validate-bug-report'

/**
 * Unit tests for the bug-report validator. Each test corresponds to a
 * scenario called out in `harness-builder/SKILL.md` step 4:
 *
 *   1. accepts a sample valid array
 *   2. rejects missing field
 *   3. rejects wrong severity
 *   4. rejects bad type for repro_steps
 *   5. accepts empty array
 *
 * The validator hits the filesystem to confirm `evidence_path` exists. We
 * create a real evidence file in a tmpdir so the "valid" cases pass without
 * stubbing.
 */
describe('validate-bug-report', () => {
  let workdir: string
  let evidencePath: string

  beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), 'flt-bugval-'))
    evidencePath = join(workdir, 'evidence.txt')
    writeFileSync(evidencePath, 'sample evidence')
  })

  afterAll(() => {
    rmSync(workdir, { recursive: true, force: true })
  })

  function makeValid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'lifecycle-001',
      title: 'flt list crashes on empty state',
      surface: 'lifecycle',
      severity: 'high',
      repro_steps: ['HOME=$SBX bun src/cli.ts list'],
      observed: 'TypeError: cannot read property of undefined',
      expected: 'prints empty agent list',
      env: { HOME: '/tmp/flt-bughunt-abc', bun: '1.3.11' },
      evidence_path: evidencePath,
      cycle: 1,
      ...overrides,
    }
  }

  it('accepts a sample valid array', () => {
    const result = validateBugReport([makeValid()])
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('rejects an entry missing a required field', () => {
    const entry = makeValid()
    // Drop the `surface` field to simulate a missing required field.
    delete (entry as Record<string, unknown>).surface
    const result = validateBugReport([entry])
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.field === 'surface')).toBe(true)
  })

  it('rejects an entry with an unknown severity', () => {
    const result = validateBugReport([makeValid({ severity: 'sev-2' })])
    expect(result.ok).toBe(false)
    expect(
      result.errors.some(
        (e) => e.field === 'severity' && e.message.includes('critical|high|medium|low'),
      ),
    ).toBe(true)
  })

  it('rejects an entry whose repro_steps has the wrong type', () => {
    const result = validateBugReport([
      makeValid({ repro_steps: 'flt list' as unknown as string[] }),
    ])
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.field === 'repro_steps')).toBe(true)
  })

  it('accepts an empty array', () => {
    const result = validateBugReport([])
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })
})
