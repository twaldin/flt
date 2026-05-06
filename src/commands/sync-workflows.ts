import { createHash } from 'crypto'
import { readdirSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
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

export type StaleWorkflowKind = 'clean-update' | 'three-way-conflict' | 'first-sync-needed'

export interface StaleWorkflow {
  file: string
  kind: StaleWorkflowKind
  bundledHash: string
  installedHash?: string
  lastSyncHash?: string
}

interface SyncState {
  version: number
  files: Record<string, string>
}

function syncStatePath(installDir: string): string {
  return join(installDir, '.sync-state.json')
}

function sha256Hex(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function readSyncState(installDir: string): SyncState {
  const p = syncStatePath(installDir)
  if (!existsSync(p)) return { version: 1, files: {} }

  try {
    const parsed = JSON.parse(readFileSync(p, 'utf-8')) as SyncState
    if (typeof parsed.version === 'number' && parsed.files && typeof parsed.files === 'object') {
      return parsed
    }
  } catch {}

  return { version: 1, files: {} }
}

function writeSyncState(installDir: string, state: SyncState): void {
  writeFileSync(syncStatePath(installDir), JSON.stringify(state, null, 2))
}

function workflowFiles(dir: string): string[] {
  return readdirSync(dir).filter(n => n.endsWith('.yaml') || n.endsWith('.yml'))
}

export function detectStaleWorkflows(opts?: { tplDir?: string; installDir?: string }): StaleWorkflow[] {
  const tplDir = opts?.tplDir ?? templateWorkflowsDir()
  const installDir = opts?.installDir ?? installedWorkflowsDir()

  if (!existsSync(tplDir) || !existsSync(installDir)) return []

  const state = readSyncState(installDir)
  const stale: StaleWorkflow[] = []

  for (const f of workflowFiles(tplDir)) {
    const installPath = join(installDir, f)
    if (!existsSync(installPath)) continue

    const bundledHash = sha256Hex(readFileSync(join(tplDir, f), 'utf-8'))
    const installedHash = sha256Hex(readFileSync(installPath, 'utf-8'))
    const lastSyncHash = state.files[f]

    if (lastSyncHash === undefined) {
      if (installedHash !== bundledHash) {
        stale.push({ file: f, kind: 'first-sync-needed', bundledHash, installedHash })
      }
      continue
    }

    const installedMatchesLastSync = installedHash === lastSyncHash
    const bundledMatchesLastSync = bundledHash === lastSyncHash

    if (installedMatchesLastSync && !bundledMatchesLastSync) {
      stale.push({ file: f, kind: 'clean-update', bundledHash, installedHash, lastSyncHash })
    } else if (!installedMatchesLastSync && !bundledMatchesLastSync) {
      stale.push({ file: f, kind: 'three-way-conflict', bundledHash, installedHash, lastSyncHash })
    }
  }

  return stale
}

export function warnIfWorkflowsStale(opts?: { tplDir?: string; installDir?: string }): void {
  const stale = detectStaleWorkflows(opts)
  const needsAttention = stale.filter(s => s.kind === 'three-way-conflict' || s.kind === 'first-sync-needed')

  if (needsAttention.length > 0) {
    process.stderr.write(
      `flt: ${needsAttention.length} workflow conflict${needsAttention.length === 1 ? '' : 's'} need attention — run 'flt sync-workflows' to review\n`,
    )
  }
}

interface SyncWorkflowsOpts {
  force?: boolean
  fltDir?: string
  tplDir?: string
  ask?: (question: string) => Promise<string>
}

export async function syncWorkflows(opts: SyncWorkflowsOpts = {}): Promise<void> {
  const tplDir = opts.tplDir ?? templateWorkflowsDir()
  const installDir = installedWorkflowsDir(opts.fltDir)

  if (!existsSync(tplDir)) {
    console.error('No bundled workflow templates found')
    return
  }

  mkdirSync(installDir, { recursive: true })

  const files = workflowFiles(tplDir)
  const state = readSyncState(installDir)

  const rl = opts.force || opts.ask ? null : createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q: string): Promise<string> => {
    if (opts.ask) return opts.ask(q)
    return new Promise(resolve => rl!.question(q, resolve))
  }

  let copied = 0
  let skipped = 0

  for (const f of files) {
    const src = join(tplDir, f)
    const dst = join(installDir, f)
    const srcContent = readFileSync(src, 'utf-8')
    const bundledHash = sha256Hex(srcContent)

    if (!existsSync(dst)) {
      copyFileSync(src, dst)
      state.files[f] = bundledHash
      console.log(`  copied  ${f}`)
      copied++
      continue
    }

    const dstContent = readFileSync(dst, 'utf-8')
    if (srcContent === dstContent) {
      state.files[f] = bundledHash
      skipped++
      continue
    }

    if (opts.force) {
      copyFileSync(src, dst)
      state.files[f] = bundledHash
      console.log(`  updated ${f}`)
      copied++
    } else {
      const answer = await ask(`  overwrite ${f}? (y/N) `)
      if (answer.trim().toLowerCase() === 'y') {
        copyFileSync(src, dst)
        state.files[f] = bundledHash
        console.log(`  updated ${f}`)
        copied++
      } else {
        console.log(`  skipped ${f}`)
        skipped++
      }
    }
  }

  writeSyncState(installDir, state)
  rl?.close()
  console.log(`sync-workflows: ${copied} updated, ${skipped} unchanged`)
}
