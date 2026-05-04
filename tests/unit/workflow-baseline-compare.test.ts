import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { compareToBaseline } from '../../src/workflow/engine'

describe('compareToBaseline', () => {
  let runDir = ''

  beforeEach(() => {
    runDir = mkdtempSync(join(tmpdir(), 'flt-baseline-'))
  })

  afterEach(() => {
    rmSync(runDir, { recursive: true, force: true })
  })

  it('returns empty arrays when baseline file is missing and output is clean', () => {
    const result = compareToBaseline(runDir, 'test', '3 tests passed\nall green')
    expect(result.newFailures).toEqual([])
    expect(result.preExistingFailures).toEqual([])
  })

  it('returns pre-existing failures that appear in both baseline and current', () => {
    writeFileSync(join(runDir, '.baseline-test.txt'), [
      '✗ harness > tokens_in 30 vs 1530',
      '3 tests passed',
    ].join('\n'))

    const current = [
      '✗ harness > tokens_in 30 vs 1530',
      '3 tests passed',
    ].join('\n')

    const result = compareToBaseline(runDir, 'test', current)
    expect(result.preExistingFailures).toContain('✗ harness > tokens_in 30 vs 1530')
    expect(result.newFailures).toEqual([])
  })

  it('returns new failures that appear in current but not baseline', () => {
    writeFileSync(join(runDir, '.baseline-test.txt'), [
      '✓ all good',
    ].join('\n'))

    const current = [
      '✓ all good',
      '✗ workflow > cancel cascade fails',
    ].join('\n')

    const result = compareToBaseline(runDir, 'test', current)
    expect(result.newFailures).toContain('✗ workflow > cancel cascade fails')
    expect(result.preExistingFailures).toEqual([])
  })

  it('handles tsc baseline with error lines', () => {
    writeFileSync(join(runDir, '.baseline-tsc.txt'), [
      'src/foo.ts(1,2): error TS2339: pre-existing',
    ].join('\n'))

    const current = [
      'src/foo.ts(1,2): error TS2339: pre-existing',
      'src/bar.ts(5,3): error TS2345: new error',
    ].join('\n')

    const result = compareToBaseline(runDir, 'tsc', current)
    expect(result.preExistingFailures).toHaveLength(1)
    expect(result.newFailures).toHaveLength(1)
    expect(result.newFailures[0]).toContain('bar.ts')
  })

  it('treats tsc-unavailable sentinel as empty baseline', () => {
    writeFileSync(join(runDir, '.baseline-tsc.txt'), 'tsc-unavailable')
    const current = 'src/foo.ts(1,1): error TS9999: something'
    const result = compareToBaseline(runDir, 'tsc', current)
    // sentinel means we have no baseline, treat all current errors as new
    expect(result.newFailures).toHaveLength(1)
    expect(result.preExistingFailures).toEqual([])
  })
})
