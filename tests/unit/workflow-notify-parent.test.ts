import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { execSync } from 'child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('workflow parent notify uses delivery', () => {
  let home = ''
  let repoDir = ''
  let prevHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'flt-workflow-notify-'))
    repoDir = mkdtempSync(join(tmpdir(), 'flt-workflow-notify-repo-'))
    prevHome = process.env.HOME
    process.env.HOME = home

    mkdirSync(join(home, '.flt'), { recursive: true })
    writeFileSync(join(home, '.flt', 'presets.json'), JSON.stringify({
      default: { cli: 'pi', model: 'gpt-5' },
      'pi-coder': { cli: 'pi', model: 'gpt-5' },
    }))

    execSync('git init', { cwd: repoDir, stdio: 'ignore' })
    mkdirSync(join(home, '.flt', 'workflows'), { recursive: true })
    writeFileSync(join(home, '.flt', 'workflows', 'wf-notify.yaml'), `
name: wf-notify
steps:
  - id: coder
    preset: pi-coder
    task: do it
`)
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    rmSync(home, { recursive: true, force: true })
    rmSync(repoDir, { recursive: true, force: true })
  })

  it('notifies non-human parent via deliver + deliverKeys', async () => {
    const stateMod = await import('../../src/state')
    const tmux = await import('../../src/tmux')
    const reg = await import('../../src/adapters/registry')
    const delivery = await import('../../src/delivery')
    const engine = await import('../../src/workflow/engine')
    const results = await import('../../src/workflow/results')

    const deliverSpy = spyOn(delivery, 'deliver').mockImplementation(() => {})
    const deliverKeysSpy = spyOn(delivery, 'deliverKeys').mockImplementation(() => {})

    engine._setSpawnFnForTest(async args => {
      const state = stateMod.loadState()
      state.agents[args.name] = {
        cli: 'pi',
        model: 'gpt-5',
        tmuxSession: `flt-${args.name}`,
        parentName: args.parent ?? 'human',
        dir: args.dir ?? repoDir,
        spawnedAt: new Date().toISOString(),
      }
      stateMod.saveState(state)
    })

    const hasSessionSpy = spyOn(tmux, 'hasSession').mockReturnValue(true)
    const resolveSpy = spyOn(reg, 'resolveAdapter').mockReturnValue({
      name: 'pi',
      cliCommand: 'pi',
      instructionFile: 'AGENTS.md',
      submitKeys: ['Enter'],
      spawnArgs: () => [],
      detectReady: () => 'ready',
      handleDialog: () => null,
      detectStatus: () => 'unknown',
    })

    const state = stateMod.loadState()
    state.agents['parent-agent'] = {
      cli: 'pi',
      model: 'gpt-5',
      tmuxSession: 'flt-parent-agent',
      parentName: 'human',
      dir: repoDir,
      spawnedAt: new Date().toISOString(),
    }
    stateMod.saveState(state)

    const run = await engine.startWorkflow('wf-notify', { dir: repoDir, parent: 'parent-agent' })
    results.writeResult(run.runDir!, 'coder', '_', 'pass')
    await engine.advanceWorkflow(run.id)

    expect(deliverSpy).toHaveBeenCalledWith(expect.objectContaining({ tmuxSession: 'flt-parent-agent' }), expect.stringContaining('[WORKFLOW]: Workflow "wf-notify" completed.'))
    expect(deliverKeysSpy).toHaveBeenCalledWith(expect.objectContaining({ tmuxSession: 'flt-parent-agent' }), ['Enter'])

    deliverSpy.mockRestore()
    deliverKeysSpy.mockRestore()
    hasSessionSpy.mockRestore()
    resolveSpy.mockRestore()
    engine._setSpawnFnForTest(null)
  })
})
