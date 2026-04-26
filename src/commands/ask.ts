import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { resolveRoute } from '../routing/resolver'
import { spawnDirect } from './spawn'
import { killDirect } from './kill'

type AskOptions = {
  from?: string
  timeoutMs?: number
}

type TestHooks = {
  spawnFn?: typeof spawnDirect
  killFn?: typeof killDirect
}

let _testHooks: TestHooks = {}

export function _setAskOracleTestHooks(hooks: TestHooks): void {
  _testHooks = hooks
}

export async function askOracle(question: string, opts?: AskOptions): Promise<string | null> {
  const caller = opts?.from ?? 'human'
  const route = resolveRoute('oracle')
  const oracleName = `oracle-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const bootstrap = `Question from "${caller}":\n\n${question}\n\nWhen you have a focused answer, run:\n  flt send ${caller} "<your reply>"\nThen stop. Do not write code. Do not modify files. Just answer.\n`

  const spawnFn = _testHooks.spawnFn ?? spawnDirect
  const killFn = _testHooks.killFn ?? killDirect
  const inboxPath = join(process.env.HOME || homedir(), '.flt', 'inbox.log')

  await spawnFn({
    name: oracleName,
    preset: route.preset,
    dir: process.cwd(),
    worktree: false,
    parent: caller,
    bootstrap,
  })

  if (caller !== 'human') {
    console.log(`Oracle ${oracleName} spawned; reply will arrive in your session.`)
    return null
  }

  try {
    const baseline = readInbox(inboxPath)
    const timeoutMs = opts?.timeoutMs ?? 300_000
    const deadline = Date.now() + timeoutMs
    const tag = `[${oracleName.toUpperCase()}]:`

    while (Date.now() < deadline) {
      await sleep(500)
      const full = readInbox(inboxPath)
      const appended = full.slice(baseline.length)
      const line = appended
        .split('\n')
        .find((entry) => entry.includes(tag))

      if (!line) continue

      const idx = line.indexOf(tag)
      const message = idx >= 0 ? line.slice(idx + tag.length).trimStart() : line
      console.log(message)
      return message
    }

    console.error('Oracle did not reply within timeout. Killing.')
    return null
  } finally {
    try {
      killFn({ name: oracleName })
    } catch {
      // best-effort cleanup
    }
  }
}

function readInbox(path: string): string {
  if (!existsSync(path)) return ''
  return readFileSync(path, 'utf-8')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
