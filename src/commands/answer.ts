import { existsSync, readFileSync } from 'fs'
import {
  agentQnaAnswerFilePath,
  defaultQnaDir,
  readAgentQnaRecord,
  writeAgentQnaRecord,
} from '../qna'

export interface AnswerOptions {
  /** When true, read answer body from `<qnaDir>/<qnaId>.answer.md`. */
  file?: boolean
  /** Inline answer text (mutually exclusive with `file`). */
  text?: string
  /** Override qna dir (test-only). */
  qnaDir?: string
}

export interface AnswerResult {
  qnaId: string
  asker: string
  target: string
  answer: string
}

export function answerAgent(qnaId: string, opts: AnswerOptions = {}): AnswerResult {
  if (!qnaId || qnaId.length === 0) throw new Error('answer requires a qna-id')
  const qnaDir = opts.qnaDir ?? defaultQnaDir()

  const record = readAgentQnaRecord(qnaId, qnaDir)
  if (!record) throw new Error(`qna-id "${qnaId}" not found`)
  if (record.status === 'answered') {
    throw new Error(`qna-id "${qnaId}" is already resolved`)
  }

  let body: string | undefined
  if (opts.file === true) {
    if (opts.text !== undefined) {
      throw new Error('answer accepts either --file or inline text, not both')
    }
    const filePath = agentQnaAnswerFilePath(qnaId, qnaDir)
    if (!existsSync(filePath)) throw new Error(`answer file not found at ${filePath}`)
    body = readFileSync(filePath, 'utf-8')
  } else {
    if (opts.text === undefined || opts.text.length === 0) {
      throw new Error('answer requires inline text or --file')
    }
    body = opts.text
  }

  record.answer = body
  record.status = 'answered'
  record.resolvedAt = new Date().toISOString()
  writeAgentQnaRecord(record, qnaDir)

  return { qnaId, asker: record.asker, target: record.target, answer: body }
}
