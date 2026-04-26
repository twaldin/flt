import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { formatDuration, getWorkflowHistory, listWorkflows } from '../../src/metrics-workflows'
import type { WorkflowRun } from '../../src/workflow/types'

function writeRun(home: string, run: WorkflowRun): void {
  const runDir = join(home, '.flt', 'runs', run.id)
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(runDir, 'run.json'), JSON.stringify(run, null, 2))
}

describe('metrics-workflows', () => {
  let home = ''
  let previousHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'flt-metrics-workflows-'))
    previousHome = process.env.HOME
    process.env.HOME = home
  })

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  })

  it('listWorkflows(all) returns runs sorted newest-first', () => {
    writeRun(home, {
      id: 'old',
      workflow: 'idea-to-pr',
      currentStep: 'spec',
      status: 'running',
      parentName: 'tim',
      history: [],
      retries: {},
      vars: { _input: { task: '', dir: home } },
      startedAt: '2026-04-26T10:00:00.000Z',
      runDir: join(home, '.flt', 'runs', 'old'),
    })
    writeRun(home, {
      id: 'new',
      workflow: 'idea-to-pr',
      currentStep: 'coder',
      status: 'completed',
      parentName: 'tim',
      history: [],
      retries: {},
      vars: { _input: { task: '', dir: home } },
      startedAt: '2026-04-26T11:00:00.000Z',
      runDir: join(home, '.flt', 'runs', 'new'),
    })

    expect(listWorkflows('all').map(r => r.id)).toEqual(['new', 'old'])
  })

  it('applies running/completed/failed filters', () => {
    const base = {
      workflow: 'idea-to-pr',
      currentStep: 'coder',
      parentName: 'tim',
      history: [],
      retries: {},
      vars: { _input: { task: '', dir: home } },
      startedAt: '2026-04-26T11:00:00.000Z',
    }

    writeRun(home, { ...base, id: 'run', status: 'running', runDir: join(home, '.flt', 'runs', 'run') })
    writeRun(home, { ...base, id: 'done', status: 'completed', runDir: join(home, '.flt', 'runs', 'done') })
    writeRun(home, { ...base, id: 'fail', status: 'failed', runDir: join(home, '.flt', 'runs', 'fail') })
    writeRun(home, { ...base, id: 'cancel', status: 'cancelled', runDir: join(home, '.flt', 'runs', 'cancel') })

    expect(listWorkflows('running').map(r => r.id)).toEqual(['run'])
    expect(listWorkflows('completed').map(r => r.id)).toEqual(['done'])
    expect(listWorkflows('failed').map(r => r.id).sort()).toEqual(['cancel', 'fail'])
  })

  it('getWorkflowHistory maps steps and computes durations', () => {
    writeRun(home, {
      id: 'hist',
      workflow: 'idea-to-pr',
      currentStep: 'coder',
      status: 'running',
      parentName: 'tim',
      history: [
        { step: 'spec', result: 'completed', at: '2026-04-26T10:00:45.000Z', agent: 'spec-agent' },
        { step: 'coder', result: 'failed', at: '2026-04-26T10:01:15.000Z', agent: 'coder-agent' },
      ],
      retries: {},
      vars: { _input: { task: '', dir: home } },
      startedAt: '2026-04-26T10:00:00.000Z',
      runDir: join(home, '.flt', 'runs', 'hist'),
    })

    const history = getWorkflowHistory('hist')
    expect(history).toHaveLength(2)
    expect(history[0]).toMatchObject({ name: 'spec', status: 'completed', duration: '45s' })
    expect(history[1]).toMatchObject({ name: 'coder', status: 'failed', duration: '30s' })
  })

  it('formatDuration formats ranges', () => {
    expect(formatDuration(250)).toBe('<1s')
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(92_000)).toBe('1m 32s')
    expect(formatDuration(180_000)).toBe('3m')
    expect(formatDuration(7_200_000 + 14 * 60_000)).toBe('2h 14m')
  })

  it('returns empty lists when runs dir does not exist or id is missing', () => {
    expect(listWorkflows('all')).toEqual([])
    expect(getWorkflowHistory('missing')).toEqual([])
  })
})
