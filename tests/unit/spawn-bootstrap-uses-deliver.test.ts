import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'


const mockSetAgent = mock((_name: string, _state: unknown) => {})
const mockHasAgent = mock((_name: string) => false)
const mockLoadState = mock(() => ({
  agents: {},
  config: { maxDepth: 5 },
  orchestrator: { tmuxSession: 'flt-orch', tmuxWindow: 'main', type: 'human' as const, initAt: '' },
}))

function makeAdapter(name: string) {
  return {
    name,
    cliCommand: name === 'claude-code' ? 'claude' : name,
    instructionFile: 'AGENTS.md',
    submitKeys: ['Enter'],
    spawnArgs: ({ model }: { model?: string }) => model ? ['claude', '--model', model] : ['claude'],
    detectReady: (_pane: string) => 'ready' as const,
    handleDialog: (_pane: string) => null,
    detectStatus: (_pane: string) => 'idle' as const,
  }
}

const mockDeliver = mock((_agent: unknown, _text: string) => {})
const mockDeliverKeys = mock((_agent: unknown, _keys: string[]) => {})

const fakeTmux = {
  createSession: mock(() => {}),
  hasSession: mock(() => true),
  capturePane: mock(() => 'Claude Code\n> '),
  sendKeys: mock(() => {}),
  pasteBuffer: mock(() => {}),
  sendLiteral: mock(() => {}),
  resizeWindow: mock(() => {}),
}


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

  async function loadSpawnDirect() {
    const mod = await import('../../src/commands/spawn')
    mod._adapterForTest.resolveAdapter = makeAdapter
    mod._depsForTest.loadState = mockLoadState
    mod._depsForTest.setAgent = mockSetAgent
    mod._depsForTest.hasAgent = mockHasAgent
    mod._depsForTest.isGitRepo = mock(() => true)
    mod._depsForTest.createWorktree = mock((_baseDir: string, name: string) => ({ path: `/tmp/wt-${name}`, branch: `flt/${name}` }))
    mod._depsForTest.projectInstructions = mock(() => undefined)
    mod._depsForTest.projectSkills = mock(() => undefined)
    mod._depsForTest.appendEvent = mock(() => undefined)
    mod._depsForTest.tmux = fakeTmux as unknown as typeof mod._depsForTest.tmux
    mod._depsForTest.deliver = mockDeliver
    mod._depsForTest.deliverKeys = mockDeliverKeys
    return mod.spawnDirect
  }

  afterAll(() => {
    process.env.HOME = originalHome
    rmSync(tempDir, { recursive: true, force: true })
    mock.restore()
  })

  it('routes bootstrap text and submit keys through delivery helpers', async () => {
    const spawnDirect = await loadSpawnDirect()
    await spawnDirect({
      name: 'bootstrap-agent',
      cli: 'claude-code',
      bootstrap: 'hello bootstrap',
      dir: tempDir,
      worktree: false,
    })

    expect(mockDeliver).toHaveBeenCalled()
    expect(mockDeliverKeys).toHaveBeenCalled()

    const bootstrapCall = mockDeliver.mock.calls.find(([, text]) => text === 'hello bootstrap') as [{ tmuxSession: string }, string] | undefined
    expect(bootstrapCall).toBeDefined()
    expect(bootstrapCall![0].tmuxSession).toBe('flt-bootstrap-agent')

    const [, keysArg] = mockDeliverKeys.mock.calls[mockDeliverKeys.mock.calls.length - 1] as [{ tmuxSession: string }, string[]]
    expect(keysArg).toEqual(['Enter'])
  })
})
