import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { traceExport } from '../../src/commands/trace'
import { saveWorkflowRun } from '../../src/workflow/engine'
import type { WorkflowRun } from '../../src/workflow/types'

function seedPresets(home: string): void {
  mkdirSync(join(home, '.flt'), { recursive: true })
  writeFileSync(
    join(home, '.flt', 'presets.json'),
    JSON.stringify({
      cc: { cli: 'claude-code', model: 'sonnet' },
      q: { cli: 'qwen', model: 'qwen-max' },
    }),
  )
}

function writeWorkflow(home: string, name: string, yaml: string): void {
  const workflowsDir = join(home, '.flt', 'workflows')
  mkdirSync(workflowsDir, { recursive: true })
  writeFileSync(join(workflowsDir, `${name}.yaml`), yaml)
}

function saveRun(home: string, id: string, workflow: string, stepId: string, workdir: string): WorkflowRun {
  const run: WorkflowRun = {
    id,
    workflow,
    currentStep: stepId,
    status: 'completed',
    parentName: 'human',
    history: [],
    retries: {},
    vars: {
      _input: { task: 'task', dir: workdir },
      [stepId]: { dir: workdir, worktree: workdir },
    },
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    runDir: join(home, '.flt', 'runs', id),
  }
  mkdirSync(join(run.runDir!, 'results'), { recursive: true })
  saveWorkflowRun(run)
  return run
}

describe('trace export', () => {
  let home = ''
  let previousHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'flt-trace-export-'))
    previousHome = process.env.HOME
    process.env.HOME = home
    seedPresets(home)
  })

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  })

  it('exports normalized transcript entries from claude-code session jsonl', () => {
    const workdir = mkdtempSync(join(tmpdir(), 'flt-trace-wd-'))
    writeWorkflow(home, 'wf-trace', `
name: wf-trace
steps:
  - id: coder
    preset: cc
    task: do it
`)
    const run = saveRun(home, 'trace-claude', 'wf-trace', 'coder', workdir)

    const encoded = realpathSync(workdir).replace(/[\/_]/g, '-')
    const sessionDir = join(home, '.claude', 'projects', encoded)
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(sessionDir, 'sess.jsonl'), [
      JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00.000Z', message: { content: 'hello' } }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { content: [{ text: 'world' }], usage: { output_tokens: 7 } },
      }),
    ].join('\n') + '\n')

    traceExport(run.id)

    const outPath = join(run.runDir!, 'transcript.jsonl')
    const lines = readFileSync(outPath, 'utf-8').trim().split('\n').map(l => JSON.parse(l))
    expect(lines.length).toBe(2)
    expect(lines[0]).toMatchObject({ agent: 'trace-claude-coder', role: 'user', content: 'hello' })
    expect(lines[1]).toMatchObject({ agent: 'trace-claude-coder', role: 'assistant', content: 'world', tokens: 7 })

    rmSync(workdir, { recursive: true, force: true })
  })

  it('falls back to tmux pane log for unparsed CLIs', () => {
    const workdir = mkdtempSync(join(tmpdir(), 'flt-trace-fallback-'))
    writeWorkflow(home, 'wf-fallback', `
name: wf-fallback
steps:
  - id: coder
    preset: q
    task: do it
`)
    const run = saveRun(home, 'trace-fallback', 'wf-fallback', 'coder', workdir)

    const agent = 'trace-fallback-coder'
    const logsDir = join(home, '.flt', 'logs')
    mkdirSync(logsDir, { recursive: true })
    writeFileSync(join(logsDir, `flt-${agent}.tmux.log`), '\u001b[32mfinal pane content\u001b[0m\n')

    traceExport(run.id)

    const outPath = join(run.runDir!, 'transcript.jsonl')
    const lines = readFileSync(outPath, 'utf-8').trim().split('\n').map(l => JSON.parse(l))
    expect(lines.length).toBe(1)
    expect(lines[0].agent).toBe(agent)
    expect(lines[0].content).toContain('final pane content')

    rmSync(workdir, { recursive: true, force: true })
  })
})
