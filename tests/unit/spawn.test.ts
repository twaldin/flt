import { afterAll, describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'


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

const mockSetAgent = mock((_name: string, _state: unknown) => {})
const mockHasAgent = mock((_name: string) => false)
const mockLoadState = mock(() => ({
  agents: {},
  config: { maxDepth: 5 },
  orchestrator: { tmuxSession: 'flt-orch', tmuxWindow: 'main', type: 'human' as const, initAt: '' },
}))

const fakeTmux = {
  createSession: mock(() => {}),
  hasSession: mock(() => true),
  // "Claude Code" + prompt satisfies claude-code adapter's detectReady check
  capturePane: mock(() => 'Claude Code\n> '),
  sendKeys: mock(() => {}),
  pasteBuffer: mock(() => {}),
  sendLiteral: mock(() => {}),
  resizeWindow: mock(() => {}),
}


describe('spawnDirect — preset auto-resolution', () => {
  let tempDir: string
  let originalHome: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'flt-test-spawn-'))
    originalHome = process.env.HOME
    process.env.HOME = tempDir
    mkdirSync(join(tempDir, '.flt'), { recursive: true })
    mockSetAgent.mockClear()
    mockHasAgent.mockClear()
    mockLoadState.mockClear()
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
    return mod.spawnDirect
  }

  afterEach(() => {
    process.env.HOME = originalHome
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('uses matching preset when spawning by name without --preset', async () => {
    writeFileSync(
      join(tempDir, '.flt', 'presets.json'),
      JSON.stringify({ cairn: { cli: 'claude-code', model: 'opus[1m]', persistent: true } }, null, 2) + '\n',
    )

    const spawnDirect = await loadSpawnDirect()
    await spawnDirect({ name: 'cairn' })

    expect(mockSetAgent).toHaveBeenCalledTimes(1)
    const [registeredName, agentState] = mockSetAgent.mock.calls[0] as [string, Record<string, unknown>]
    expect(registeredName).toBe('cairn')
    expect(agentState.model).toBe('opus[1m]')
    expect(agentState.cli).toBe('claude-code')
    expect(agentState.persistent).toBe(true)
  })

  it('uses explicit --preset over name when both match', async () => {
    writeFileSync(
      join(tempDir, '.flt', 'presets.json'),
      JSON.stringify({
        cairn: { cli: 'claude-code', model: 'opus[1m]', persistent: true },
        other: { cli: 'claude-code', model: 'sonnet' },
      }, null, 2) + '\n',
    )

    const spawnDirect = await loadSpawnDirect()
    await spawnDirect({ name: 'cairn', preset: 'other' })

    const [, agentState] = mockSetAgent.mock.calls[0] as [string, Record<string, unknown>]
    expect(agentState.model).toBe('sonnet')
  })

  it('uses default behavior when no preset matches name', async () => {
    writeFileSync(
      join(tempDir, '.flt', 'presets.json'),
      JSON.stringify({ default: { cli: 'claude-code', model: 'sonnet' } }, null, 2) + '\n',
    )

    const spawnDirect = await loadSpawnDirect()
    await spawnDirect({ name: 'worker', cli: 'claude-code', model: 'haiku' })

    const [, agentState] = mockSetAgent.mock.calls[0] as [string, Record<string, unknown>]
    expect(agentState.model).toBe('haiku')
  })

  afterAll(() => { mock.restore() })
})
