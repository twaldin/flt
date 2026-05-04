import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('poller uses delivery for dialog auto-approve', () => {
  let home = ''
  let prevHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'flt-poller-deliver-'))
    prevHome = process.env.HOME
    process.env.HOME = home
    mkdirSync(join(home, '.flt'), { recursive: true })
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  })

  it('calls deliverKeys with the agent and dialog keys', async () => {
    const { loadState, saveState } = await import('../../src/state')
    const tmux = await import('../../src/tmux')
    const delivery = await import('../../src/delivery')
    const registry = await import('../../src/adapters/registry')

    const deliverSpy = spyOn(delivery, 'deliverKeys').mockImplementation(() => {})
    const getSpy = spyOn(registry, 'getAdapter').mockReturnValue({
      name: 'test-adapter',
      cliCommand: 'test',
      instructionFile: 'AGENTS.md',
      submitKeys: ['Enter'],
      spawnArgs: () => [],
      detectReady: () => 'ready',
      handleDialog: () => ['Enter', 'Enter'],
      detectStatus: () => 'dialog',
    })
    const resolveSpy = spyOn(registry, 'resolveAdapter').mockReturnValue({
      name: 'test-adapter',
      cliCommand: 'test',
      instructionFile: 'AGENTS.md',
      submitKeys: ['Enter'],
      spawnArgs: () => [],
      detectReady: () => 'ready',
      handleDialog: () => ['Enter', 'Enter'],
      detectStatus: () => 'dialog',
    })

    const listSpy = spyOn(tmux, 'listSessions').mockReturnValue(['flt-a1'])
    const paneSpy = spyOn(tmux, 'capturePane').mockReturnValue('dialog')

    const state = loadState()
    state.agents['a1'] = {
      cli: 'codex',
      model: 'gpt-5',
      tmuxSession: 'flt-a1',
      parentName: 'human',
      dir: home,
      spawnedAt: new Date().toISOString(),
      status: 'running',
    }
    saveState(state)

    const { pollOnce } = await import('../../src/controller/poller')
    pollOnce()

    expect(deliverSpy).toHaveBeenCalledTimes(2)
    expect(deliverSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({ tmuxSession: 'flt-a1' }), ['Enter'])
    expect(deliverSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({ tmuxSession: 'flt-a1' }), ['Enter'])

    deliverSpy.mockRestore()
    getSpy.mockRestore()
    resolveSpy.mockRestore()
    listSpy.mockRestore()
    paneSpy.mockRestore()
  })
})
