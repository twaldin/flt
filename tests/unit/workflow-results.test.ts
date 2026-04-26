import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { aggregateResults, writeResult } from '../../src/workflow/results'

describe('workflow results', () => {
  let runDir = ''

  beforeEach(() => {
    runDir = mkdtempSync(join(tmpdir(), 'flt-results-'))
  })

  afterEach(() => {
    rmSync(runDir, { recursive: true, force: true })
  })

  it('writeResult creates results subdir and expected file with correct JSON shape', () => {
    writeResult(runDir, 'coder', 'a', 'pass')

    const file = join(runDir, 'results', 'coder-a.json')
    expect(existsSync(file)).toBe(true)

    const parsed = JSON.parse(readFileSync(file, 'utf-8'))
    expect(parsed.step).toBe('coder')
    expect(parsed.label).toBe('a')
    expect(parsed.verdict).toBe('pass')
    expect(parsed.failReason).toBeUndefined()
    expect(typeof parsed.at).toBe('string')
    expect(Number.isNaN(Date.parse(parsed.at))).toBe(false)
  })

  it('writeResult overwrites existing same step and label file', () => {
    writeResult(runDir, 'coder', 'a', 'fail', 'first')
    writeResult(runDir, 'coder', 'a', 'pass')

    const parsed = JSON.parse(readFileSync(join(runDir, 'results', 'coder-a.json'), 'utf-8'))
    expect(parsed.verdict).toBe('pass')
    expect(parsed.failReason).toBeUndefined()
  })

  it('writeResult uses atomic tmp plus rename and leaves no tmp file', () => {
    writeResult(runDir, 'coder', 'a', 'pass')

    const resultFiles = readdirSync(join(runDir, 'results'))
    expect(resultFiles.includes('coder-a.json.tmp')).toBe(false)
  })

  it('writeResult rejects invalid step variants', () => {
    expect(() => writeResult(runDir, 'cod/er', 'a', 'pass')).toThrow()
    expect(() => writeResult(runDir, '..', 'a', 'pass')).toThrow()
    expect(() => writeResult(runDir, 'cod er', 'a', 'pass')).toThrow()
  })

  it('writeResult rejects invalid label variants', () => {
    expect(() => writeResult(runDir, 'coder', 'a/b', 'pass')).toThrow()
    expect(() => writeResult(runDir, 'coder', '..', 'pass')).toThrow()
    expect(() => writeResult(runDir, 'coder', 'a b', 'pass')).toThrow()
  })

  it('aggregateResults on missing results dir returns empty without throw', () => {
    expect(aggregateResults(runDir, 'coder', 1)).toEqual({
      allDone: false,
      passers: [],
      failures: [],
    })
  })

  it('aggregateResults reports allDone false for 0 of 3 expected', () => {
    expect(aggregateResults(runDir, 'coder', 3).allDone).toBe(false)
  })

  it('aggregateResults reports allDone false for 2 of 3 expected with populated results', () => {
    writeResult(runDir, 'coder', 'a', 'pass')
    writeResult(runDir, 'coder', 'b', 'fail', 'nope')

    expect(aggregateResults(runDir, 'coder', 3)).toEqual({
      allDone: false,
      passers: ['a'],
      failures: [{ label: 'b', reason: 'nope' }],
    })
  })

  it('aggregateResults reports allDone true for 3 of 3 mixed verdicts', () => {
    writeResult(runDir, 'coder', 'c', 'pass')
    writeResult(runDir, 'coder', 'b', 'fail', 'bad')
    writeResult(runDir, 'coder', 'a', 'pass')

    expect(aggregateResults(runDir, 'coder', 3)).toEqual({
      allDone: true,
      passers: ['a', 'c'],
      failures: [{ label: 'b', reason: 'bad' }],
    })
  })

  it('aggregateResults ignores files from other steps', () => {
    writeResult(runDir, 'coder', 'a', 'pass')
    writeResult(runDir, 'reviewer', '_', 'fail', 'irrelevant')

    expect(aggregateResults(runDir, 'coder', 1)).toEqual({
      allDone: true,
      passers: ['a'],
      failures: [],
    })
  })

  it('aggregateResults does not match step ids that share a hyphenated prefix', () => {
    writeResult(runDir, 'code', 'a', 'pass')
    writeResult(runDir, 'code-2', 'b', 'pass')

    expect(aggregateResults(runDir, 'code', 1)).toEqual({
      allDone: true,
      passers: ['a'],
      failures: [],
    })
    expect(aggregateResults(runDir, 'code-2', 1)).toEqual({
      allDone: true,
      passers: ['b'],
      failures: [],
    })
  })

  it('aggregateResults skips malformed JSON files', () => {
    writeResult(runDir, 'coder', 'a', 'pass')
    writeFileSync(join(runDir, 'results', 'coder-b.json'), '{bad json')

    expect(aggregateResults(runDir, 'coder', 2)).toEqual({
      allDone: false,
      passers: ['a'],
      failures: [],
    })
  })

  it('supports single step convention with label underscore', () => {
    writeResult(runDir, 'reviewer', '_', 'pass')

    expect(aggregateResults(runDir, 'reviewer', 1)).toEqual({
      allDone: true,
      passers: ['_'],
      failures: [],
    })
  })
})
