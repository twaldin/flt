import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'

const SAFE_ID = /^[a-zA-Z0-9_-]+$/

type Verdict = 'pass' | 'fail'

type AggregateResult = {
  allDone: boolean
  passers: string[]
  failures: { label: string; reason?: string }[]
}

export function writeResult(
  runDir: string,
  step: string,
  label: string,
  verdict: Verdict,
  failReason?: string,
): void {
  assertSafeId(step, 'step')
  assertSafeId(label, 'label')

  const dir = join(runDir, 'results')
  mkdirSync(dir, { recursive: true })

  const path = join(dir, `${step}-${label}.json`)
  const tmp = `${path}.tmp`
  const result = {
    step,
    label,
    verdict,
    ...(failReason === undefined ? {} : { failReason }),
    at: new Date().toISOString(),
  }

  writeFileSync(tmp, JSON.stringify(result, null, 2) + '\n')
  renameSync(tmp, path)
}

export function aggregateResults(runDir: string, step: string, expectedN: number): AggregateResult {
  const dir = join(runDir, 'results')
  if (!existsSync(dir)) {
    return {
      allDone: false,
      passers: [],
      failures: [],
    }
  }

  const passers: string[] = []
  const failures: { label: string; reason?: string }[] = []
  const stepPattern = new RegExp(`^${escapeRegex(step)}-(.+)\\.json$`)

  for (const file of readdirSync(dir)) {
    if (!stepPattern.test(file)) continue

    try {
      const parsed = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as {
        label?: string
        verdict?: string
        failReason?: string
      }

      if (typeof parsed.label !== 'string') continue
      if (parsed.verdict === 'pass') {
        passers.push(parsed.label)
        continue
      }

      if (parsed.verdict === 'fail') {
        failures.push({
          label: parsed.label,
          ...(typeof parsed.failReason === 'string' ? { reason: parsed.failReason } : {}),
        })
      }
    } catch {}
  }

  passers.sort()
  failures.sort((a, b) => a.label.localeCompare(b.label))

  return {
    allDone: passers.length + failures.length === expectedN,
    passers,
    failures,
  }
}

function assertSafeId(value: string, field: string): void {
  if (!SAFE_ID.test(value)) {
    throw new Error(`${field} must match /^[a-zA-Z0-9_-]+$/`)
  }
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
