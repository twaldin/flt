import { describe, it, expect } from 'bun:test'
import { join } from 'node:path'
import { getAdapter } from '@twaldin/harness-ts'
import '@twaldin/harness-ts'

const FIXTURES = join(import.meta.dir, '..', 'fixtures', 'session-logs')

describe('pi session-log telemetry', () => {
  it('parses real fixture into non-zero tokens, cost, and model', () => {
    const adapter = getAdapter('pi')
    const fixturePath = join(FIXTURES, 'pi', 'session.jsonl')
    const result = adapter.parseSessionLog!(fixturePath)
    expect(result.tokensIn).toBeGreaterThan(0)
    expect(result.tokensOut).toBeGreaterThan(0)
    expect(result.costUsd).toBeGreaterThan(0)
    expect(result.model).not.toBeNull()
    expect(result.model).not.toBe('<synthetic>')
  })
})
