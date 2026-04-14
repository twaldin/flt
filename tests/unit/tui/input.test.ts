import { describe, it, expect } from 'bun:test'
import { RawKeyParser, handleInputEvent, getCompletionHint, type InputBindings, type ParsedInputEvent } from '../../../src/tui/input'
import { createInitialState, type AgentView } from '../../../src/tui/types'

function mockAgent(name: string): AgentView {
  return {
    name,
    status: 'running',
    lastSeen: Date.now(),
    cli: 'claude-code',
    model: 'sonnet',
    tmuxSession: `flt-${name}`,
    parentName: 'orchestrator',
    dir: '/tmp',
    spawnedAt: new Date().toISOString(),
  }
}

function createBindings(mode: 'normal' | 'log-focus' | 'insert' | 'command' | 'inbox' | 'presets') {
  const state = createInitialState(100, 40)
  state.mode = mode
  state.agents = [mockAgent('alpha'), mockAgent('beta')]

  const calls: string[] = []

  const bindings: InputBindings = {
    getState: () => ({ ...state, selectedAgent: state.agents[state.selectedIndex] }),
    getAgentNames: () => state.agents.map((a) => a.name),
    getCliAdapters: () => ['claude-code', 'codex'],
    getPresetNames: () => ['coder', 'reviewer'],
    setMode: (nextMode) => {
      state.mode = nextMode
      calls.push(`mode:${nextMode}`)
    },
    openCommand: (initial) => {
      state.mode = 'command'
      state.commandInput = initial
      state.commandCursor = initial.length
      calls.push(`open:${initial}`)
    },
    setCommand: (input, cursor) => {
      state.commandInput = input
      state.commandCursor = cursor
      calls.push(`cmd:${input}`)
    },
    selectNext: () => {
      state.selectedIndex = Math.min(state.agents.length - 1, state.selectedIndex + 1)
      calls.push('next')
    },
    selectPrev: () => {
      state.selectedIndex = Math.max(0, state.selectedIndex - 1)
      calls.push('prev')
    },
    scrollLogUp: () => calls.push('up'),
    scrollLogDown: () => calls.push('down'),
    scrollLogPageUp: () => calls.push('page-up'),
    scrollLogPageDown: () => calls.push('page-down'),
    jumpLogTop: () => calls.push('top'),
    jumpLogBottom: () => calls.push('bottom'),
    setSearchQuery: (query) => calls.push(`search:${query}`),
    submitCommand: (input) => calls.push(`submit:${input}`),
    sendInsertText: (text) => calls.push(`insert-text:${text}`),
    sendInsertKey: (key) => calls.push(`insert-key:${key}`),
    flushInsert: () => calls.push('flush'),
    toggleCollapse: () => calls.push('toggle-collapse'),
    quit: () => calls.push('quit'),
  }

  return { state, bindings, calls }
}

describe('raw key parser', () => {
  it('parses arrow keys and text', () => {
    const events: ParsedInputEvent[] = []
    const parser = new RawKeyParser((event) => events.push(event))

    parser.feed(Buffer.from('\x1b[A'))
    parser.feed(Buffer.from('hello'))

    expect(events[0]).toMatchObject({ type: 'key', key: 'up' })
    expect(events[1]).toMatchObject({ type: 'text', text: 'hello' })
  })

  it('distinguishes bare escape with timeout flush', () => {
    const events: ParsedInputEvent[] = []
    const parser = new RawKeyParser((event) => events.push(event))

    parser.feed(Buffer.from([0x1b]))
    expect(events.length).toBe(0)

    parser.flushPendingEscape()
    expect(events[0]).toMatchObject({ type: 'key', key: 'escape' })
  })
})

describe('input dispatch', () => {
  it('handles normal mode navigation', () => {
    const { bindings, calls } = createBindings('normal')
    handleInputEvent({ type: 'text', text: 'j', raw: Buffer.from('j') }, bindings)
    expect(calls).toContain('next')
  })

  it('handles command tab completion', () => {
    const { state, bindings } = createBindings('command')
    state.commandInput = 'sp'
    state.commandCursor = 2

    handleInputEvent({ type: 'key', key: 'tab', raw: Buffer.from('\t') }, bindings)
    expect(state.commandInput).toBe('spawn ')
  })

  it('forwards insert text directly', () => {
    const { bindings, calls } = createBindings('insert')
    handleInputEvent({ type: 'text', text: 'xyz', raw: Buffer.from('xyz') }, bindings)
    expect(calls).toContain('insert-text:xyz')
  })

  it('handles log-focus paging with ctrl-d', () => {
    const { bindings, calls } = createBindings('log-focus')
    handleInputEvent({ type: 'key', key: 'ctrl-d', raw: Buffer.from([0x04]) }, bindings)
    expect(calls).toContain('page-down')
  })

  it('closes presets mode with escape', () => {
    const { state, bindings, calls } = createBindings('presets')
    handleInputEvent({ type: 'key', key: 'escape', raw: Buffer.from([0x1b]) }, bindings)
    expect(calls).toContain('mode:normal')
    expect(state.mode).toBe('normal')
  })

  it('opens command from presets mode with colon', () => {
    const { state, bindings, calls } = createBindings('presets')
    handleInputEvent({ type: 'text', text: ':', raw: Buffer.from(':') }, bindings)
    expect(calls).toContain('open:')
    expect(state.mode).toBe('command')
  })

  it('returns completion hint for partial command', () => {
    const hint = getCompletionHint('sp', ['alpha'], ['claude-code'])
    expect(hint.hint).toBe('awn')
  })

  it('completes spawn --preset values', () => {
    const { state, bindings } = createBindings('command')
    state.commandInput = 'spawn worker --preset c'
    state.commandCursor = state.commandInput.length

    handleInputEvent({ type: 'key', key: 'tab', raw: Buffer.from('\t') }, bindings)
    expect(state.commandInput).toBe('spawn worker --preset coder ')
  })
})
