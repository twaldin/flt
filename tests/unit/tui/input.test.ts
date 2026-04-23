import { describe, it, expect } from 'bun:test'
import { RawKeyParser, handleInputEvent, getCompletionHint, getCompletionItems, type InputBindings, type ParsedInputEvent } from '../../../src/tui/input'
import { createInitialState, type AgentView } from '../../../src/tui/types'

function mockAgent(name: string, cli = 'claude-code'): AgentView {
  return {
    name,
    status: 'running',
    lastSeen: Date.now(),
    cli,
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
    setCompletionPopup: (items, selectedIndex) => {
      state.completionItems = items
      state.completionSelectedIndex = selectedIndex
      calls.push(`popup:${items.length}:${selectedIndex}`)
    },
    setCompletionSelectedIndex: (index) => {
      state.completionSelectedIndex = index
      calls.push(`sel:${index}`)
    },
    closeCompletionPopup: () => {
      state.completionItems = []
      state.completionSelectedIndex = 0
      calls.push('popup-close')
    },
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

  it('parses SGR mouse wheel events', () => {
    const events: ParsedInputEvent[] = []
    const parser = new RawKeyParser((event) => events.push(event))

    parser.feed(Buffer.from('\x1b[<64;42;10M'))
    parser.feed(Buffer.from('\x1b[<65;42;10M'))

    expect(events[0]).toMatchObject({ type: 'key', key: 'wheel-up' })
    expect(events[1]).toMatchObject({ type: 'key', key: 'wheel-down' })
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

  it('passes log-focus j/k scroll through to opencode viewport', () => {
    const { state, bindings, calls } = createBindings('log-focus')
    state.agents = [mockAgent('alpha', 'opencode')]
    state.selectedIndex = 0

    handleInputEvent({ type: 'text', text: 'j', raw: Buffer.from('j') }, bindings)
    handleInputEvent({ type: 'text', text: 'k', raw: Buffer.from('k') }, bindings)

    expect(calls).toContain('insert-key:C-M-e')
    expect(calls).toContain('insert-key:C-M-y')
    expect(calls).not.toContain('down')
    expect(calls).not.toContain('up')
  })

  it('passes log-focus ctrl-u/d through to opencode viewport', () => {
    const { state, bindings, calls } = createBindings('log-focus')
    state.agents = [mockAgent('alpha', 'opencode')]
    state.selectedIndex = 0

    handleInputEvent({ type: 'key', key: 'ctrl-d', raw: Buffer.from([0x04]) }, bindings)
    handleInputEvent({ type: 'key', key: 'ctrl-u', raw: Buffer.from([0x15]) }, bindings)

    expect(calls).toContain('insert-key:NPage')
    expect(calls).toContain('insert-key:PPage')
    expect(calls).not.toContain('page-down')
    expect(calls).not.toContain('page-up')
  })

  it('passes mouse wheel in log-focus through to opencode viewport', () => {
    const { state, bindings, calls } = createBindings('log-focus')
    state.agents = [mockAgent('alpha', 'opencode')]
    state.selectedIndex = 0

    handleInputEvent({ type: 'key', key: 'wheel-down', raw: Buffer.from('') }, bindings)
    handleInputEvent({ type: 'key', key: 'wheel-up', raw: Buffer.from('') }, bindings)

    expect(calls).toContain('insert-key:C-M-e')
    expect(calls).toContain('insert-key:C-M-y')
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

  it('opens popup with multiple completions on Tab', () => {
    const { state, bindings, calls } = createBindings('command')
    state.commandInput = 'se'
    state.commandCursor = 2

    handleInputEvent({ type: 'key', key: 'tab', raw: Buffer.from('\t') }, bindings)
    expect(state.completionItems.length).toBeGreaterThan(0)
    expect(state.completionSelectedIndex).toBe(0)
    expect(calls.some(c => c.startsWith('popup:'))).toBe(true)
  })

  it('opens popup selecting last item on Shift-Tab', () => {
    const { state, bindings, calls } = createBindings('command')
    state.commandInput = 'se'
    state.commandCursor = 2

    handleInputEvent({ type: 'key', key: 'shift-tab', raw: Buffer.from('\x1b[Z') }, bindings)
    const lastIdx = state.completionItems.length - 1
    expect(state.completionSelectedIndex).toBe(lastIdx)
  })

  it('cycles forward through popup with Tab', () => {
    const { state, bindings, calls } = createBindings('command')
    state.commandInput = 'se'
    state.completionItems = getCompletionItems('se', [], ['claude-code'], [])
    state.completionSelectedIndex = 0
    const len = state.completionItems.length

    handleInputEvent({ type: 'key', key: 'tab', raw: Buffer.from('\t') }, bindings)
    expect(calls).toContain(`sel:${(0 + 1) % len}`)
  })

  it('cycles backward through popup with Shift-Tab', () => {
    const { state, bindings, calls } = createBindings('command')
    state.commandInput = 'se'
    state.completionItems = getCompletionItems('se', [], ['claude-code'], [])
    state.completionSelectedIndex = 0
    const len = state.completionItems.length

    handleInputEvent({ type: 'key', key: 'shift-tab', raw: Buffer.from('\x1b[Z') }, bindings)
    expect(calls).toContain(`sel:${(0 - 1 + len) % len}`)
  })

  it('navigates popup with up/down arrows', () => {
    const { state, bindings, calls } = createBindings('command')
    state.commandInput = 'se'
    state.completionItems = getCompletionItems('se', [], ['claude-code'], [])
    state.completionSelectedIndex = 1

    handleInputEvent({ type: 'key', key: 'up', raw: Buffer.from('\x1b[A') }, bindings)
    expect(calls).toContain('sel:0')

    calls.length = 0
    handleInputEvent({ type: 'key', key: 'down', raw: Buffer.from('\x1b[B') }, bindings)
    expect(calls).toContain('sel:1')
  })

  it('applies selected completion on Enter when popup visible', () => {
    const { state, bindings, calls } = createBindings('command')
    state.commandInput = 'se'
    state.completionItems = getCompletionItems('se', [], ['claude-code'], [])
    state.completionSelectedIndex = 0
    const selectedItem = state.completionItems[0]

    handleInputEvent({ type: 'key', key: 'enter', raw: Buffer.from('\r') }, bindings)
    expect(state.commandInput).toBe(`${selectedItem.value} `)
    expect(state.completionItems.length).toBe(0)
  })

  it('closes popup on Escape without leaving command mode', () => {
    const { state, bindings, calls } = createBindings('command')
    state.commandInput = 's'
    state.completionItems = [{ value: 'send', label: 'cmd' }, { value: 'spawn', label: 'cmd' }]
    state.completionSelectedIndex = 0

    handleInputEvent({ type: 'key', key: 'escape', raw: Buffer.from([0x1b]) }, bindings)
    expect(state.completionItems.length).toBe(0)
    expect(state.mode).toBe('command')
  })

  it('cancels command mode on second Escape after popup closed', () => {
    const { state, bindings } = createBindings('command')
    state.commandInput = 's'

    handleInputEvent({ type: 'key', key: 'escape', raw: Buffer.from([0x1b]) }, bindings)
    expect(state.mode).toBe('normal')
  })
})

describe('completion ranking and metadata', () => {
  it('ranks exact prefix matches before fuzzy matches', () => {
    const items = getCompletionItems('sp', [], ['claude-code'], [])
    // 'spawn' starts with 'sp' → rank 0
    // Other fuzzy matches if any → rank 1
    const spawnIdx = items.findIndex(i => i.value === 'spawn')
    expect(spawnIdx).toBe(0)
  })

  it('includes fuzzy matches after prefix matches', () => {
    const items = getCompletionItems('pn', [], ['claude-code'], [])
    // 'spawn' contains 'p' then 'n' → fuzzy match
    const spawnItem = items.find(i => i.value === 'spawn')
    expect(spawnItem).toBeDefined()
  })

  it('provides labels for command completions', () => {
    const items = getCompletionItems('sen', [], ['claude-code'], [])
    const sendItem = items.find(i => i.value === 'send')
    expect(sendItem?.label).toBe('cmd')
    expect(sendItem?.description).toBe('Send message to agent')
  })

  it('provides labels for agent name completions', () => {
    const items = getCompletionItems('send al', ['alpha', 'beta'], ['claude-code'], [])
    const alphaItem = items.find(i => i.value === 'alpha')
    expect(alphaItem?.label).toBe('agent')
  })

  it('provides labels for flag completions', () => {
    const items = getCompletionItems('spawn x --', [], ['claude-code'], [])
    const cliItem = items.find(i => i.value === '--cli')
    expect(cliItem?.label).toBe('flag')
    expect(cliItem?.description).toBe('CLI adapter')
  })

  it('provides labels for theme completions', () => {
    const items = getCompletionItems('theme d', [], ['claude-code'], [])
    const darkItem = items.find(i => i.value === 'dark')
    expect(darkItem?.label).toBe('theme')
  })

  it('provides labels for preset completions', () => {
    const items = getCompletionItems('spawn x --preset c', [], ['claude-code'], ['coder', 'reviewer'])
    const coderItem = items.find(i => i.value === 'coder')
    expect(coderItem?.label).toBe('preset')
  })

  it('provides description for all commands', () => {
    const items = getCompletionItems('', [], ['claude-code'], [])
    for (const cmd of ['send', 'logs', 'spawn', 'presets', 'kill', 'theme', 'ascii', 'keybinds', 'help']) {
      const item = items.find(i => i.value === cmd)
      expect(item?.description).toBeTruthy()
    }
  })
})
