import { describe, it, expect, mock, beforeEach, afterEach, afterAll } from 'bun:test'

const mockLoadState = mock(() => ({
  orchestrator: { initAt: new Date().toISOString(), tmuxSession: 'flt-orch', tmuxWindow: 'main', type: 'human' as const },
  agents: {},
  config: { maxDepth: 3 },
}))

const mockHasSession = mock(() => true)

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

  afterEach(() => {
    console.log = originalLog
  })

  async function loadList() {
    const mod = await import('../../src/commands/list')
    mod._depsForTest.loadState = mockLoadState
    mod._depsForTest.tmux = { hasSession: mockHasSession } as unknown as typeof mod._depsForTest.tmux
    return mod.list
  }

  it('renders ssh host label for ssh agents', async () => {
    mockLoadState.mockReturnValue({
      orchestrator: { initAt: new Date().toISOString(), tmuxSession: 'flt-orch', tmuxWindow: 'main', type: 'human' as const },
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

    const list = await loadList()
    list()

    expect(logs.some((line) => line.includes('worker (ssh: prod-vps)'))).toBe(true)
  })

  afterAll(() => {
    console.log = originalLog
    mock.restore()
  })
})
