import { describe, it, expect } from 'bun:test'
import {
  handleGatesKey,
  type GatesActions,
  type GatesModalState,
  type ModalRow,
} from '../../src/tui/modal-gates'

function noopActions(): GatesActions {
  return {
    approve: () => {},
    reject: () => {},
    nodeRetry: () => {},
    nodeSkip: () => {},
    nodeAbort: () => {},
    reconcileRetry: () => {},
    reconcileAbort: () => {},
    pickCandidate: () => {},
    cancelRun: () => {},
    dismissBlocker: () => {},
    refresh: () => {},
  }
}

function makeRow(overrides: Partial<ModalRow> & Pick<ModalRow, 'kind'>): ModalRow {
  return {
    runId: 'run-A',
    workflow: 'wf',
    kind: overrides.kind,
    reason: '',
    ageMs: 0,
    runDir: '/tmp/run-A',
    payload: { kind: overrides.kind } as unknown as ModalRow['payload'],
    source: 'gate',
    ...overrides,
  } as ModalRow
}

function makeState(rows: ModalRow[]): GatesModalState {
  return {
    rows,
    selectedIndex: 0,
    subPicker: null,
    rejectPrompt: null,
    cancelConfirm: false,
    blockerOverlay: null,
    detailOverlay: null,
    questionPicker: null,
    watcher: null,
    qnaWatcher: null,
  }
}

describe('gates modal — optimistic row removal on action', () => {
  it('approve drops the human_gate row immediately', () => {
    const state = makeState([makeRow({ kind: 'human_gate' })])
    let approveCalled = false
    const actions = { ...noopActions(), approve: () => { approveCalled = true } }
    handleGatesKey(state, 'a', actions)
    expect(approveCalled).toBe(true)
    expect(state.rows.length).toBe(0)
  })

  it('node-fail retry drops only the matching node row, leaves siblings', () => {
    const state = makeState([
      makeRow({ kind: 'node-fail', payload: { kind: 'node-fail', nodeId: 'n1' } as ModalRow['payload'] }),
      makeRow({ kind: 'node-fail', payload: { kind: 'node-fail', nodeId: 'n2' } as ModalRow['payload'] }),
    ])
    handleGatesKey(state, 'r', noopActions())
    expect(state.rows.length).toBe(1)
    expect((state.rows[0]!.payload as { nodeId?: string }).nodeId).toBe('n2')
  })

  it('node-fail abort drops ALL node rows for that run', () => {
    const state = makeState([
      makeRow({ kind: 'node-fail', payload: { kind: 'node-fail', nodeId: 'n1' } as ModalRow['payload'] }),
      makeRow({ kind: 'node-fail', payload: { kind: 'node-fail', nodeId: 'n2' } as ModalRow['payload'] }),
      makeRow({ kind: 'node-candidate', payload: { kind: 'node-candidate', nodeId: 'n1', options: [] } as ModalRow['payload'] }),
      makeRow({ kind: 'human_gate', runId: 'run-B' }),
    ])
    handleGatesKey(state, 'a', noopActions())
    expect(state.rows.length).toBe(1)
    expect(state.rows[0]!.runId).toBe('run-B')
  })

  it('reconcile retry drops only the reconcile-fail row', () => {
    const state = makeState([
      makeRow({ kind: 'reconcile-fail' }),
      makeRow({ kind: 'human_gate', runId: 'run-B' }),
    ])
    handleGatesKey(state, 'r', noopActions())
    expect(state.rows.length).toBe(1)
    expect(state.rows[0]!.runId).toBe('run-B')
  })

  it('reconcile abort drops everything for that run', () => {
    const state = makeState([
      makeRow({ kind: 'reconcile-fail' }),
      makeRow({ kind: 'node-fail', payload: { kind: 'node-fail', nodeId: 'n1' } as ModalRow['payload'] }),
      makeRow({ kind: 'human_gate', runId: 'run-B' }),
    ])
    handleGatesKey(state, 'a', noopActions())
    expect(state.rows.length).toBe(1)
    expect(state.rows[0]!.runId).toBe('run-B')
  })

  it('selectedIndex clamps when last row is dropped', () => {
    const state = makeState([
      makeRow({ kind: 'human_gate', runId: 'run-A' }),
      makeRow({ kind: 'human_gate', runId: 'run-B' }),
    ])
    state.selectedIndex = 1
    handleGatesKey(state, 'a', noopActions())
    // run-B's row is gone; selectedIndex should clamp to 0 on the remaining run-A row
    expect(state.rows.length).toBe(1)
    expect(state.selectedIndex).toBe(0)
  })

  it('skip on a non-batch question row drops the row', () => {
    const state = makeState([
      makeRow({
        kind: 'question',
        runId: 'run-A',
        question: { id: 'q1', header: 'h', question: 'Q', multiSelect: false, options: [{ label: 'a' }] },
        answerPath: '/tmp/q1.answer.json',
      }),
    ])
    handleGatesKey(state, 's', noopActions())
    expect(state.rows.length).toBe(0)
  })

  it('skip on a batch question row keeps the row (only first question is skipped, rest still pending)', () => {
    const q1 = { id: 'q1', header: 'h', question: 'Q1', multiSelect: false, options: [{ label: 'a' }] }
    const q2 = { id: 'q2', header: 'h', question: 'Q2', multiSelect: false, options: [{ label: 'b' }] }
    const state = makeState([
      makeRow({
        kind: 'question',
        runId: 'run-A',
        question: q1,
        answerPath: '/tmp/q1.answer.json',
        batchQuestions: [q1, q2],
        batchAnswerPaths: ['/tmp/q1.answer.json', '/tmp/q2.answer.json'],
      }),
    ])
    handleGatesKey(state, 's', noopActions())
    // Row stays — the watcher refresh will rebuild it pointing at q2.
    expect(state.rows.length).toBe(1)
  })
})
