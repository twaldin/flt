import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

mock.module('@twaldin/harness-ts', () => ({
  projectInstructions: mock(() => ({})),
  restoreProjectedInstructions: mock(() => {}),
  getAdapter: mock((_name: string) => ({
    instructionsFilename: 'AGENTS.md',
    submitKeys: ['Enter'],
    detectReady: (_pane: string) => 'ready',
    handleDialog: (_pane: string) => null,
    detectStatus: (_pane: string) => 'idle',
  })),
}))

const mockSetAgent = mock((_name: string, _state: unknown) => {})
const mockHasAgent = mock((_name: string) => false)
const mockLoadState = mock(() => ({
  agents: {},
  config: { maxDepth: 5 },
  orchestrator: { tmuxSession: 'flt-orch', tmuxWindow: 'main', type: 'human' as const, initAt: '' },
}))

const mockDeliver = mock((_agent: unknown, _text: string) => {})
const mockDeliverKeys = mock((_agent: unknown, _keys: string[]) => {})

mock.module('../../src/state', () => ({
  loadState: mockLoadState,
  setAgent: mockSetAgent,
  hasAgent: mockHasAgent,
}))

mock.module('../../src/worktree', () => ({
  isGitRepo: mock(() => true),
  createWorktree: mock((_baseDir: string, name: string) => ({
    path: `/tmp/wt-${name}`,
    branch: `flt/${name}`,
  })),
}))

mock.module('../../src/tmux', () => ({
  createSession: mock(() => {}),
  hasSession: mock(() => true),
  capturePane: mock(() => 'Claude Code\n> '),
  sendKeys: mock(() => {}),
  pasteBuffer: mock(() => {}),
  sendLiteral: mock(() => {}),
  resizeWindow: mock(() => {}),
}))

mock.module('../../src/instructions', () => ({
  projectInstructions: mock(() => {}),
}))

mock.module('../../src/skills', () => ({
  projectSkills: mock(() => {}),
}))

mock.module('../../src/activity', () => ({
  appendEvent: mock(() => {}),
}))

mock.module('../../src/delivery', () => ({
  deliver: mockDeliver,
  deliverKeys: mockDeliverKeys,
}))


describe('spawnDirect bootstrap delivery', () => {
  let tempDir: string
  let originalHome: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'flt-test-bootstrap-'))
    originalHome = process.env.HOME
    process.env.HOME = tempDir
    mkdirSync(join(tempDir, '.flt'), { recursive: true })
    mockSetAgent.mockClear()
    mockHasAgent.mockClear()
    mockLoadState.mockClear()
    mockDeliver.mockClear()
    mockDeliverKeys.mockClear()
  })

  afterAll(() => {
    process.env.HOME = originalHome
    rmSync(tempDir, { recursive: true, force: true })
    mock.restore()
  })

  it('routes bootstrap text and submit keys through delivery helpers', async () => {
    const { spawnDirect } = await import('../../src/commands/spawn')
    await spawnDirect({
      name: 'bootstrap-agent',
      cli: 'claude-code',
      bootstrap: 'hello bootstrap',
      dir: tempDir,
      worktree: false,
    })

    expect(mockDeliver).toHaveBeenCalledTimes(1)
    expect(mockDeliverKeys).toHaveBeenCalledTimes(1)

    const [agentArg] = mockDeliver.mock.calls[0] as [{ tmuxSession: string }, string]
    expect(agentArg.tmuxSession).toBe('flt-bootstrap-agent')

    const [, keysArg] = mockDeliverKeys.mock.calls[0] as [{ tmuxSession: string }, string[]]
    expect(keysArg).toEqual(['Enter'])
  })
})
