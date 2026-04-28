import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * Pending-gate storage. Workflow runs can have multiple gates open at once
 * (e.g. several dag nodes fail in the same advance tick) so the on-disk
 * format is a JSON array of payloads.
 *
 * Backward compat: an old run dir may have a single-object payload at
 * `.gate-pending`. Readers detect and wrap it as `[obj]`.
 */
export interface PendingGate extends Record<string, unknown> {
  kind: string
  id?: string
  at?: string
}

const GATE_FILENAME = '.gate-pending'

function gatePath(runDir: string): string {
  return join(runDir, GATE_FILENAME)
}

function gateId(payload: PendingGate): string {
  if (typeof payload.id === 'string' && payload.id) return payload.id
  const parts = [
    String(payload.kind ?? ''),
    String(payload.step ?? ''),
    String(payload.nodeId ?? ''),
    String(payload.at ?? Date.now()),
  ]
  return parts.join(':')
}

export function readPendingGates(runDir: string): PendingGate[] {
  const p = gatePath(runDir)
  if (!existsSync(p)) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return []
  }
  if (Array.isArray(parsed)) {
    return parsed.filter((g): g is PendingGate => g !== null && typeof g === 'object')
  }
  if (parsed !== null && typeof parsed === 'object') {
    return [parsed as PendingGate]
  }
  return []
}

/**
 * Append a gate to the pending list. Idempotent on (kind, step, nodeId) —
 * a second openGate for the same logical gate updates the existing entry
 * in place rather than duplicating.
 */
export function appendPendingGate(runDir: string, payload: PendingGate): void {
  const enriched: PendingGate = { id: gateId(payload), ...payload }
  const existing = readPendingGates(runDir)
  const id = enriched.id
  const idx = existing.findIndex(g => gateId(g) === id)
  if (idx >= 0) existing[idx] = enriched
  else existing.push(enriched)
  atomicWrite(runDir, existing)
}

export function removePendingGate(runDir: string, predicate: (g: PendingGate) => boolean): PendingGate | null {
  const existing = readPendingGates(runDir)
  const idx = existing.findIndex(predicate)
  if (idx < 0) return null
  const removed = existing[idx]
  const remaining = existing.filter((_, i) => i !== idx)
  if (remaining.length === 0) {
    try { unlinkSync(gatePath(runDir)) } catch { /* best effort */ }
  } else {
    atomicWrite(runDir, remaining)
  }
  return removed
}

/**
 * Drop ALL pending gates. Used by cancelWorkflow + GC.
 */
export function clearPendingGates(runDir: string): void {
  try { unlinkSync(gatePath(runDir)) } catch { /* best effort */ }
}

export function hasPendingGates(runDir: string): boolean {
  return readPendingGates(runDir).length > 0
}

/**
 * Find the first pending gate matching a predicate — used when decision
 * dispatch needs to pick out a specific gate (e.g. by nodeId) without
 * removing it.
 */
export function findPendingGate(runDir: string, predicate: (g: PendingGate) => boolean): PendingGate | null {
  return readPendingGates(runDir).find(predicate) ?? null
}

function atomicWrite(runDir: string, gates: PendingGate[]): void {
  const p = gatePath(runDir)
  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify(gates) + '\n')
  renameSync(tmp, p)
}
