import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { WorkflowRun } from '../../src/workflow/types'

const mockStartWorkflow = mock(async (_workflow: string, _opts?: { task?: string; dir?: string; parent?: string; slug?: string }): Promise<WorkflowRun> => ({
  id: 'eval-run-1',
  workflow: 'idea-to-pr',
  currentStep: 'spec',
  status: 'running',
  parentName: 'human',
  history: [],
  retries: {},
  vars: { _input: { task: '', dir: '' } },
  startedAt: new Date().toISOString(),
  runDir: '/tmp/eval-run-1',
}))

mock.module('../../src/workflow/engine', () => ({
  startWorkflow: mockStartWorkflow,
}))

import { evalSuiteList, evalSuiteRun, listEvalFixtures } from '../../src/commands/eval'

function writeFixture(root: string, name: string, opts?: { source?: 'clone-cmd' | 'snapshot'; workflow?: string }): void {
  const fixturePath = join(root, name)
  mkdirSync(fixturePath, { recursive: true })
  writeFileSync(join(fixturePath, 'task.md'), `task for ${name}\n`)
  writeFileSync(join(fixturePath, 'acceptance.md'), `acceptance for ${name}\n`)

  if ((opts?.source ?? 'clone-cmd') === 'clone-cmd') {
    const script = join(fixturePath, 'repo-clone-cmd.sh')
    writeFileSync(script, '#!/bin/sh\nset -eu\necho cloned > clone-marker.txt\n')
    chmodSync(script, 0o755)
  } else {
    mkdirSync(join(fixturePath, 'repo-snapshot'), { recursive: true })
    writeFileSync(join(fixturePath, 'repo-snapshot', 'snapshot-marker.txt'), 'snapshot\n')
  }

  if (opts?.workflow) {
    writeFileSync(join(fixturePath, 'config.json'), JSON.stringify({ workflow: opts.workflow }))
  }
}

describe('eval suite', () => {
  let root = ''

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'flt-eval-suite-'))
    mockStartWorkflow.mockClear()
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('listEvalFixtures discovers fixtures and evalSuiteList prints all names', () => {
    writeFixture(root, 'bug-fix-one')
    writeFixture(root, 'small-feature-two')
    writeFixture(root, 'refactor-three', { source: 'snapshot' })

    const fixtures = listEvalFixtures({ root })
    expect(fixtures.map(f => f.name)).toEqual(['bug-fix-one', 'refactor-three', 'small-feature-two'])

    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    evalSuiteList({ root })
    const output = logSpy.mock.calls.map(call => String(call[0])).join('\n')
    logSpy.mockRestore()

    expect(output).toContain('bug-fix-one')
    expect(output).toContain('small-feature-two')
    expect(output).toContain('refactor-three')
  })

  it('listEvalFixtures honors config workflow and defaults to idea-to-pr', () => {
    writeFixture(root, 'test-addition-one', { workflow: 'custom-flow' })
    writeFixture(root, 'doc-two')

    const fixtures = listEvalFixtures({ root })
    expect(fixtures.find(f => f.name === 'test-addition-one')?.workflow).toBe('custom-flow')
    expect(fixtures.find(f => f.name === 'doc-two')?.workflow).toBe('idea-to-pr')
  })

  it('evalSuiteRun uses task.md content and temp dir for clone-cmd fixtures', async () => {
    writeFixture(root, 'bug-fix-clone')

    await evalSuiteRun('bug-fix-clone', { root, parent: 'reviewer' })

    expect(mockStartWorkflow).toHaveBeenCalledTimes(1)
    const [workflowName, runOpts] = mockStartWorkflow.mock.calls[0] as [string, { task: string; dir: string; parent: string; slug: string }]
    expect(workflowName).toBe('idea-to-pr')
    expect(runOpts.task).toBe('task for bug-fix-clone\n')
    expect(runOpts.parent).toBe('reviewer')
    expect(runOpts.slug).toBe('bug-fix-clone')

    const markerPath = join(runOpts.dir, 'clone-marker.txt')
    expect(existsSync(markerPath)).toBe(true)
  })

  it('evalSuiteRun supports snapshot fixtures and workflow override', async () => {
    writeFixture(root, 'refactor-snapshot', { source: 'snapshot', workflow: 'fixture-workflow' })

    await evalSuiteRun('refactor-snapshot', { root, workflow: 'override-flow' })

    const [workflowName, runOpts] = mockStartWorkflow.mock.calls[0] as [string, { dir: string; parent: string }]
    expect(workflowName).toBe('override-flow')
    expect(runOpts.parent).toBe('human')
    expect(existsSync(join(runOpts.dir, 'snapshot-marker.txt'))).toBe(true)
  })

  it('evalSuiteRun throws a clear error for unknown fixture names', async () => {
    await expect(evalSuiteRun('missing-fixture', { root })).rejects.toThrow('Unknown eval fixture: missing-fixture')
  })

  afterAll(() => { mock.restore() })
})
