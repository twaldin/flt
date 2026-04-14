import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// We test watchdog behaviour by mocking tmux and inbox, then calling pollOnce directly.

let tempDir: string
let origHome: string | undefined

// Module-level mocks must be established before importing the module under test.
// We use dynamic imports inside each test group so mocks are in place.

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

  it('marks agent as exited when tmux session is gone', async () => {
    // Seed state with one agent
    const { saveState, loadState } = await import('../../src/state')
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

    // Mock tmux to report no live sessions
    const tmux = await import('../../src/tmux')
    const listSpy = spyOn(tmux, 'listSessions').mockReturnValue([])
    const captureSpy = spyOn(tmux, 'capturePane').mockReturnValue('')

    // Mock appendInbox so we can assert it was called
    const init = await import('../../src/commands/init')
    const inboxSpy = spyOn(init, 'appendInbox').mockImplementation(() => {})

    const { pollOnce } = await import('../../src/controller/poller')
    pollOnce()

    const updated = loadState()
    expect(updated.agents['dead-agent'].status).toBe('exited')

    // Inbox should have been notified
    expect(inboxSpy).toHaveBeenCalledWith('WATCHDOG', 'Agent dead-agent died (session gone)')

    listSpy.mockRestore()
    captureSpy.mockRestore()
    inboxSpy.mockRestore()
  })

  it('does not re-notify for an already-exited agent', async () => {
    const { saveState, loadState } = await import('../../src/state')
    const state = loadState()
    state.agents['already-exited'] = {
      cli: 'claude-code',
      model: 'sonnet',
      tmuxSession: 'flt-already-exited',
      parentName: 'human',
      dir: '/tmp/proj',
      spawnedAt: new Date().toISOString(),
      status: 'exited',
    }
    saveState(state)

    const tmux = await import('../../src/tmux')
    const listSpy = spyOn(tmux, 'listSessions').mockReturnValue([])
    const captureSpy = spyOn(tmux, 'capturePane').mockReturnValue('')

    const init = await import('../../src/commands/init')
    const inboxSpy = spyOn(init, 'appendInbox').mockImplementation(() => {})

    const { pollOnce } = await import('../../src/controller/poller')
    pollOnce()

    expect(inboxSpy).not.toHaveBeenCalledWith('WATCHDOG', expect.stringContaining('died'))

    listSpy.mockRestore()
    captureSpy.mockRestore()
    inboxSpy.mockRestore()
  })

  it('does not clean up worktreePath for dead agents', async () => {
    const { saveState, loadState } = await import('../../src/state')
    const state = loadState()
    state.agents['wt-agent'] = {
      cli: 'claude-code',
      model: 'sonnet',
      tmuxSession: 'flt-wt-agent',
      parentName: 'human',
      dir: '/tmp/flt-wt-abc',
      worktreePath: '/tmp/flt-wt-abc',
      worktreeBranch: 'feat/wt-agent',
      spawnedAt: new Date().toISOString(),
      status: 'running',
    }
    saveState(state)

    const tmux = await import('../../src/tmux')
    const listSpy = spyOn(tmux, 'listSessions').mockReturnValue([])
    const captureSpy = spyOn(tmux, 'capturePane').mockReturnValue('')

    const init = await import('../../src/commands/init')
    const inboxSpy = spyOn(init, 'appendInbox').mockImplementation(() => {})

    const { pollOnce } = await import('../../src/controller/poller')
    pollOnce()

    const updated = loadState()
    expect(updated.agents['wt-agent'].status).toBe('exited')
    // Worktree fields must be preserved
    expect(updated.agents['wt-agent'].worktreePath).toBe('/tmp/flt-wt-abc')
    expect(updated.agents['wt-agent'].worktreeBranch).toBe('feat/wt-agent')

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

    // Fake a pane that shows spinner activity (different icons each poll)
    const tmux = await import('../../src/tmux')
    const listSpy = spyOn(tmux, 'listSessions').mockReturnValue(['flt-long-runner'])
    let iconToggle = false
    const captureSpy = spyOn(tmux, 'capturePane').mockImplementation(() => {
      // Alternate icons so detectAgentStatusFromPane sees 'running'
      iconToggle = !iconToggle
      return iconToggle ? '· working...' : '✢ working...'
    })

    const init = await import('../../src/commands/init')
    const inboxSpy = spyOn(init, 'appendInbox').mockImplementation(() => {})

    // We need to manipulate the internal runningSince map to simulate 30+ minutes elapsed.
    // Do this by calling pollOnce once to register the agent as running, then artificially
    // back-date the runningSince entry via the module's exported state.
    // Since runningSince is module-private, we test the externally observable behaviour:
    // call pollOnce many times with a mocked Date.now() that fast-forwards time.

    const { pollOnce, cleanupAgent } = await import('../../src/controller/poller')

    // First poll: registers runningSince
    const t0 = Date.now()
    const dateSpy = spyOn(Date, 'now').mockReturnValue(t0)
    pollOnce()
    expect(inboxSpy).not.toHaveBeenCalledWith('WATCHDOG', expect.stringContaining('stuck'))

    // Fast-forward 31 minutes
    dateSpy.mockReturnValue(t0 + 31 * 60 * 1000)
    pollOnce()

    expect(inboxSpy).toHaveBeenCalledWith('WATCHDOG', 'Agent long-runner has been running for 30+ minutes — may be stuck')

    // Third poll: warning should NOT repeat
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
    // Return idle pane (no spinner icon)
    const captureSpy = spyOn(tmux, 'capturePane').mockReturnValue('done\n>')

    const init = await import('../../src/commands/init')
    const inboxSpy = spyOn(init, 'appendInbox').mockImplementation(() => {})

    const { pollOnce, cleanupAgent } = await import('../../src/controller/poller')

    const t0 = Date.now()
    const dateSpy = spyOn(Date, 'now').mockReturnValue(t0 + 35 * 60 * 1000)
    pollOnce()

    // Agent should be idle, not stuck-warned
    expect(inboxSpy).not.toHaveBeenCalledWith('WATCHDOG', expect.stringContaining('stuck'))

    cleanupAgent('reset-agent')
    dateSpy.mockRestore()
    listSpy.mockRestore()
    captureSpy.mockRestore()
    inboxSpy.mockRestore()
  })
})
