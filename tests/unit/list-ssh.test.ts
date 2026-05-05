import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test'

const mockLoadState = mock(() => ({
  orchestrator: { initAt: new Date().toISOString() },
  agents: {},
  config: { maxDepth: 3 },
}))

const mockHasSession = mock(() => true)

mock.module('../../src/state', () => ({
  loadState: mockLoadState,
}))

mock.module('../../src/tmux', () => ({
  hasSession: mockHasSession,
}))

import { list } from '../../src/commands/list'

describe('list ssh location rendering', () => {
  const originalLog = console.log
  const logs: string[] = []

  beforeEach(() => {
    logs.length = 0
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    }
    mockLoadState.mockReset()
    mockHasSession.mockReset()
  })

  it('renders ssh host label for ssh agents', () => {
    mockLoadState.mockReturnValue({
      orchestrator: { initAt: new Date().toISOString() },
      config: { maxDepth: 3 },
      agents: {
        worker: {
          cli: 'pi',
          model: 'gpt-5',
          tmuxSession: 'flt-worker',
          parentName: 'human',
          dir: '/tmp/w',
          spawnedAt: new Date().toISOString(),
          status: 'idle',
          location: { type: 'ssh', host: 'prod-vps' },
        },
      },
    })

    list()

    expect(logs.some((line) => line.includes('worker (ssh: prod-vps)'))).toBe(true)
  })

  afterAll(() => {
    console.log = originalLog
    mock.restore()
  })
})
