import { describe, it, expect } from 'bun:test'
import { resolveModelForCli } from '../../src/model-resolution'

describe('model resolution', () => {
  it('resolves pi gpt-5 aliases to openai-codex provider prefix', () => {
    expect(resolveModelForCli('pi', 'gpt-5.4')).toBe('openai-codex/gpt-5.4')
    expect(resolveModelForCli('pi', 'gpt-5.4-mini')).toBe('openai-codex/gpt-5.4-mini')
  })

  it('keeps explicit provider for pi', () => {
    expect(resolveModelForCli('pi', 'openai-codex/gpt-5.4')).toBe('openai-codex/gpt-5.4')
  })

  it('strips provider for bare-model CLIs', () => {
    expect(resolveModelForCli('codex', 'openai-codex/gpt-5.4')).toBe('gpt-5.4')
    expect(resolveModelForCli('claude-code', 'anthropic/sonnet')).toBe('sonnet')
  })

  it('adds provider for provider-model CLIs', () => {
    expect(resolveModelForCli('opencode', 'gpt-5.4')).toBe('openai/gpt-5.4')
    expect(resolveModelForCli('aider', 'claude-sonnet-4.6')).toBe('anthropic/claude-sonnet-4.6')
  })

  it('supports raw passthrough when noResolve=true', () => {
    expect(resolveModelForCli('pi', 'gpt-5.4', true)).toBe('gpt-5.4')
    expect(resolveModelForCli('opencode', 'gpt-5.4', true)).toBe('gpt-5.4')
  })
})
