#!/usr/bin/env bun
/**
 * validate-bug-report.ts — validates a `bugs.json` array produced by a hunt
 * feature against `library/bug-report-schema.md` (mission knowledge base).
 *
 * Schema (see library/bug-report-schema.md):
 *   - id              : string
 *   - title           : string (≤ 100 chars enforced; longer titles are
 *                       reported as a warning by failing the validator)
 *   - surface         : string ∈ KNOWN_SURFACES (or `adapter:<name>`)
 *   - severity        : 'critical' | 'high' | 'medium' | 'low'
 *   - repro_steps     : string[]                (non-empty)
 *   - observed        : string                  (non-empty)
 *   - expected        : string                  (non-empty)
 *   - env             : object                  (non-null record)
 *   - evidence_path   : string (must exist on disk)
 *   - cycle           : number ≥ 1 (integer)
 *
 * Optional fields are not type-checked beyond schema documentation
 * (suspected_source, related_bugs, notes).
 *
 * Exit codes:
 *   0  — input is a valid array of bug entries (empty array allowed).
 *   1  — schema violation (one or more diagnostics printed to stderr).
 *   2  — usage error (missing path, unreadable file, malformed JSON).
 *
 * Usage:
 *   bun scripts/validate-bug-report.ts <path/to/bugs.json>
 *
 * Importable API:
 *   import { validateBugReport, ValidationResult } from './validate-bug-report'
 *   const result = validateBugReport(parsed)
 */

import { existsSync, readFileSync, statSync } from 'node:fs'

export type Severity = 'critical' | 'high' | 'medium' | 'low'

export interface ValidationError {
  index: number // -1 for top-level errors (e.g., not an array)
  field: string // dot-path inside the entry, or '' for top-level
  message: string
}

export interface ValidationResult {
  ok: boolean
  errors: ValidationError[]
}

const SEVERITIES: ReadonlySet<string> = new Set([
  'critical',
  'high',
  'medium',
  'low',
])

// Surfaces enumerated in library/bug-report-schema.md. `adapter:<name>` is a
// dynamic family — any non-empty <name> is accepted.
const KNOWN_SURFACES: ReadonlySet<string> = new Set([
  'lifecycle',
  'tui',
  'workflow',
  'skills',
  'presets',
  'sync',
  'audit',
  'qna',
  'cron',
  'metrics',
  'activity',
  'trace',
  'other',
])

/**
 * Allow callers to pass `evidenceExists` for tests that don't want to touch
 * the filesystem. Defaults to a real `existsSync` check.
 */
export interface ValidateOptions {
  evidenceExists?: (path: string) => boolean
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string')
}

function checkSurface(surface: string): boolean {
  if (KNOWN_SURFACES.has(surface)) return true
  if (surface.startsWith('adapter:')) {
    const name = surface.slice('adapter:'.length)
    return name.length > 0
  }
  return false
}

function pushErr(
  errors: ValidationError[],
  index: number,
  field: string,
  message: string,
): void {
  errors.push({ index, field, message })
}

