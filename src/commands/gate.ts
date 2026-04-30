import { appendPendingGate } from '../workflow/gates-store'

export function gateOpen(opts: { kind?: string; options?: string; reason?: string; runDir?: string }): void {
  if (!opts.kind) throw new Error('--kind is required')
  if (!opts.options) throw new Error('--options is required')
  if (!opts.reason) throw new Error('--reason is required')
  const runDir = opts.runDir ?? process.env.FLT_RUN_DIR
  if (!runDir) throw new Error('--run-dir is required when FLT_RUN_DIR is not set')

  const parsed = JSON.parse(opts.options) as unknown
  if (!Array.isArray(parsed) || !parsed.every(v => typeof v === 'string')) {
    throw new Error('--options must be a JSON array of strings')
  }

  appendPendingGate(runDir, {
    kind: opts.kind,
    options: parsed,
    reason: opts.reason,
    at: new Date().toISOString(),
  })
  console.log(`Opened gate ${opts.kind} (${parsed.length} options)`)
}
