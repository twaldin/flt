import { describe, it, expect } from 'bun:test'
import { getAdapter, listAdapters, resolveAdapter } from '../../../src/adapters/registry'

describe('adapter registry', () => {
  it('lists all adapters', () => {
    const adapters = listAdapters()
    expect(adapters).toContain('claude-code')
    expect(adapters).toContain('codex')
    expect(adapters).toContain('gemini')
    expect(adapters).toContain('opencode')
    expect(adapters).toContain('swe-agent')
    expect(adapters).toContain('pi')
    expect(adapters).not.toContain('aider')
    expect(adapters.length).toBe(6)
  })

  it('gets adapter by name', () => {
    const adapter = getAdapter('claude-code')
    expect(adapter).toBeDefined()
    expect(adapter!.cliCommand).toBe('claude')
  })

  it('returns undefined for unknown adapter', () => {
    expect(getAdapter('unknown')).toBeUndefined()
  })

  it('resolveAdapter throws for unknown', () => {
    expect(() => resolveAdapter('nope')).toThrow(/Unknown CLI adapter/)
  })

  it('resolveAdapter returns adapter for known name', () => {
    const adapter = resolveAdapter('codex')
    expect(adapter.name).toBe('codex')
    expect(adapter.cliCommand).toBe('codex')
  })
})
