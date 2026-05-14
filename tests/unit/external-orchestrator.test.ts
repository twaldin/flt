import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { mkdirSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import * as state from '../../src/state'
import * as initMod from '../../src/commands/init'
import { sendDirect, appendExternalEvent } from '../../src/commands/send'
import { orchestratorSetDirect, orchestratorStatus } from '../../src/commands/orchestrator'

let tmpHome: string
const origHome = process.env.HOME

beforeEach(() => {
  tmpHome = join(tmpdir(), `flt-ext-orch-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(tmpHome, '.flt'), { recursive: true })
  process.env.HOME = tmpHome
})

afterEach(() => {
  process.env.HOME = origHome
  mock.restore()
  if (existsSync(tmpHome)) rmSync(tmpHome, { recursive: true, force: true })
})

// --- OrchestratorState type ---

describe('OrchestratorState', () => {
  it('accepts type=external with name and sink', () => {
    const orch: state.OrchestratorState = {
      tmuxSession: '',
      tmuxWindow: '',
      type: 'external',
      name: 'hermes',
      sink: 'inbox',
      initAt: new Date().toISOString(),
    }
    expect(orch.type).toBe('external')
    expect(orch.name).toBe('hermes')
    expect(orch.sink).toBe('inbox')
  })

  it('leaves existing human/agent types compatible', () => {
    const human: state.OrchestratorState = {
      tmuxSession: 'flt-main',
      tmuxWindow: '0',
      type: 'human',
      initAt: new Date().toISOString(),
    }
    expect(human.type).toBe('human')
  })
})

// --- orchestratorSetDirect ---

describe('orchestratorSetDirect', () => {
  it('registers an external orchestrator in state', () => {
    spyOn(state, 'setOrchestrator').mockImplementation(() => {})
    orchestratorSetDirect({ name: 'hermes', external: true, sink: 'inbox' })
    const calls = (state.setOrchestrator as ReturnType<typeof spyOn>).mock.calls
    expect(calls.length).toBe(1)
    const arg = calls[0][0] as state.OrchestratorState
    expect(arg.type).toBe('external')
    expect(arg.name).toBe('hermes')
    expect(arg.sink).toBe('inbox')
  })

  it('defaults sink to inbox when omitted', () => {
    spyOn(state, 'setOrchestrator').mockImplementation(() => {})
    orchestratorSetDirect({ name: 'hermes', external: true })
    const arg = ((state.setOrchestrator as ReturnType<typeof spyOn>).mock.calls[0][0]) as state.OrchestratorState
    expect(arg.sink).toBe('inbox')
  })

  it('throws when --external is not passed', () => {
    expect(() => orchestratorSetDirect({ name: 'hermes', external: false })).toThrow('Only --external is supported')
  })
})

// --- orchestratorStatus ---

describe('orchestratorStatus', () => {
  it('prints orchestrator JSON when registered', () => {
    const orch: state.OrchestratorState = {
      tmuxSession: '',
      tmuxWindow: '',
      type: 'external',
      name: 'hermes',
      sink: 'inbox',
      initAt: '2026-05-13T00:00:00.000Z',
    }
    spyOn(state, 'getOrchestrator').mockReturnValue(orch)
    const logs: string[] = []
    spyOn(console, 'log').mockImplementation((s: string) => { logs.push(s) })
    orchestratorStatus()
    expect(logs.join('')).toContain('hermes')
  })

  it('prints "No orchestrator registered" when state is empty', () => {
    spyOn(state, 'getOrchestrator').mockReturnValue(undefined)
    const logs: string[] = []
    spyOn(console, 'log').mockImplementation((s: string) => { logs.push(s) })
    orchestratorStatus()
    expect(logs.join('')).toContain('No orchestrator registered')
  })
})

// --- sendDirect with external orchestrator ---

describe('sendDirect — external parent routing', () => {
  it('writes to events.jsonl and inbox when parent is external orchestrator', async () => {
    spyOn(state, 'getOrchestrator').mockReturnValue({
      tmuxSession: '',
      tmuxWindow: '',
      type: 'external',
      name: 'hermes',
      sink: 'inbox',
      initAt: '2026-05-13T00:00:00.000Z',
    })
    const inboxSpy = spyOn(initMod, 'appendInbox').mockImplementation(() => {})

    await sendDirect({
      target: 'parent',
      message: 'done with task',
      from: 'my-agent',
      _caller: { mode: 'agent', agentName: 'my-agent', parentName: 'hermes', depth: 1 },
    })

    expect(inboxSpy).toHaveBeenCalledWith('my-agent', 'done with task')

    const eventsPath = join(tmpHome, '.flt', 'events.jsonl')
    expect(existsSync(eventsPath)).toBe(true)
    const lines = readFileSync(eventsPath, 'utf-8').trim().split('\n')
    expect(lines.length).toBe(1)
    const evt = JSON.parse(lines[0])
    expect(evt.version).toBe(1)
    expect(evt.type).toBe('message')
    expect(evt.from).toBe('my-agent')
    expect(evt.to).toBe('hermes')
    expect(evt.text).toBe('done with task')
    expect(evt.message).toBe('done with task')
    expect(typeof evt.ts).toBe('number')
  })

  it('does NOT write to events.jsonl when parent is human', async () => {
    spyOn(state, 'getOrchestrator').mockReturnValue({
      tmuxSession: 'flt-main',
      tmuxWindow: '0',
      type: 'human',
      initAt: '2026-05-13T00:00:00.000Z',
    })
    spyOn(initMod, 'appendInbox').mockImplementation(() => {})

    await sendDirect({
      target: 'parent',
      message: 'hello human',
      from: 'agent-a',
      _caller: { mode: 'agent', agentName: 'agent-a', parentName: 'human', depth: 1 },
    })

    const eventsPath = join(tmpHome, '.flt', 'events.jsonl')
    expect(existsSync(eventsPath)).toBe(false)
  })

  it('does NOT route to external when orchestrator name does not match parentName', async () => {
    spyOn(state, 'getOrchestrator').mockReturnValue({
      tmuxSession: '',
      tmuxWindow: '',
      type: 'external',
      name: 'different-orch',
      sink: 'inbox',
      initAt: '2026-05-13T00:00:00.000Z',
    })
    spyOn(state, 'getAgent').mockReturnValue(undefined)
    spyOn(initMod, 'appendInbox').mockImplementation(() => {})

    // parentName='hermes' but orchestrator.name='different-orch' → falls through to agent lookup → inbox fallback
    await sendDirect({
      target: 'parent',
      message: 'hello',
      from: 'agent-a',
      _caller: { mode: 'agent', agentName: 'agent-a', parentName: 'hermes', depth: 1 },
    })

    const eventsPath = join(tmpHome, '.flt', 'events.jsonl')
    expect(existsSync(eventsPath)).toBe(false)
    // fallback inbox still called
    expect(initMod.appendInbox as ReturnType<typeof spyOn>).toHaveBeenCalled()
  })
})

// --- appendExternalEvent ---

describe('appendExternalEvent', () => {
  it('writes a JSONL line to events.jsonl', () => {
    appendExternalEvent('agent-x', 'hermes', 'test message')
    const eventsPath = join(tmpHome, '.flt', 'events.jsonl')
    expect(existsSync(eventsPath)).toBe(true)
    const evt = JSON.parse(readFileSync(eventsPath, 'utf-8').trim())
    expect(evt.version).toBe(1)
    expect(evt.from).toBe('agent-x')
    expect(evt.to).toBe('hermes')
    expect(evt.text).toBe('test message')
    expect(evt.message).toBe('test message')
    expect(typeof evt.ts).toBe('number')
  })

  it('appends multiple events as separate lines', () => {
    appendExternalEvent('a', 'hermes', 'first')
    appendExternalEvent('b', 'hermes', 'second')
    const eventsPath = join(tmpHome, '.flt', 'events.jsonl')
    const lines = readFileSync(eventsPath, 'utf-8').trim().split('\n')
    expect(lines.length).toBe(2)
    expect(JSON.parse(lines[0]).message).toBe('first')
    expect(JSON.parse(lines[1]).message).toBe('second')
  })

  it('forwards Hermes kanban refs opaquely when present', () => {
    const prevTask = process.env.HERMES_KANBAN_TASK
    const prevRun = process.env.HERMES_KANBAN_RUN_ID
    const prevParent = process.env.HERMES_KANBAN_PARENT_REF
    process.env.HERMES_KANBAN_TASK = 't_abc123'
    process.env.HERMES_KANBAN_RUN_ID = '42'
    process.env.HERMES_KANBAN_PARENT_REF = '{"kind":"flt-event-sink","board":"kanban-flt-events"}'
    try {
      appendExternalEvent('agent-x', 'hermes', 'done')
    } finally {
      if (prevTask === undefined) delete process.env.HERMES_KANBAN_TASK
      else process.env.HERMES_KANBAN_TASK = prevTask
      if (prevRun === undefined) delete process.env.HERMES_KANBAN_RUN_ID
      else process.env.HERMES_KANBAN_RUN_ID = prevRun
      if (prevParent === undefined) delete process.env.HERMES_KANBAN_PARENT_REF
      else process.env.HERMES_KANBAN_PARENT_REF = prevParent
    }

    const eventsPath = join(tmpHome, '.flt', 'events.jsonl')
    const evt = JSON.parse(readFileSync(eventsPath, 'utf-8').trim())
    expect(evt.refs).toEqual({
      HERMES_KANBAN_TASK: 't_abc123',
      HERMES_KANBAN_RUN_ID: '42',
      HERMES_KANBAN_PARENT_REF: '{"kind":"flt-event-sink","board":"kanban-flt-events"}',
    })
  })
})
