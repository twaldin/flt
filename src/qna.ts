import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export interface QuestionOption {
  label: string
  description?: string
  preview?: string
}

export interface Question {
  id: string
  header: string
  question: string
  multiSelect: boolean
  options: QuestionOption[]
  askedBy?: string
}

export interface AskPayload {
  questions: Question[]
}

export interface Answer {
  questionId: string
  selected: string[]
  text?: string
  answeredAt: string
}

export interface QnaRow {
  runId: string
  questionId: string
  question: Question
  answer: Answer | null
  askedAt: string
  ageMs: number
  questionPath: string
  answerPath: string
}

const UNROUTED = '_unrouted'

export function defaultQnaDir(): string {
  return join(homedir(), '.flt', 'qna')
}

export function qnaRunDir(qnaDir: string, runId: string | undefined): string {
  return join(qnaDir, runId && runId.length > 0 ? runId : UNROUTED)
}

export function questionPath(qnaDir: string, runId: string | undefined, questionId: string): string {
  return join(qnaRunDir(qnaDir, runId), `${questionId}.question.json`)
}

export function answerPath(qnaDir: string, runId: string | undefined, questionId: string): string {
  return join(qnaRunDir(qnaDir, runId), `${questionId}.answer.json`)
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return null
  }
}

export function scanQna(qnaDir: string = defaultQnaDir()): QnaRow[] {
  const rows: QnaRow[] = []
  if (!existsSync(qnaDir)) return rows

  let runDirs: string[]
  try {
    runDirs = readdirSync(qnaDir)
  } catch {
    return rows
  }

  for (const runId of runDirs) {
    const runDir = join(qnaDir, runId)
    let entries: string[]
    try {
      entries = readdirSync(runDir)
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.endsWith('.question.json')) continue
      const questionId = entry.slice(0, -'.question.json'.length)
      const qPath = join(runDir, entry)
      const aPath = join(runDir, `${questionId}.answer.json`)

      const question = readJson<Question>(qPath)
      if (!question) continue

      const answer = existsSync(aPath) ? readJson<Answer>(aPath) : null

      let askedAt: string
      let mtime: number
      try {
        const stat = statSync(qPath)
        mtime = stat.mtime.getTime()
        askedAt = stat.mtime.toISOString()
      } catch {
        continue
      }

      rows.push({
        runId: runId === UNROUTED ? '' : runId,
        questionId,
        question,
        answer,
        askedAt,
        ageMs: Date.now() - mtime,
        questionPath: qPath,
        answerPath: aPath,
      })
    }
  }

  return rows
}

export function pendingQna(qnaDir: string = defaultQnaDir()): QnaRow[] {
  return scanQna(qnaDir).filter(row => row.answer === null)
}

function summarizeAnswer(answer: Answer): string {
  const parts: string[] = []
  if (answer.selected.length > 0) parts.push(answer.selected.join(', '))
  if (answer.text && answer.text.trim().length > 0) parts.push(`"${answer.text}"`)
  return parts.length > 0 ? parts.join(' + ') : '(skipped)'
}

export interface WriteAnswerOptions {
  qnaDir?: string
  runId?: string
  notify?: boolean
}

/**
 * Single source of truth for writing an answer file. Reads the matching
 * question (to recover askedBy), writes the answer, then optionally
 * dispatches a `flt send` to the asking agent so the agent sees the
 * answer in their tmux feed (not just in their stdout when askHuman
 * unblocks).
 *
 * Notification is best-effort — failures don't propagate.
 */
export async function writeAnswer(
  questionId: string,
  selected: string[],
  text: string | undefined,
  opts: WriteAnswerOptions = {},
): Promise<{ answer: Answer; notified: string | null }> {
  const dir = opts.qnaDir ?? defaultQnaDir()
  const runDir = qnaRunDir(dir, opts.runId)
  if (!existsSync(runDir)) mkdirSync(runDir, { recursive: true })
  const qPath = questionPath(dir, opts.runId, questionId)
  const aPath = answerPath(dir, opts.runId, questionId)

  const answer: Answer = {
    questionId,
    selected,
    text,
    answeredAt: new Date().toISOString(),
  }
  writeFileSync(aPath, JSON.stringify(answer, null, 2))

  let notified: string | null = null
  if (opts.notify !== false) {
    try {
      const q = JSON.parse(readFileSync(qPath, 'utf-8')) as Question
      if (q.askedBy && q.askedBy.length > 0) {
        const { sendDirect } = await import('./commands/send')
        const summary = summarizeAnswer(answer)
        const message = `human answered ${questionId}: ${summary}`
        try {
          await sendDirect({
            target: q.askedBy,
            message,
            _caller: { mode: 'agent', agentName: 'flt-qna', depth: 0 } as Parameters<typeof sendDirect>[0]['_caller'],
          })
          notified = q.askedBy
        } catch {
          // best-effort
        }
      }
    } catch {
      // can't read question — skip notification
    }
  }

  return { answer, notified }
}
