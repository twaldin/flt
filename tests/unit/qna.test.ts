import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  answerPath,
  pendingQna,
  qnaRunDir,
  questionPath,
  scanQna,
  type Answer,
  type Question,
} from '../../src/qna'

const SAMPLE_Q: Question = {
  id: 'q-abc',
  header: 'Choice',
  question: 'Pick one',
  multiSelect: false,
  options: [
    { label: 'left' },
    { label: 'right' },
  ],
}

function writeQuestion(qnaDir: string, runId: string | undefined, q: Question): string {
  const dir = qnaRunDir(qnaDir, runId)
  mkdirSync(dir, { recursive: true })
  const p = questionPath(qnaDir, runId, q.id)
  writeFileSync(p, JSON.stringify(q))
  return p
}

function writeAnswer(qnaDir: string, runId: string | undefined, a: Answer): string {
  const dir = qnaRunDir(qnaDir, runId)
  mkdirSync(dir, { recursive: true })
  const p = answerPath(qnaDir, runId, a.questionId)
  writeFileSync(p, JSON.stringify(a))
  return p
}

describe('qna', () => {
  let qnaDir = ''

  beforeEach(() => {
    qnaDir = mkdtempSync(join(tmpdir(), 'flt-qna-test-'))
  })

  afterEach(() => {
    rmSync(qnaDir, { recursive: true, force: true })
  })

  it('scanQna returns empty for empty dir', () => {
    expect(scanQna(qnaDir)).toEqual([])
  })

  it('scanQna surfaces a pending question', () => {
    writeQuestion(qnaDir, 'run-1', SAMPLE_Q)
    const rows = scanQna(qnaDir)
    expect(rows.length).toBe(1)
    expect(rows[0].runId).toBe('run-1')
    expect(rows[0].questionId).toBe('q-abc')
    expect(rows[0].question.header).toBe('Choice')
    expect(rows[0].answer).toBeNull()
  })

  it('scanQna pairs a question with its answer', () => {
    writeQuestion(qnaDir, 'run-1', SAMPLE_Q)
    const ans: Answer = {
      questionId: SAMPLE_Q.id,
      selected: ['left'],
      answeredAt: new Date().toISOString(),
    }
    writeAnswer(qnaDir, 'run-1', ans)

    const rows = scanQna(qnaDir)
    expect(rows.length).toBe(1)
    expect(rows[0].answer?.selected).toEqual(['left'])
  })

  it('scanQna handles unrouted (no run-id) questions', () => {
    writeQuestion(qnaDir, undefined, SAMPLE_Q)
    const rows = scanQna(qnaDir)
    expect(rows.length).toBe(1)
    expect(rows[0].runId).toBe('')
  })

  it('pendingQna filters out answered rows', () => {
    writeQuestion(qnaDir, 'run-1', SAMPLE_Q)
    const answered: Question = { ...SAMPLE_Q, id: 'q-done' }
    writeQuestion(qnaDir, 'run-1', answered)
    writeAnswer(qnaDir, 'run-1', {
      questionId: 'q-done',
      selected: ['right'],
      answeredAt: new Date().toISOString(),
    })

    const pending = pendingQna(qnaDir)
    expect(pending.length).toBe(1)
    expect(pending[0].questionId).toBe('q-abc')
  })

  it('scanQna skips malformed question files', () => {
    const dir = qnaRunDir(qnaDir, 'run-1')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'bogus.question.json'), '{not json')
    writeQuestion(qnaDir, 'run-1', SAMPLE_Q)

    const rows = scanQna(qnaDir)
    expect(rows.length).toBe(1)
    expect(rows[0].questionId).toBe('q-abc')
  })

  it('ageMs is non-negative', () => {
    writeQuestion(qnaDir, 'run-1', SAMPLE_Q)
    const rows = scanQna(qnaDir)
    expect(rows[0].ageMs).toBeGreaterThanOrEqual(0)
  })
})
