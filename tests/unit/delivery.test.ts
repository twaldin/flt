import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test'

const mockSendLiteral = mock((_session: string, _text: string) => {})
const mockPasteBuffer = mock((_session: string, _text: string) => {})
const mockSendKeys = mock((_session: string, _keys: string[]) => {})

mock.module('../../src/tmux', () => ({
  sendLiteral: mockSendLiteral,
  pasteBuffer: mockPasteBuffer,
  sendKeys: mockSendKeys,
}))

import { deliver, deliverKeys } from '../../src/delivery'
import type { AgentState } from '../../src/state'

describe('delivery', () => {
  const baseAgent: AgentState = {
    cli: 'claude-code',
    model: 'sonnet',
    tmuxSession: 'agent-1',
    parentName: 'orch',
    dir: '/tmp',
    spawnedAt: new Date().toISOString(),
  }

  beforeEach(() => {
    mockSendLiteral.mockClear()
    mockPasteBuffer.mockClear()
    mockSendKeys.mockClear()
  })

  it('uses sendLiteral for local short text when location is unset', () => {
    deliver(baseAgent, 'hello')
    expect(mockSendLiteral).toHaveBeenCalledTimes(1)
    expect(mockSendLiteral).toHaveBeenCalledWith('agent-1', 'hello')
    expect(mockPasteBuffer).toHaveBeenCalledTimes(0)
  })

  it('uses pasteBuffer for local long text', () => {
    const longText = 'x'.repeat(201)
    deliver(baseAgent, longText)
    expect(mockPasteBuffer).toHaveBeenCalledTimes(1)
    expect(mockPasteBuffer).toHaveBeenCalledWith('agent-1', longText)
    expect(mockSendLiteral).toHaveBeenCalledTimes(0)
  })

  it("treats explicit local location the same as unset", () => {
    deliver({ ...baseAgent, location: { type: 'local' } }, 'hello')
    expect(mockSendLiteral).toHaveBeenCalledTimes(1)
    expect(mockSendLiteral).toHaveBeenCalledWith('agent-1', 'hello')
    expect(mockPasteBuffer).toHaveBeenCalledTimes(0)
  })

  it('deliverKeys local passes keys through verbatim', () => {
    const keys = ['C-c', 'Enter']
    deliverKeys(baseAgent, keys)
    expect(mockSendKeys).toHaveBeenCalledTimes(1)
    expect(mockSendKeys).toHaveBeenCalledWith('agent-1', keys)
  })

  it('throws for ssh branch', () => {
    expect(() => deliver({ ...baseAgent, location: { type: 'ssh', host: 'h' } }, 'hello')).toThrow(/not yet implemented/)
    expect(() => deliver({ ...baseAgent, location: { type: 'ssh', host: 'h' } }, 'hello')).toThrow(/docs\/ssh-sandbox-design\.md/)
  })

  it('throws for sandbox branch', () => {
    expect(() => deliver({ ...baseAgent, location: { type: 'sandbox', runtime: 'docker', container: 'c' } }, 'hello')).toThrow(/not yet implemented/)
    expect(() => deliver({ ...baseAgent, location: { type: 'sandbox', runtime: 'docker', container: 'c' } }, 'hello')).toThrow(/docs\/ssh-sandbox-design\.md/)
  })

  it('throws for ssh+sandbox branch', () => {
    expect(() => deliver({ ...baseAgent, location: { type: 'ssh+sandbox', host: 'h', runtime: 'docker', container: 'c' } }, 'hello')).toThrow(/not yet implemented/)
    expect(() => deliver({ ...baseAgent, location: { type: 'ssh+sandbox', host: 'h', runtime: 'docker', container: 'c' } }, 'hello')).toThrow(/docs\/ssh-sandbox-design\.md/)
  })

  it('deliverKeys throws for non-local branches', () => {
    expect(() => deliverKeys({ ...baseAgent, location: { type: 'ssh', host: 'h' } }, ['Enter'])).toThrow(/not yet implemented/)
    expect(() => deliverKeys({ ...baseAgent, location: { type: 'sandbox', runtime: 'docker', container: 'c' } }, ['Enter'])).toThrow(/not yet implemented/)
    expect(() => deliverKeys({ ...baseAgent, location: { type: 'ssh+sandbox', host: 'h', runtime: 'docker', container: 'c' } }, ['Enter'])).toThrow(/not yet implemented/)
    expect(() => deliverKeys({ ...baseAgent, location: { type: 'ssh', host: 'h' } }, ['Enter'])).toThrow(/docs\/ssh-sandbox-design\.md/)
  })

  afterAll(() => { mock.restore() })
})