function validateEntry(
  entry: unknown,
  index: number,
  errors: ValidationError[],
  evidenceExists: (path: string) => boolean,
): void {
  if (!isPlainObject(entry)) {
    pushErr(errors, index, '', 'entry must be a JSON object')
    return
  }

  // id
  if (typeof entry.id !== 'string' || entry.id.length === 0) {
    pushErr(errors, index, 'id', "missing or non-string 'id'")
  }

  // title
  if (typeof entry.title !== 'string' || entry.title.length === 0) {
    pushErr(errors, index, 'title', "missing or non-string 'title'")
  } else if (entry.title.length > 100) {
    pushErr(
      errors,
      index,
      'title',
      `'title' exceeds 100 chars (got ${entry.title.length})`,
    )
  }

  // surface
  if (typeof entry.surface !== 'string' || entry.surface.length === 0) {
    pushErr(errors, index, 'surface', "missing or non-string 'surface'")
  } else if (!checkSurface(entry.surface)) {
    pushErr(
      errors,
      index,
      'surface',
      `'surface' '${entry.surface}' is not a known surface (see library/bug-report-schema.md)`,
    )
  }

  // severity
  if (typeof entry.severity !== 'string') {
    pushErr(errors, index, 'severity', "missing or non-string 'severity'")
  } else if (!SEVERITIES.has(entry.severity)) {
    pushErr(
      errors,
      index,
      'severity',
      `'severity' must be one of critical|high|medium|low (got '${entry.severity}')`,
    )
  }

  // repro_steps
  if (!Array.isArray(entry.repro_steps)) {
    pushErr(
      errors,
      index,
      'repro_steps',
      "missing or non-array 'repro_steps' (expected string[])",
    )
  } else if (!isStringArray(entry.repro_steps)) {
    pushErr(
      errors,
      index,
      'repro_steps',
      "'repro_steps' contains non-string entries",
    )
  } else if (entry.repro_steps.length === 0) {
    pushErr(errors, index, 'repro_steps', "'repro_steps' must be non-empty")
  }

  // observed
  if (typeof entry.observed !== 'string' || entry.observed.length === 0) {
    pushErr(
      errors,
      index,
      'observed',
      "missing or empty 'observed' (must be non-empty string)",
    )
  }

  // expected
  if (typeof entry.expected !== 'string' || entry.expected.length === 0) {
    pushErr(
      errors,
      index,
      'expected',
      "missing or empty 'expected' (must be non-empty string)",
    )
  }

  // env
  if (!isPlainObject(entry.env)) {
    pushErr(errors, index, 'env', "missing or non-object 'env'")
  }

  // evidence_path
  if (
    typeof entry.evidence_path !== 'string' ||
    entry.evidence_path.length === 0
  ) {
    pushErr(
      errors,
      index,
      'evidence_path',
      "missing or non-string 'evidence_path'",
    )
  } else if (!evidenceExists(entry.evidence_path)) {
    pushErr(
      errors,
      index,
      'evidence_path',
      `'evidence_path' does not exist on disk: ${entry.evidence_path}`,
    )
  }

  // cycle
  if (typeof entry.cycle !== 'number' || !Number.isInteger(entry.cycle)) {
    pushErr(
      errors,
      index,
      'cycle',
      "missing or non-integer 'cycle' (expected number ≥ 1)",
    )
  } else if (entry.cycle < 1) {
    pushErr(errors, index, 'cycle', `'cycle' must be ≥ 1 (got ${entry.cycle})`)
  }
}

/**
 * Validate a parsed `bugs.json` value (must be an array). Returns a
 * `ValidationResult` with diagnostics; the caller decides how to surface them.
 */
export function validateBugReport(
  parsed: unknown,
  options: ValidateOptions = {},
): ValidationResult {
  const errors: ValidationError[] = []
  const evidenceExists = options.evidenceExists ?? defaultEvidenceExists

  if (!Array.isArray(parsed)) {
    pushErr(errors, -1, '', 'top-level value must be a JSON array')
    return { ok: false, errors }
  }

  // Empty array is explicitly valid (see schema doc — no bugs found is OK).
  for (let i = 0; i < parsed.length; i++) {
    validateEntry(parsed[i], i, errors, evidenceExists)
  }

  return { ok: errors.length === 0, errors }
}

function defaultEvidenceExists(path: string): boolean {
  if (!existsSync(path)) return false
  try {
    // Permit any kind of file (regular file, dir, symlink target). The schema
    // only requires the path to exist.
    statSync(path)
    return true
  } catch {
    return false
  }
}

export function formatErrors(errors: ValidationError[]): string {
  return errors
    .map((e) => {
      const where =
        e.index < 0
          ? '(top-level)'
          : e.field
            ? `entry[${e.index}].${e.field}`
            : `entry[${e.index}]`
      return `  - ${where}: ${e.message}`
    })
    .join('\n')
}

async function main(): Promise<number> {
  const path = process.argv[2]
  if (!path) {
    console.error('usage: bun scripts/validate-bug-report.ts <path/to/bugs.json>')
    return 2
  }

  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`validate-bug-report: cannot read ${path}: ${msg}`)
    return 2
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`validate-bug-report: ${path} is not valid JSON: ${msg}`)
    return 2
  }

  const result = validateBugReport(parsed)
  if (!result.ok) {
    console.error(`validate-bug-report: ${path} failed schema validation:`)
    console.error(formatErrors(result.errors))
    return 1
  }

  // Quiet on success — exit 0 says it all. Print count for human readers.
  const count = Array.isArray(parsed) ? parsed.length : 0
  console.log(`validate-bug-report: ${path} OK (${count} entr${count === 1 ? 'y' : 'ies'})`)
  return 0
}

if (import.meta.main) {
  main().then((code) => process.exit(code))
}
