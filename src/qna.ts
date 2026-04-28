import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
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
