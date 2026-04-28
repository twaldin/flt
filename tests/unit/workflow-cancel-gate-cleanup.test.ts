import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  cancelWorkflow,
  saveWorkflowRun,
} from '../../src/workflow/engine'
import type { WorkflowRun } from '../../src/workflow/types'

function seedPresets(home: string): void {
  mkdirSync(join(home, '.flt'), { recursive: true })
  writeFileSync(
    join(home, '.flt', 'presets.json'),
    JSON.stringify({ default: { cli: 'pi', model: 'gpt-5' } }),
  )
}

function makeRun(home: string, id: string): WorkflowRun {
  return {
    id,
    workflow: 'wf',
    currentStep: 's1',
    status: 'running',
    parentName: 'human',
    history: [],
    retries: {},
    vars: { _input: { task: 'task', dir: home } },
    startedAt: new Date().toISOString(),
    runDir: join(home, '.flt', 'runs', id),
  }
}

describe('cancelWorkflow gate-pending cleanup', () => {
  let home = ''
  let previousHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'flt-cancel-gate-cleanup-'))
    previousHome = process.env.HOME
    process.env.HOME = home
    seedPresets(home)
  })

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = previousHome
    }
    rmSync(home, { recursive: true, force: true })
  })

  it('removes .gate-pending when cancelling a running workflow', async () => {
    const run = makeRun(home, 'cancel-gate-1')
    mkdirSync(run.runDir!, { recursive: true })
    saveWorkflowRun(run)

    const gatePendingPath = join(run.runDir!, '.gate-pending')
    writeFileSync(gatePendingPath, JSON.stringify({ step: 's1', at: new Date().toISOString() }))
    expect(existsSync(gatePendingPath)).toBe(true)

    await cancelWorkflow(run.id)

    expect(existsSync(gatePendingPath)).toBe(false)
  })

  it('does not throw when cancelling a run with no .gate-pending', async () => {
    const run = makeRun(home, 'cancel-gate-2')
    mkdirSync(run.runDir!, { recursive: true })
    saveWorkflowRun(run)

    expect(existsSync(join(run.runDir!, '.gate-pending'))).toBe(false)

    await expect(cancelWorkflow(run.id)).resolves.toBeUndefined()
  })
})
