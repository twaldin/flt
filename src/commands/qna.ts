import { homedir } from 'os'
import { defaultQnaDir, scanQna, writeAnswer, type QnaRow } from '../qna'

function fmtAge(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 3)}...` : s
}

function selectRows(rows: QnaRow[], opts: { runId?: string; sinceMs?: number }): QnaRow[] {
  let filtered = rows
  if (opts.runId !== undefined) filtered = filtered.filter(r => r.runId === opts.runId)
  if (opts.sinceMs !== undefined) filtered = filtered.filter(r => r.ageMs <= (opts.sinceMs ?? 0))
  return filtered.slice().sort((a, b) => a.ageMs - b.ageMs)
}

export interface QnaListOptions {
  qnaDir?: string
  json?: boolean
  pendingOnly?: boolean
  runId?: string
}

export function qnaList(opts: QnaListOptions = {}): void {
  const dir = opts.qnaDir ?? defaultQnaDir()
  let rows = scanQna(dir)
  if (opts.pendingOnly) rows = rows.filter(r => r.answer === null)
  rows = selectRows(rows, { runId: opts.runId })

  if (opts.json) {
    console.log(JSON.stringify(rows, null, 2))
    return
  }
  console.log('AGE\tRUN\tQUESTION\tANSWER\tASKED')
  for (const r of rows) {
    const ans = r.answer
      ? r.answer.text ?? r.answer.selected.join(',')
      : '(pending)'
    console.log(
      `${fmtAge(r.ageMs)}\t${r.runId || '-'}\t${truncate(r.question.question, 60)}\t${truncate(ans, 40)}\t${r.askedAt}`,
    )
  }
}

export interface QnaShowOptions {
  qnaDir?: string
  runId?: string
  questionId: string
}

export function qnaShow(opts: QnaShowOptions): void {
  const dir = opts.qnaDir ?? defaultQnaDir()
  const rows = scanQna(dir)
  const target = opts.runId !== undefined
    ? rows.find(r => r.runId === opts.runId && r.questionId === opts.questionId)
    : rows.find(r => r.questionId === opts.questionId)
  if (!target) {
    console.error(`Question not found: ${opts.questionId}`)
    process.exit(1)
  }
  console.log(JSON.stringify({
    runId: target.runId,
    questionId: target.questionId,
    askedAt: target.askedAt,
    question: target.question,
    answer: target.answer,
  }, null, 2))
}

export interface QnaExportOptions {
  qnaDir?: string
  format?: 'jsonl' | 'json'
  sinceMs?: number
  pendingOnly?: boolean
}

export function qnaExport(opts: QnaExportOptions = {}): void {
  const dir = opts.qnaDir ?? opts.qnaDir ?? defaultQnaDir()
  let rows = scanQna(dir)
  if (opts.pendingOnly) rows = rows.filter(r => r.answer === null)
  rows = selectRows(rows, { sinceMs: opts.sinceMs })
  const format = opts.format ?? 'jsonl'

  if (format === 'json') {
    console.log(JSON.stringify(rows, null, 2))
    return
  }
  for (const r of rows) {
    console.log(JSON.stringify({
      runId: r.runId,
      questionId: r.questionId,
      askedAt: r.askedAt,
      question: r.question,
      answer: r.answer,
    }))
  }
}

export interface QnaAnswerOptions {
  qnaDir?: string
  runId?: string
  questionId: string
  selected: string[]
  text?: string
}

export async function qnaAnswer(opts: QnaAnswerOptions): Promise<void> {
  const result = await writeAnswer(
    opts.questionId,
    opts.selected,
    opts.text,
    { qnaDir: opts.qnaDir, runId: opts.runId, notify: true },
  )
  if (result.notified) {
    console.log(`Answered ${opts.questionId}; notified ${result.notified}`)
  } else {
    console.log(`Answered ${opts.questionId}`)
  }
}

void homedir
void defaultQnaDir
