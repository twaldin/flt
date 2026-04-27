import { describe, it, expect } from 'bun:test'
import { join } from 'node:path'
import { getAdapter } from '@twaldin/harness-ts'
import '@twaldin/harness-ts'

const FIXTURES = join(import.meta.dir, '..', 'fixtures', 'session-logs')

describe('continue-cli session-log telemetry', () => {
  it('parses real fixture into non-zero tokens, cost, and model', () => {
    const adapter = getAdapter('continue-cli')
    const fixturePath = join(FIXTURES, 'continue-cli', 'session.json')
    const result = adapter.parseSessionLog!(fixturePath)
    expect(result.tokensIn).toBeGreaterThan(0)
    expect(result.tokensOut).toBeGreaterThan(0)
    expect(result.costUsd).toBeGreaterThan(0)
    expect(result.model).not.toBeNull()
    expect(result.model).not.toBe('<synthetic>')
  })
})
