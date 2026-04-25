import { describe, it, expect } from 'bun:test'
import { resolveModelForCli, resolveAlias } from '../../src/model-resolution'

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

describe('resolveAlias', () => {
  it('returns null for unknown aliases', () => {
    expect(resolveAlias('claude-code', 'gpt-5.4')).toBeNull()
    expect(resolveAlias('pi', 'some-random-alias')).toBeNull()
  })

  it('cc-opus: maps correctly for claude-code, codex, openclaude', () => {
    expect(resolveAlias('claude-code', 'cc-opus')).toBe('opus[1m]')
    expect(resolveAlias('codex', 'cc-opus')).toBe('gpt-5.4')
    expect(resolveAlias('openclaude', 'cc-opus')).toBe('opus[1m]')
  })

  it('cc-opus: throws for CLIs with no mapping', () => {
    expect(() => resolveAlias('pi', 'cc-opus')).toThrow('Model alias "cc-opus" has no mapping for CLI "pi".')
    expect(() => resolveAlias('gemini', 'cc-opus')).toThrow('Model alias "cc-opus" has no mapping for CLI "gemini".')
    expect(() => resolveAlias('opencode', 'cc-opus')).toThrow('Model alias "cc-opus" has no mapping for CLI "opencode".')
    expect(() => resolveAlias('crush', 'cc-opus')).toThrow('Model alias "cc-opus" has no mapping for CLI "crush".')
    expect(() => resolveAlias('continue-cli', 'cc-opus')).toThrow('Model alias "cc-opus" has no mapping for CLI "continue-cli".')
    expect(() => resolveAlias('droid', 'cc-opus')).toThrow('Model alias "cc-opus" has no mapping for CLI "droid".')
    expect(() => resolveAlias('qwen', 'cc-opus')).toThrow('Model alias "cc-opus" has no mapping for CLI "qwen".')
    expect(() => resolveAlias('kilo', 'cc-opus')).toThrow('Model alias "cc-opus" has no mapping for CLI "kilo".')
  })

  it('cc-sonnet: maps correctly for claude-code, crush, openclaude', () => {
    expect(resolveAlias('claude-code', 'cc-sonnet')).toBe('sonnet')
    expect(resolveAlias('crush', 'cc-sonnet')).toBe('anthropic/claude-sonnet-4-6')
    expect(resolveAlias('openclaude', 'cc-sonnet')).toBe('sonnet')
  })

  it('cc-sonnet: throws for CLIs with no mapping', () => {
    expect(() => resolveAlias('codex', 'cc-sonnet')).toThrow('Model alias "cc-sonnet" has no mapping for CLI "codex".')
    expect(() => resolveAlias('pi', 'cc-sonnet')).toThrow('Model alias "cc-sonnet" has no mapping for CLI "pi".')
    expect(() => resolveAlias('gemini', 'cc-sonnet')).toThrow('Model alias "cc-sonnet" has no mapping for CLI "gemini".')
    expect(() => resolveAlias('opencode', 'cc-sonnet')).toThrow('Model alias "cc-sonnet" has no mapping for CLI "opencode".')
    expect(() => resolveAlias('continue-cli', 'cc-sonnet')).toThrow('Model alias "cc-sonnet" has no mapping for CLI "continue-cli".')
    expect(() => resolveAlias('kilo', 'cc-sonnet')).toThrow('Model alias "cc-sonnet" has no mapping for CLI "kilo".')
  })

  it('cc-haiku: maps correctly for claude-code, openclaude', () => {
    expect(resolveAlias('claude-code', 'cc-haiku')).toBe('haiku')
    expect(resolveAlias('openclaude', 'cc-haiku')).toBe('haiku')
  })

  it('cc-haiku: throws for CLIs with no mapping', () => {
    expect(() => resolveAlias('codex', 'cc-haiku')).toThrow('Model alias "cc-haiku" has no mapping for CLI "codex".')
    expect(() => resolveAlias('pi', 'cc-haiku')).toThrow('Model alias "cc-haiku" has no mapping for CLI "pi".')
    expect(() => resolveAlias('gemini', 'cc-haiku')).toThrow('Model alias "cc-haiku" has no mapping for CLI "gemini".')
  })

  it('pi-coder: maps correctly for codex and pi', () => {
    expect(resolveAlias('codex', 'pi-coder')).toBe('gpt-5.3-codex')
    expect(resolveAlias('pi', 'pi-coder')).toBe('openai-codex/gpt-5.3-codex')
  })

  it('pi-coder: throws for CLIs with no mapping', () => {
    expect(() => resolveAlias('claude-code', 'pi-coder')).toThrow('Model alias "pi-coder" has no mapping for CLI "claude-code".')
    expect(() => resolveAlias('gemini', 'pi-coder')).toThrow('Model alias "pi-coder" has no mapping for CLI "gemini".')
    expect(() => resolveAlias('opencode', 'pi-coder')).toThrow('Model alias "pi-coder" has no mapping for CLI "opencode".')
    expect(() => resolveAlias('crush', 'pi-coder')).toThrow('Model alias "pi-coder" has no mapping for CLI "crush".')
    expect(() => resolveAlias('continue-cli', 'pi-coder')).toThrow('Model alias "pi-coder" has no mapping for CLI "continue-cli".')
    expect(() => resolveAlias('droid', 'pi-coder')).toThrow('Model alias "pi-coder" has no mapping for CLI "droid".')
    expect(() => resolveAlias('openclaude', 'pi-coder')).toThrow('Model alias "pi-coder" has no mapping for CLI "openclaude".')
    expect(() => resolveAlias('qwen', 'pi-coder')).toThrow('Model alias "pi-coder" has no mapping for CLI "qwen".')
    expect(() => resolveAlias('kilo', 'pi-coder')).toThrow('Model alias "pi-coder" has no mapping for CLI "kilo".')
  })

  it('pi-deep: maps correctly for codex and pi', () => {
    expect(resolveAlias('codex', 'pi-deep')).toBe('gpt-5.4-high')
    expect(resolveAlias('pi', 'pi-deep')).toBe('openai-codex/gpt-5.4:high')
  })

  it('pi-deep: throws for CLIs with no mapping', () => {
    expect(() => resolveAlias('claude-code', 'pi-deep')).toThrow('Model alias "pi-deep" has no mapping for CLI "claude-code".')
    expect(() => resolveAlias('gemini', 'pi-deep')).toThrow('Model alias "pi-deep" has no mapping for CLI "gemini".')
  })

  it('gemini-pro: maps correctly for gemini', () => {
    expect(resolveAlias('gemini', 'gemini-pro')).toBe('gemini-2.5-pro')
  })

  it('gemini-pro: throws for CLIs with no mapping', () => {
    expect(() => resolveAlias('claude-code', 'gemini-pro')).toThrow('Model alias "gemini-pro" has no mapping for CLI "claude-code".')
    expect(() => resolveAlias('codex', 'gemini-pro')).toThrow('Model alias "gemini-pro" has no mapping for CLI "codex".')
    expect(() => resolveAlias('pi', 'gemini-pro')).toThrow('Model alias "gemini-pro" has no mapping for CLI "pi".')
    expect(() => resolveAlias('opencode', 'gemini-pro')).toThrow('Model alias "gemini-pro" has no mapping for CLI "opencode".')
    expect(() => resolveAlias('crush', 'gemini-pro')).toThrow('Model alias "gemini-pro" has no mapping for CLI "crush".')
    expect(() => resolveAlias('continue-cli', 'gemini-pro')).toThrow('Model alias "gemini-pro" has no mapping for CLI "continue-cli".')
    expect(() => resolveAlias('droid', 'gemini-pro')).toThrow('Model alias "gemini-pro" has no mapping for CLI "droid".')
    expect(() => resolveAlias('openclaude', 'gemini-pro')).toThrow('Model alias "gemini-pro" has no mapping for CLI "openclaude".')
    expect(() => resolveAlias('qwen', 'gemini-pro')).toThrow('Model alias "gemini-pro" has no mapping for CLI "qwen".')
    expect(() => resolveAlias('kilo', 'gemini-pro')).toThrow('Model alias "gemini-pro" has no mapping for CLI "kilo".')
  })

  it('resolveModelForCli honours alias and returns final form directly', () => {
    expect(resolveModelForCli('claude-code', 'cc-opus')).toBe('opus[1m]')
    expect(resolveModelForCli('codex', 'cc-opus')).toBe('gpt-5.4')
    expect(resolveModelForCli('pi', 'pi-coder')).toBe('openai-codex/gpt-5.3-codex')
    expect(resolveModelForCli('gemini', 'gemini-pro')).toBe('gemini-2.5-pro')
  })

  it('resolveModelForCli alias resolution is skipped when noResolve=true', () => {
    expect(resolveModelForCli('claude-code', 'cc-opus', true)).toBe('cc-opus')
  })

  it('plain opus → opus[1m] for claude-code (no non-1m Opus rule)', () => {
    expect(resolveModelForCli('claude-code', 'opus')).toBe('opus[1m]')
  })

  it('plain opus → opus[1m] for openclaude', () => {
    expect(resolveModelForCli('openclaude', 'opus')).toBe('opus[1m]')
  })

  it('opus[1m] passes through unchanged for claude-code', () => {
    expect(resolveModelForCli('claude-code', 'opus[1m]')).toBe('opus[1m]')
  })

  it('plain opus is preserved for non-claude CLIs (aider, etc. — provider prefix instead)', () => {
    // aider gets `anthropic/opus`; the 1m rule is claude-API-specific.
    expect(resolveModelForCli('aider', 'opus')).toBe('anthropic/opus')
  })

  it('cc-opus alias for openclaude → opus[1m] (was opus)', () => {
    expect(resolveAlias('openclaude', 'cc-opus')).toBe('opus[1m]')
  })

  it('noResolve preserves plain opus literally', () => {
    expect(resolveModelForCli('claude-code', 'opus', true)).toBe('opus')
  })
})
