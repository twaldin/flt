import { describe, it, expect } from 'bun:test'
import { join } from 'node:path'
import { getAdapter } from '@twaldin/harness-ts'
import '@twaldin/harness-ts'

const FIXTURES = join(import.meta.dir, '..', 'fixtures', 'session-logs')

describe('opencode session-log telemetry', () => {
  it('parses real fixture into non-zero tokens, cost, and model', () => {
    const adapter = getAdapter('opencode')
    const dbPath = join(FIXTURES, 'opencode', 'session.db')
    const fixturePath = `${dbPath}#session(flt-fixture-opencode)`
    const result = adapter.parseSessionLog!(fixturePath)
    expect(result.tokensIn).toBeGreaterThan(0)
    expect(result.tokensOut).toBeGreaterThan(0)
    expect(result.costUsd).toBeGreaterThan(0)
    expect(result.model).not.toBeNull()
    expect(result.model).not.toBe('<synthetic>')
  })
})
