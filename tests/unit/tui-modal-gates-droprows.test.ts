import { describe, it, expect } from 'bun:test'
import { dropRowsBy, type GatesModalState, type ModalRow } from '../../src/tui/modal-gates'

function makeRow(overrides: Partial<ModalRow> & Pick<ModalRow, 'kind'>): ModalRow {
  return {
    runId: 'run-A',
    workflow: 'wf',
    reason: '',
    ageMs: 0,
    runDir: '/tmp/run-A',
    payload: {} as ModalRow['payload'],
    source: 'gate',
    ...overrides,
  } as ModalRow
}

function makeState(rows: ModalRow[], selectedIndex = 0): GatesModalState {
  return {
    rows,
    selectedIndex,
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

describe('dropRowsBy — selection preservation', () => {
  it('removes a row ABOVE the selection and keeps the same row selected (index decremented)', () => {
    const rowA = makeRow({ kind: 'human_gate', runId: 'run-A' })
    const rowB = makeRow({ kind: 'human_gate', runId: 'run-B' })
    const rowC = makeRow({ kind: 'human_gate', runId: 'run-C' })
    const state = makeState([rowA, rowB, rowC], 2) // rowC selected

    // Remove rowA (above the selection)
    dropRowsBy(state, r => r.runId === 'run-A')

    expect(state.rows).toEqual([rowB, rowC])
    // rowC was at index 2, now it's at index 1 — selectedIndex should follow
    expect(state.selectedIndex).toBe(1)
    expect(state.rows[state.selectedIndex]).toBe(rowC)
  })

  it('removes the selected row itself and clamps within bounds', () => {
    const rowA = makeRow({ kind: 'human_gate', runId: 'run-A' })
    const rowB = makeRow({ kind: 'human_gate', runId: 'run-B' })
    const rowC = makeRow({ kind: 'human_gate', runId: 'run-C' })
    const state = makeState([rowA, rowB, rowC], 1) // rowB selected

    // Remove rowB (the selected row)
    dropRowsBy(state, r => r.runId === 'run-B')

    expect(state.rows).toEqual([rowA, rowC])
    // Selected row is gone — clamp to new length-1 (the predicate removed it)
    expect(state.selectedIndex).toBeLessThan(state.rows.length)
    expect(state.selectedIndex).toBeGreaterThanOrEqual(0)
  })

  it('removes the last row when it is selected and clamps to the new last index', () => {
    const rowA = makeRow({ kind: 'human_gate', runId: 'run-A' })
    const rowB = makeRow({ kind: 'human_gate', runId: 'run-B' })
    const state = makeState([rowA, rowB], 1) // rowB (last) selected

    // Remove rowB
    dropRowsBy(state, r => r.runId === 'run-B')

    expect(state.rows).toEqual([rowA])
    // Clamped to index 0 (new last)
    expect(state.selectedIndex).toBe(0)
  })

  it('removing nothing leaves the index untouched', () => {
    const rowA = makeRow({ kind: 'human_gate', runId: 'run-A' })
    const rowB = makeRow({ kind: 'human_gate', runId: 'run-B' })
    const state = makeState([rowA, rowB], 1) // rowB selected

    // Predicate matches nothing
    dropRowsBy(state, r => r.runId === 'run-NONEXISTENT')

    expect(state.rows).toEqual([rowA, rowB])
    expect(state.selectedIndex).toBe(1)
  })
})
