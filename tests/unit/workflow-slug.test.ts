import { describe, expect, it } from 'bun:test'
import { slugFromTask } from '../../src/workflow/engine'

describe('slugFromTask', () => {
  it('strips punctuation and joins meaningful words', () => {
    // 'Track' and 'flt' are stopwords; 'A' is 1-char (dropped); 'for' is stopword.
    expect(slugFromTask('Track A — TUI metrics modal for flt')).toBe('tui-metrics-modal')
  })

  it('respects maxWords cap', () => {
    expect(slugFromTask('build a really long pile of stuff for the everything', 3)).toBe('build-really-long')
  })

  it('drops noise stopwords (flt, task, track, idea, pr)', () => {
    expect(slugFromTask('flt task: idea-to-pr modal').length).toBeGreaterThan(0)
    expect(slugFromTask('flt task track')).toBe('')
  })

  it('lowercases and removes non-alphanum', () => {
    expect(slugFromTask('GEPA optimization #data plumbing!')).toBe('gepa-optimization-data-plumbing')
  })

  it('returns empty string for empty input', () => {
    expect(slugFromTask('')).toBe('')
  })

  it('collapses repeated dashes from punctuation runs', () => {
    expect(slugFromTask('foo --- bar  ::  baz')).toBe('foo-bar-baz')
  })
})
