import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { parse } from 'yaml'
import { getPreset } from '../presets'
import { resolveModelForCli } from '../model-resolution'
import { smokeModelCached } from '../model-resolution-smoke'

export type RouteCheckRowStatus = 'OK' | 'FAIL' | 'WARN' | 'SKIP'

export interface RouteCheckRow {
  role: string
  preset: string
  cli?: string
  model?: string
  resolvedModel?: string
  status: RouteCheckRowStatus
  notes: string
  durationMs?: number
}

export interface RouteCheckResult {
  rows: RouteCheckRow[]
  hasFailures: boolean
}

export interface RouteCheckOptions {
  force?: boolean
  json?: boolean
  smoke?: (input: { cli: string; model: string; force?: boolean }) => Promise<{
    ok: boolean
    exitCode: number
    durationMs: number
    reason?: string
    stderr?: string
  }>
}

function fltHome(): string {
  return join(process.env.HOME || homedir(), '.flt')
}

function loadPolicy(): Record<string, string> {
  const path = join(fltHome(), 'routing', 'policy.yaml')
  if (!existsSync(path)) {
    throw new Error(`Routing policy not found at ${path}. Run "flt init" first.`)
  }
  return parse(readFileSync(path, 'utf-8')) as Record<string, string>
}

export async function routeCheck(opts: RouteCheckOptions = {}): Promise<RouteCheckResult> {
  const { force = false, smoke = smokeModelCached } = opts
  const policy = loadPolicy()
  const rows: RouteCheckRow[] = []

  for (const [role, presetName] of Object.entries(policy)) {
    const preset = getPreset(presetName)
    if (!preset) {
      rows.push({
        role,
        preset: presetName,
        status: 'WARN',
        notes: `preset "${presetName}" not in presets.json`,
      })
      continue
    }

    const cli = preset.cli
    const model = preset.model

    if (!model) {
      rows.push({
        role,
        preset: presetName,
        cli,
        status: 'WARN',
        notes: 'preset has no model field',
      })
      continue
    }

    let resolvedModel: string | undefined
    try {
      resolvedModel = resolveModelForCli(cli, model)
    } catch (e) {
      rows.push({
        role,
        preset: presetName,
        cli,
        model,
        status: 'FAIL',
        notes: `resolve error: ${(e as Error).message}`,
      })
      continue
    }

    if (!resolvedModel) {
      rows.push({
        role,
        preset: presetName,
        cli,
        model,
        status: 'FAIL',
        notes: 'model resolved to empty string',
      })
      continue
    }

    const result = await smoke({ cli, model: resolvedModel, force })
    if (result.ok) {
      rows.push({
        role,
        preset: presetName,
        cli,
        model,
        resolvedModel,
        status: 'OK',
        notes: result.reason ?? `accepted in ${result.durationMs}ms`,
        durationMs: result.durationMs,
      })
    } else {
      rows.push({
        role,
        preset: presetName,
        cli,
        model,
        resolvedModel,
        status: 'FAIL',
        notes: result.reason ?? `exit ${result.exitCode}`,
        durationMs: result.durationMs,
      })
    }
  }

  const hasFailures = rows.some((r) => r.status === 'FAIL')
  return { rows, hasFailures }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length)
}

export function formatRouteCheckTable(result: RouteCheckResult): string {
  const headers = ['role', 'preset', 'cli', 'model', 'resolved', 'status', 'notes']
  const rows = result.rows.map((r) => [
    r.role,
    r.preset,
    r.cli ?? '-',
    r.model ?? '-',
    r.resolvedModel ?? '-',
    r.status,
    r.notes,
  ])
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)))
  const lines: string[] = []
  lines.push(headers.map((h, i) => pad(h, widths[i])).join('  '))
  lines.push(widths.map((w) => '-'.repeat(w)).join('  '))
  for (const row of rows) {
    lines.push(row.map((c, i) => pad(c, widths[i])).join('  '))
  }
  return lines.join('\n')
}

export async function runRouteCheck(opts: RouteCheckOptions): Promise<{ exitCode: number }> {
  const result = await routeCheck(opts)
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(formatRouteCheckTable(result))
    const ok = result.rows.filter((r) => r.status === 'OK').length
    const warn = result.rows.filter((r) => r.status === 'WARN').length
    const fail = result.rows.filter((r) => r.status === 'FAIL').length
    console.log(`\n${ok} OK · ${warn} WARN · ${fail} FAIL`)
  }
  return { exitCode: result.hasFailures ? 1 : 0 }
}
