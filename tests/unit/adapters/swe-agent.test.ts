import { describe, it, expect } from 'bun:test'
import { sweAgentAdapter } from '../../../src/adapters/swe-agent'

describe('swe-agent adapter', () => {
  it('generates spawn args with model', () => {
    const args = sweAgentAdapter.spawnArgs({ model: 'openrouter/deepseek/deepseek-v3.2', dir: '/tmp' })
    expect(args).toContain('mini')
    expect(args).toContain('-y')
    expect(args).toContain('--model')
    expect(args).toContain('openrouter/deepseek/deepseek-v3.2')
  })

  it('generates spawn args without model', () => {
    const args = sweAgentAdapter.spawnArgs({ dir: '/tmp' })
    expect(args).toContain('mini')
    expect(args).toContain('-y')
    expect(args).toContain('MSWEA_COST_TRACKING=ignore_errors')
  })

  it('detects ready state (v1)', () => {
    const pane = `This is mini-swe-agent version 2.2.8.
Loading global config...
What do you want to do?`
    expect(sweAgentAdapter.detectReady(pane)).toBe('ready')
  })

  it('detects ready state (v2)', () => {
    const pane = `Submit message: Esc, then Enter | Navigate history: Arrow Up/Down`
    expect(sweAgentAdapter.detectReady(pane)).toBe('ready')
  })

  it('detects loading state', () => {
    const pane = 'Building agent config...'
    expect(sweAgentAdapter.detectReady(pane)).toBe('loading')
  })

  it('returns idle when prompt is visible', () => {
    const pane = 'What do you want to do?'
    expect(sweAgentAdapter.detectStatus(pane)).toBe('idle')
  })

  it('has Escape+Enter submit keys', () => {
    expect(sweAgentAdapter.submitKeys).toEqual(['Escape', 'Enter'])
  })

  it('has empty instruction file (uses prompt injection)', () => {
    expect(sweAgentAdapter.instructionFile).toBe('')
  })
})
