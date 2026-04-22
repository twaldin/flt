import { describe, it, expect } from 'bun:test'
import { piAdapter } from '../../../src/adapters/pi'

describe('pi adapter', () => {
  it('generates spawn args with provider and model', () => {
    const args = piAdapter.spawnArgs({ model: 'gpt-5.4', dir: '/tmp' })
    expect(args[0]).toBe('bash')
    expect(args[1]).toBe('-lc')
    expect(args[2]).toContain('nvm use 20')
    expect(args[2]).toContain('pi --provider openai')
    expect(args[2]).toContain("--model 'gpt-5.4'")
  })

  it('generates spawn args without model', () => {
    const args = piAdapter.spawnArgs({ dir: '/tmp' })
    expect(args[0]).toBe('bash')
    expect(args[1]).toBe('-lc')
    expect(args[2]).toContain('pi --provider openai')
    expect(args[2]).not.toContain('--model')
  })

  it('detects ready when slash command help is visible', () => {
    const pane = 'model: gpt-5\n/provider openai\n/login\n'
    expect(piAdapter.detectReady(pane)).toBe('ready')
  })

  it('detects loading when no prompt markers appear', () => {
    expect(piAdapter.detectReady('starting up...')).toBe('loading')
  })

  it('reports running for spinner output', () => {
    expect(piAdapter.detectStatus('⠋ Thinking about it')).toBe('running')
  })

  it('reports idle for command prompt', () => {
    expect(piAdapter.detectStatus('/login')).toBe('idle')
  })
})
