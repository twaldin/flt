import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { resolveRoute } from '../routing/resolver'
import { spawnDirect } from './spawn'
import { killDirect } from './kill'
import {
  answerPath,
  defaultQnaDir,
  qnaRunDir,
  questionPath,
  type Answer,
  type AskPayload,
} from '../qna'

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

export interface AskHumanOptions {
  runId?: string
  timeoutMs?: number
  qnaDir?: string
  pollMs?: number
}

export interface AskHumanResult {
  status: 'ok' | 'timeout'
  answers: Answer[]
}

function validatePayload(payload: unknown): AskPayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('ask human payload must be an object with a `questions` array')
  }
  const obj = payload as Record<string, unknown>
  const questions = obj.questions
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('ask human payload requires `questions: Question[]` (at least one)')
  }
  for (const q of questions) {
    if (!q || typeof q !== 'object') throw new Error('each question must be an object')
    const qq = q as Record<string, unknown>
    if (typeof qq.id !== 'string' || qq.id.length === 0) {
      throw new Error('each question requires a non-empty string id')
    }
    if (typeof qq.question !== 'string' || qq.question.length === 0) {
      throw new Error(`question ${String(qq.id)} requires a non-empty question string`)
    }
    if (!Array.isArray(qq.options)) {
      throw new Error(`question ${String(qq.id)} requires options[]`)
    }
  }
  return payload as AskPayload
}

export async function askHuman(
  payload: AskPayload,
  opts: AskHumanOptions = {},
): Promise<AskHumanResult> {
  validatePayload(payload)
  const qnaDir = opts.qnaDir ?? defaultQnaDir()
  const runId = opts.runId
  const dir = qnaRunDir(qnaDir, runId)
  mkdirSync(dir, { recursive: true })

  for (const q of payload.questions) {
    const qPath = questionPath(qnaDir, runId, q.id)
    if (existsSync(qPath)) {
      throw new Error(`question id "${q.id}" already exists at ${qPath}`)
    }
    writeFileSync(qPath, JSON.stringify(q, null, 2))
  }

  const timeoutMs = opts.timeoutMs ?? 60 * 60 * 1000
  const pollMs = opts.pollMs ?? 1000
  const deadline = Date.now() + timeoutMs
  const expectedIds = new Set(payload.questions.map(q => q.id))
  const collected = new Map<string, Answer>()

  while (Date.now() < deadline) {
    for (const q of payload.questions) {
      if (collected.has(q.id)) continue
      const aPath = answerPath(qnaDir, runId, q.id)
      if (!existsSync(aPath)) continue
      try {
        const ans = JSON.parse(readFileSync(aPath, 'utf-8')) as Answer
        if (ans.questionId === q.id) collected.set(q.id, ans)
      } catch {
        // partial write — try again next tick
      }
    }
    if (collected.size === expectedIds.size) {
      return {
        status: 'ok',
        answers: payload.questions.map(q => collected.get(q.id)!),
      }
    }
    await sleep(pollMs)
  }

  return { status: 'timeout', answers: Array.from(collected.values()) }
}
