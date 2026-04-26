import { describe, expect, it } from 'bun:test'
import { evaluateCondition } from '../../src/workflow/condition'

describe('evaluateCondition', () => {
  it('evaluates equality for template var and single-quoted literal', () => {
    expect(evaluateCondition("{steps.coder.verdict} == 'pass'", { steps: { coder: { verdict: 'pass' } } })).toBe(true)
    expect(evaluateCondition("{steps.coder.verdict} == 'pass'", { steps: { coder: { verdict: 'fail' } } })).toBe(false)
  })

  it('evaluates inequality for template var and single-quoted literal', () => {
    expect(evaluateCondition("{x} != 'y'", { x: 'z' })).toBe(true)
    expect(evaluateCondition("{x} != 'y'", { x: 'y' })).toBe(false)
  })

  it('evaluates literal comparisons', () => {
    expect(evaluateCondition("'a' == 'a'", {})).toBe(true)
    expect(evaluateCondition("'a' == 'b'", {})).toBe(false)
  })

  it('does not split on operator characters inside a literal or template var', () => {
    expect(evaluateCondition("'a==b' == 'a==b'", {})).toBe(true)
    expect(evaluateCondition("'{x}' == '{x}'", {})).toBe(true)
    expect(evaluateCondition("{steps.a==b.x} == ''", {})).toBe(true)
  })

  it('resolves missing vars as empty string', () => {
    expect(evaluateCondition("{missing.path} == ''", {})).toBe(true)
  })

  it('tolerates whitespace and no-space expressions', () => {
    expect(evaluateCondition('{x}=={y}', { x: 'same', y: 'same' })).toBe(true)
    expect(evaluateCondition('  {x}  ==  "y"  ', { x: 'y' })).toBe(true)
  })

  it('throws when operator is missing', () => {
    expect(() => evaluateCondition("'a'", {})).toThrow('missing operator')
  })

  it('throws for unclosed quote', () => {
    expect(() => evaluateCondition("'oops", {})).toThrow('unclosed')
  })

  it('throws for unclosed brace', () => {
    expect(() => evaluateCondition('{steps.coder', {})).toThrow('unclosed')
  })

  it('throws for invalid operand', () => {
    expect(() => evaluateCondition("pass == 'pass'", {})).toThrow('invalid operand')
  })
})
