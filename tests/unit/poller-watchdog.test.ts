import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let tempDir: string
let origHome: string | undefined

describe('poller watchdog — dead agent detection', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'flt-test-watchdog-'))
    origHome = process.env.HOME
    process.env.HOME = tempDir
  })

  afterEach(() => {
    process.env.HOME = origHome
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('cleans up dead agent after 2s grace when tmux session is gone', async () => {
    const { saveState, loadState, removeAgent } = await import('../../src/state')
    const state = loadState()
    state.agents['dead-agent'] = {
      cli: 'claude-code',
      model: 'sonnet',
      tmuxSession: 'flt-dead-agent',
      parentName: 'human',
      dir: '/tmp/proj',
      spawnedAt: new Date().toISOString(),
      status: 'running',
    }
    saveState(state)

    const tmux = await import('../../src/tmux')
    const listSpy = spyOn(tmux, 'listSessions').mockReturnValue([])
    const captureSpy = spyOn(tmux, 'capturePane').mockReturnValue('')

    const init = await import('../../src/commands/init')
    const inboxSpy = spyOn(init, 'appendInbox').mockImplementation(() => {})

    const kill = await import('../../src/commands/kill')
    const killSpy = spyOn(kill, 'killDirect').mockImplementation((args: { name: string }) => {
      removeAgent(args.name)
    })

    const dateSpy = spyOn(Date, 'now')
    const t0 = Date.now()
    dateSpy.mockReturnValue(t0)

    const { pollOnce } = await import('../../src/controller/poller')
    pollOnce()

    dateSpy.mockReturnValue(t0 + 1000)
    pollOnce()
    expect(killSpy).not.toHaveBeenCalled()

    dateSpy.mockReturnValue(t0 + 2500)
    pollOnce()

    expect(killSpy).toHaveBeenCalledWith({ name: 'dead-agent', fromWorkflow: true })
    expect(loadState().agents['dead-agent']).toBeUndefined()
    expect(inboxSpy).toHaveBeenCalledWith('WATCHDOG', 'Agent dead-agent died (session gone); cleaning up')

    dateSpy.mockRestore()
    killSpy.mockRestore()
    listSpy.mockRestore()
    captureSpy.mockRestore()
    inboxSpy.mockRestore()
  })

  it('does not kill live agent based on pane command mismatch', async () => {
    const { saveState, loadState, removeAgent } = await import('../../src/state')
    const state = loadState()
    state.agents['repurposed-agent'] = {
      cli: 'codex',
      model: 'gpt-5.3-codex',
      tmuxSession: 'flt-repurposed-agent',
      parentName: 'human',
      dir: '/tmp/proj',
      spawnedAt: new Date().toISOString(),
      status: 'running',
    }
    saveState(state)

    const tmux = await import('../../src/tmux')
    const listSpy = spyOn(tmux, 'listSessions').mockReturnValue(['flt-repurposed-agent'])
    const captureSpy = spyOn(tmux, 'capturePane').mockReturnValue('still running')

    const init = await import('../../src/commands/init')
    const inboxSpy = spyOn(init, 'appendInbox').mockImplementation(() => {})

    const kill = await import('../../src/commands/kill')
    const killSpy = spyOn(kill, 'killDirect').mockImplementation((args: { name: string }) => {
      removeAgent(args.name)
    })

    const dateSpy = spyOn(Date, 'now')
    const t0 = Date.now()
    dateSpy.mockReturnValue(t0)

    const { pollOnce } = await import('../../src/controller/poller')
    pollOnce()

    dateSpy.mockReturnValue(t0 + 2500)
    pollOnce()

    expect(killSpy).not.toHaveBeenCalled()
    expect(loadState().agents['repurposed-agent']).toBeDefined()

    dateSpy.mockRestore()
    killSpy.mockRestore()
    listSpy.mockRestore()
    captureSpy.mockRestore()
    inboxSpy.mockRestore()
  })
})

describe('poller watchdog — stuck agent detection', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'flt-test-stuck-'))
    origHome = process.env.HOME
    process.env.HOME = tempDir
  })

  afterEach(() => {
    process.env.HOME = origHome
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('logs warning after agent runs continuously for 30+ minutes', async () => {
    const { saveState, loadState } = await import('../../src/state')
    const state = loadState()
    state.agents['long-runner'] = {
      cli: 'claude-code',
      model: 'sonnet',
      tmuxSession: 'flt-long-runner',
      parentName: 'human',
      dir: '/tmp/proj',
      spawnedAt: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
      status: 'running',
    }
    saveState(state)

    const tmux = await import('../../src/tmux')
    const listSpy = spyOn(tmux, 'listSessions').mockReturnValue(['flt-long-runner'])
    let iconToggle = false
    const captureSpy = spyOn(tmux, 'capturePane').mockImplementation(() => {
      iconToggle = !iconToggle
      return iconToggle ? '· working...' : '✢ working...'
    })

    const init = await import('../../src/commands/init')
    const inboxSpy = spyOn(init, 'appendInbox').mockImplementation(() => {})

    const { pollOnce, cleanupAgent } = await import('../../src/controller/poller')

    const t0 = Date.now()
    const dateSpy = spyOn(Date, 'now').mockReturnValue(t0)
    pollOnce()
    expect(inboxSpy).not.toHaveBeenCalledWith('WATCHDOG', expect.stringContaining('stuck'))

    dateSpy.mockReturnValue(t0 + 31 * 60 * 1000)
    pollOnce()

    expect(inboxSpy).toHaveBeenCalledWith('WATCHDOG', 'Agent long-runner has been running for 30+ minutes — may be stuck')

    inboxSpy.mockClear()
    dateSpy.mockReturnValue(t0 + 32 * 60 * 1000)
    pollOnce()
    expect(inboxSpy).not.toHaveBeenCalledWith('WATCHDOG', expect.stringContaining('stuck'))

    cleanupAgent('long-runner')
    dateSpy.mockRestore()
    listSpy.mockRestore()
    captureSpy.mockRestore()
    inboxSpy.mockRestore()
  })

  it('resets stuck timer when agent goes idle', async () => {
    const { saveState, loadState } = await import('../../src/state')
    const state = loadState()
    state.agents['reset-agent'] = {
      cli: 'claude-code',
      model: 'sonnet',
      tmuxSession: 'flt-reset-agent',
      parentName: 'human',
      dir: '/tmp/proj',
      spawnedAt: new Date().toISOString(),
      status: 'running',
    }
    saveState(state)

    const tmux = await import('../../src/tmux')
    const listSpy = spyOn(tmux, 'listSessions').mockReturnValue(['flt-reset-agent'])
    const captureSpy = spyOn(tmux, 'capturePane').mockReturnValue('done\n>')

    const init = await import('../../src/commands/init')
    const inboxSpy = spyOn(init, 'appendInbox').mockImplementation(() => {})

    const { pollOnce, cleanupAgent } = await import('../../src/controller/poller')

    const t0 = Date.now()
    const dateSpy = spyOn(Date, 'now').mockReturnValue(t0 + 35 * 60 * 1000)
    pollOnce()

    expect(inboxSpy).not.toHaveBeenCalledWith('WATCHDOG', expect.stringContaining('stuck'))

    cleanupAgent('reset-agent')
    dateSpy.mockRestore()
    listSpy.mockRestore()
    captureSpy.mockRestore()
    inboxSpy.mockRestore()
  })
})
