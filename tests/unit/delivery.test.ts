import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test'

const mockSendLiteral = mock((_session: string, _text: string) => {})
const mockPasteBuffer = mock((_session: string, _text: string) => {})
const mockSendKeys = mock((_session: string, _keys: string[]) => {})
const mockSshExec = mock((_remote: { host: string }, _command: string, _opts?: { input?: string }) => ({ stdout: '', stderr: '', status: 0 }))
const mockResolveRemote = mock((aliasOrHost: string) => ({ host: aliasOrHost }))

mock.module('../../src/tmux', () => ({
  sendLiteral: mockSendLiteral,
  pasteBuffer: mockPasteBuffer,
  sendKeys: mockSendKeys,
}))

mock.module('../../src/ssh', () => ({
  sshExec: mockSshExec,
  shellEscapeSingle: (s: string) => `'${s}'`,
}))

mock.module('../../src/remotes', () => ({
  resolveRemote: mockResolveRemote,
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
    mockSshExec.mockClear()
    mockResolveRemote.mockClear()
    mockResolveRemote.mockImplementation((aliasOrHost: string) => ({ host: aliasOrHost }))
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

  it('treats explicit local location the same as unset', () => {
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

  it('sends short ssh text via tmux send-keys -l', () => {
    deliver({ ...baseAgent, location: { type: 'ssh', host: 'h' } }, 'hello')

    expect(mockSshExec).toHaveBeenCalledTimes(1)
    expect(mockSshExec).toHaveBeenCalledWith(
      { host: 'h' },
      "tmux send-keys -t 'agent-1':^ -l 'hello'",
    )
  })

  it('sends long ssh text via paste-buffer', () => {
    const longText = 'x'.repeat(201)

    deliver({ ...baseAgent, location: { type: 'ssh', host: 'h' } }, longText)

    expect(mockSshExec).toHaveBeenCalledTimes(1)
    const [remote, command, opts] = mockSshExec.mock.calls[0] as [{ host: string }, string, { input?: string } | undefined]
    expect(remote).toEqual({ host: 'h' })
    expect(command).toContain('cat > /tmp/flt-paste-')
    expect(command).toContain('tmux load-buffer -b')
    expect(command).toContain("tmux paste-buffer -b")
    expect(command).toContain("-t 'agent-1':^ -d")
    expect(command).toContain('rm /tmp/flt-paste-')
    expect(opts).toBeDefined()
    expect(opts?.input).toBe(longText)
  })

  it('deliverKeys ssh runs one ssh per key', () => {
    const sshAgent = { ...baseAgent, location: { type: 'ssh', host: 'h' } as const }

    deliverKeys(sshAgent, ['Enter'])
    expect(mockSshExec).toHaveBeenCalledTimes(1)

    deliverKeys(sshAgent, ['C-c', 'Enter'])
    expect(mockSshExec).toHaveBeenCalledTimes(3)
  })

  it('resolves alias before delivering', () => {
    mockResolveRemote.mockImplementation((aliasOrHost: string) => ({ host: `${aliasOrHost}.resolved`, user: 'me', port: 2222 }))

    deliver({ ...baseAgent, location: { type: 'ssh', host: 'devbox' } }, 'hello')

    expect(mockResolveRemote).toHaveBeenCalledTimes(1)
    expect(mockResolveRemote).toHaveBeenCalledWith('devbox')
    expect(mockSshExec).toHaveBeenCalledTimes(1)
    expect((mockSshExec.mock.calls[0] as [{ host: string }])[0]).toEqual({ host: 'devbox.resolved', user: 'me', port: 2222 })
  })

  it('throws when ssh delivery fails', () => {
    mockSshExec.mockImplementation(() => ({ stdout: '', stderr: 'boom', status: 255 }))

    expect(() => deliver({ ...baseAgent, location: { type: 'ssh', host: 'h' } }, 'hello')).toThrow(/SSH delivery failed/)
  })

  it('rejects unsafe ssh host targets', () => {
    mockResolveRemote.mockImplementation(() => ({ host: '-oProxyCommand=evil' }))

    expect(() => deliver({ ...baseAgent, location: { type: 'ssh', host: 'bad' } }, 'hello')).toThrow(/unsafe ssh host/)
    expect(mockSshExec).toHaveBeenCalledTimes(0)
  })

  it('throws for sandbox branch', () => {
    expect(() => deliver({ ...baseAgent, location: { type: 'sandbox', runtime: 'docker', container: 'c' } }, 'hello')).toThrow(/not yet implemented/)
    expect(() => deliver({ ...baseAgent, location: { type: 'sandbox', runtime: 'docker', container: 'c' } }, 'hello')).toThrow(/docs\/ssh-sandbox-design\.md/)
  })

  it('throws for ssh+sandbox branch', () => {
    expect(() => deliver({ ...baseAgent, location: { type: 'ssh+sandbox', host: 'h', runtime: 'docker', container: 'c' } }, 'hello')).toThrow(/not yet implemented/)
    expect(() => deliver({ ...baseAgent, location: { type: 'ssh+sandbox', host: 'h', runtime: 'docker', container: 'c' } }, 'hello')).toThrow(/docs\/ssh-sandbox-design\.md/)
  })

  it('deliverKeys throws for sandbox and ssh+sandbox branches', () => {
    expect(() => deliverKeys({ ...baseAgent, location: { type: 'sandbox', runtime: 'docker', container: 'c' } }, ['Enter'])).toThrow(/not yet implemented/)
    expect(() => deliverKeys({ ...baseAgent, location: { type: 'ssh+sandbox', host: 'h', runtime: 'docker', container: 'c' } }, ['Enter'])).toThrow(/not yet implemented/)
  })

  afterAll(() => {
    mock.restore()
  })
})
