import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { saveWorkflowRun } from '../../src/workflow/engine'
import type { WorkflowRun } from '../../src/workflow/types'
import { traceExport } from '../../src/commands/trace'

function seedPresets(home: string): void {
  mkdirSync(join(home, '.flt'), { recursive: true })
  writeFileSync(join(home, '.flt', 'presets.json'), JSON.stringify({
    cc: { cli: 'claude-code', model: 'sonnet' },
    cod: { cli: 'codex', model: 'gpt-5' },
    gem: { cli: 'gemini', model: 'gemini-2.5-pro' },
    swe: { cli: 'swe-agent', model: 'gpt-5' },
    cont: { cli: 'continue-cli', model: 'gpt-5' },
  }))
}

function makeRun(home: string, id: string): WorkflowRun {
  return {
    id,
    workflow: 'wf',
    currentStep: 'x',
    status: 'running',
    parentName: 'human',
    history: [],
    retries: {},
    vars: { _input: { task: 'task', dir: home } },
    startedAt: '2026-01-01T00:00:00.000Z',
    runDir: join(home, '.flt', 'runs', id),
    parallelGroups: {},
  }
}

function readTranscript(path: string): Array<Record<string, unknown>> {
  return readFileSync(path, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as Record<string, unknown>)
}

describe('trace export', () => {
  let home = ''
  let prevHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'flt-trace-'))
    prevHome = process.env.HOME
    process.env.HOME = home
    seedPresets(home)
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  })

  it('parses claude/codex/gemini/swe logs and sorts by timestamp', async () => {
    const run = makeRun(home, 'trace-1')
    const wdClaude = mkdtempSync(join(tmpdir(), 'wd-claude-'))
    const wdCodex = mkdtempSync(join(tmpdir(), 'wd-codex-'))
    const wdGem = mkdtempSync(join(tmpdir(), 'wd-gem-'))
    const wdSwe = mkdtempSync(join(tmpdir(), 'wd-swe-'))

    run.parallelGroups = {
      p: {
        candidates: [
          { label: 'a', agentName: 'a1', preset: 'cc', worktree: wdClaude },
          { label: 'b', agentName: 'a2', preset: 'cod', worktree: wdCodex },
          { label: 'c', agentName: 'a3', preset: 'gem', worktree: wdGem },
          { label: 'd', agentName: 'a4', preset: 'swe', worktree: wdSwe },
        ],
        treatmentMap: { a: 'cc', b: 'cod', c: 'gem', d: 'swe' },
        allDone: false,
      },
    }
    saveWorkflowRun(run)

    const encodedClaude = realpathSync(wdClaude).replace(/[/_]/g, '-')
    mkdirSync(join(home, '.claude', 'projects', encodedClaude), { recursive: true })
    writeFileSync(join(home, '.claude', 'projects', encodedClaude, 's.jsonl'), [
      JSON.stringify({ type: 'assistant', timestamp: '2026-01-01T00:00:03.000Z', message: { content: 'c-assistant' } }),
      JSON.stringify({ type: 'human', timestamp: '2026-01-01T00:00:01.000Z', message: { content: 'c-user' } }),
    ].join('\n') + '\n')

    mkdirSync(join(home, '.codex', 'sessions', '2026', '01', '01'), { recursive: true })
    writeFileSync(join(home, '.codex', 'sessions', '2026', '01', '01', 'rollout.jsonl'),
      JSON.stringify({ role: 'assistant', timestamp: '2026-01-01T00:00:02.000Z', content: 'x' }) + '\n')

    mkdirSync(join(home, '.gemini', 'tmp', wdGem.split('/').pop() ?? 'x'), { recursive: true })
    writeFileSync(join(home, '.gemini', 'tmp', wdGem.split('/').pop() ?? 'x', 'logs.json'), JSON.stringify([
      { role: 'model', timestamp: '2026-01-01T00:00:04.000Z', content: 'g' },
    ]))

    mkdirSync(join(wdSwe, '.harness'), { recursive: true })
    writeFileSync(join(wdSwe, '.harness', 'swe-traj.json'), JSON.stringify({
      trajectory: [
        { role: 'user', timestamp: '2026-01-01T00:00:05.000Z', content: 's-u' },
        { role: 'assistant', timestamp: '2026-01-01T00:00:06.000Z', content: 's-a' },
      ],
    }))

    const result = await traceExport('trace-1')
    const rows = readTranscript(result.outPath)
    expect(rows.length).toBe(6)
    expect(rows.map(r => r.role)).toEqual(['user', 'assistant', 'assistant', 'assistant', 'user', 'assistant'])
    expect(rows.map(r => r.ts)).toEqual([
      '2026-01-01T00:00:01.000Z',
      '2026-01-01T00:00:02.000Z',
      '2026-01-01T00:00:03.000Z',
      '2026-01-01T00:00:04.000Z',
      '2026-01-01T00:00:05.000Z',
      '2026-01-01T00:00:06.000Z',
    ])
  })

  it('falls back to tmux pipe-pane log and redacts secrets', async () => {
    const run = makeRun(home, 'trace-2')
    const wd = mkdtempSync(join(tmpdir(), 'wd-fallback-'))
    run.parallelGroups = {
      p: {
        candidates: [{ label: 'a', agentName: 'fb', preset: 'cont', worktree: wd }],
        treatmentMap: { a: 'cont' },
        allDone: false,
      },
    }
    saveWorkflowRun(run)

    mkdirSync(join(home, '.flt', 'logs'), { recursive: true })
    writeFileSync(
      join(home, '.flt', 'logs', 'flt-fb.tmux.log'),
      'token sk-abcdefghijklmnop1234567890 Bearer abcdefgh user@example.com abcdefghijklmnopqrstuvwxyz123456\n',
    )

    const result = await traceExport('trace-2')
    const rows = readTranscript(result.outPath)
    expect(rows.length).toBe(1)
    const content = String(rows[0].content)
    expect(content).toContain('<REDACTED:OPENAI_KEY>')
    expect(content).toContain('<REDACTED:BEARER>')
    expect(content).toContain('<REDACTED:EMAIL>')
    expect(content).toContain('<REDACTED:TOKEN_LIKE>')
  })

  it('errors for missing run and run with no agents', async () => {
    await expect(traceExport('does-not-exist')).rejects.toThrow('not found')
    const run = makeRun(home, 'trace-empty')
    saveWorkflowRun(run)
    await expect(traceExport('trace-empty')).rejects.toThrow('no agents')
  })
})
