import { readdirSync, statSync, copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { createInterface } from 'readline'

function fltHome(): string {
  return join(process.env.HOME ?? homedir(), '.flt')
}

export function templateWorkflowsDir(): string {
  return join(import.meta.dir, '..', '..', 'templates', 'workflows')
}

export function installedWorkflowsDir(fltDir?: string): string {
  return join(fltDir ?? fltHome(), 'workflows')
}

export interface StaleWorkflow {
  file: string
  templateMtimeMs: number
  installedMtimeMs: number
}

export function detectStaleWorkflows(opts?: { tplDir?: string; installDir?: string }): StaleWorkflow[] {
  const tplDir = opts?.tplDir ?? templateWorkflowsDir()
  const installDir = opts?.installDir ?? installedWorkflowsDir()

  if (!existsSync(tplDir) || !existsSync(installDir)) return []

  const stale: StaleWorkflow[] = []
  for (const f of readdirSync(tplDir).filter(n => n.endsWith('.yaml') || n.endsWith('.yml'))) {
    const installPath = join(installDir, f)
    if (!existsSync(installPath)) continue
    const templateMtimeMs = statSync(join(tplDir, f)).mtimeMs
    const installedMtimeMs = statSync(installPath).mtimeMs
    if (templateMtimeMs > installedMtimeMs) {
      stale.push({ file: f, templateMtimeMs, installedMtimeMs })
    }
  }
  return stale
}

export function warnIfWorkflowsStale(opts?: { tplDir?: string; installDir?: string }): void {
  const stale = detectStaleWorkflows(opts)
  if (stale.length > 0) {
    process.stderr.write(
      `flt: ${stale.length} workflow${stale.length === 1 ? '' : 's'} out of date with bundled templates — run 'flt sync-workflows' to update\n`,
    )
  }
}

interface SyncWorkflowsOpts {
  force?: boolean
  fltDir?: string
  tplDir?: string
}

export async function syncWorkflows(opts: SyncWorkflowsOpts = {}): Promise<void> {
  const tplDir = opts.tplDir ?? templateWorkflowsDir()
  const installDir = installedWorkflowsDir(opts.fltDir)

  if (!existsSync(tplDir)) {
    console.error('No bundled workflow templates found')
    return
  }

  mkdirSync(installDir, { recursive: true })

  const files = readdirSync(tplDir).filter(n => n.endsWith('.yaml') || n.endsWith('.yml'))

  const rl = opts.force ? null : createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q: string): Promise<string> =>
    new Promise(resolve => rl!.question(q, resolve))

  let copied = 0
  let skipped = 0

  for (const f of files) {
    const src = join(tplDir, f)
    const dst = join(installDir, f)

    if (!existsSync(dst)) {
      copyFileSync(src, dst)
      console.log(`  copied  ${f}`)
      copied++
      continue
    }

    const srcContent = readFileSync(src, 'utf-8')
    const dstContent = readFileSync(dst, 'utf-8')
    if (srcContent === dstContent) {
      skipped++
      continue
    }

    if (opts.force) {
      copyFileSync(src, dst)
      console.log(`  updated ${f}`)
      copied++
    } else {
      const answer = await ask(`  overwrite ${f}? (y/N) `)
      if (answer.trim().toLowerCase() === 'y') {
        copyFileSync(src, dst)
        console.log(`  updated ${f}`)
        copied++
      } else {
        console.log(`  skipped ${f}`)
        skipped++
      }
    }
  }

  rl?.close()
  console.log(`sync-workflows: ${copied} updated, ${skipped} unchanged`)
}
