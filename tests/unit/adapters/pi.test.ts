import { describe, it, expect } from 'bun:test'
import { piAdapter } from '../../../src/adapters/pi'

describe('pi adapter', () => {
  it('generates spawn args with model', () => {
    const args = piAdapter.spawnArgs({ model: 'openai-codex/gpt-5.4', dir: '/tmp' })
    expect(args[0]).toBe('bash')
    expect(args[1]).toBe('-lc')
    expect(args[2]).toContain('nvm use 20')
    expect(args[2]).toContain('pi --model')
    expect(args[2]).toContain("--model 'openai-codex/gpt-5.4'")
  })

  it('generates spawn args without model', () => {
    const args = piAdapter.spawnArgs({ dir: '/tmp' })
    expect(args[0]).toBe('bash')
    expect(args[1]).toBe('-lc')
    expect(args[2]).toContain('pi')
    expect(args[2]).not.toContain('--model')
  })

  it('detects ready when slash command help is visible', () => {
    const pane = 'model: gpt-5\n/provider openai\n/login\n'
    expect(piAdapter.detectReady(pane)).toBe('ready')
  })

  it('detects loading when no prompt markers appear', () => {
    expect(piAdapter.detectReady('starting up...')).toBe('loading')
  })

  it('reports running for spinner + Working marker', () => {
    expect(piAdapter.detectStatus('⠋ Working...')).toBe('running')
  })

  it('reports idle for command prompt', () => {
    expect(piAdapter.detectStatus('/login')).toBe('idle')
  })
})
