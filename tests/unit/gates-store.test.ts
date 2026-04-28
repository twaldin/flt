import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  appendPendingGate,
  clearPendingGates,
  hasPendingGates,
  readPendingGates,
  removePendingGate,
} from '../../src/workflow/gates-store'

describe('gates-store', () => {
  let runDir = ''

  beforeEach(() => {
    runDir = mkdtempSync(join(tmpdir(), 'flt-gates-store-test-'))
  })

  afterEach(() => {
    rmSync(runDir, { recursive: true, force: true })
  })

  it('returns empty array when no gate file exists', () => {
    expect(readPendingGates(runDir)).toEqual([])
    expect(hasPendingGates(runDir)).toBe(false)
  })

  it('appends concurrent gates without overwriting (the bug this fixes)', () => {
    appendPendingGate(runDir, { kind: 'node-fail', step: 'execute', nodeId: 'a', reason: 'a fail' })
    appendPendingGate(runDir, { kind: 'node-fail', step: 'execute', nodeId: 'b', reason: 'b fail' })
    appendPendingGate(runDir, { kind: 'node-fail', step: 'execute', nodeId: 'c', reason: 'c fail' })

    const gates = readPendingGates(runDir)
    expect(gates.length).toBe(3)
    expect(gates.map(g => g.nodeId)).toEqual(['a', 'b', 'c'])
  })

  it('idempotent on (kind, step, nodeId): re-appending updates in place', () => {
    appendPendingGate(runDir, { kind: 'node-fail', step: 'execute', nodeId: 'a', reason: 'first' })
    appendPendingGate(runDir, { kind: 'node-fail', step: 'execute', nodeId: 'a', reason: 'second' })

    const gates = readPendingGates(runDir)
    expect(gates.length).toBe(1)
    expect(gates[0].reason).toBe('second')
  })

  it('removes a specific gate by predicate, leaving others', () => {
    appendPendingGate(runDir, { kind: 'node-fail', step: 'execute', nodeId: 'a' })
    appendPendingGate(runDir, { kind: 'node-fail', step: 'execute', nodeId: 'b' })
    appendPendingGate(runDir, { kind: 'reconcile-fail', step: 'execute' })

    const removed = removePendingGate(runDir, g => g.kind === 'node-fail' && g.nodeId === 'a')
    expect(removed?.nodeId).toBe('a')

    const remaining = readPendingGates(runDir)
    expect(remaining.length).toBe(2)
    expect(remaining.map(g => `${g.kind}:${g.nodeId ?? ''}`)).toEqual(['node-fail:b', 'reconcile-fail:'])
  })

  it('unlinks the file when the last gate is removed', () => {
    appendPendingGate(runDir, { kind: 'human_gate', step: 'gate' })
    expect(hasPendingGates(runDir)).toBe(true)

    removePendingGate(runDir, g => g.kind === 'human_gate')
    expect(hasPendingGates(runDir)).toBe(false)
    expect(existsSync(join(runDir, '.gate-pending'))).toBe(false)
  })

  it('clearPendingGates drops everything', () => {
    appendPendingGate(runDir, { kind: 'node-fail', step: 'execute', nodeId: 'a' })
    appendPendingGate(runDir, { kind: 'node-fail', step: 'execute', nodeId: 'b' })

    clearPendingGates(runDir)
    expect(hasPendingGates(runDir)).toBe(false)
    expect(existsSync(join(runDir, '.gate-pending'))).toBe(false)
  })

  it('reads legacy single-object format as a 1-element array', () => {
    // Simulate an old run dir with the pre-array format.
    writeFileSync(join(runDir, '.gate-pending'), JSON.stringify({
      kind: 'human_gate',
      step: 'old-gate',
      at: '2026-01-01T00:00:00Z',
    }))
    const gates = readPendingGates(runDir)
    expect(gates.length).toBe(1)
    expect(gates[0].kind).toBe('human_gate')
    expect(gates[0].step).toBe('old-gate')
  })
})
