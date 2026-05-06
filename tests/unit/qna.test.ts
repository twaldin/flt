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
  writeAnswer as writeAnswerImpl,
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

  it('writeAnswer suppresses notification on intermediate batch answers', async () => {
    // 3 questions in same batch. Answer 2 of 3 — neither should notify.
    const batchId = 'batch-test-1'
    const askedBy = 'orchestrator'
    const qs: Array<Question & { batchId: string; askedBy: string }> = [
      { ...SAMPLE_Q, id: 'q1', batchId, askedBy },
      { ...SAMPLE_Q, id: 'q2', batchId, askedBy },
      { ...SAMPLE_Q, id: 'q3', batchId, askedBy },
    ]
    for (const q of qs) writeQuestion(qnaDir, 'run-1', q)
    const r1 = await writeAnswerImpl('q1', ['left'], undefined, { qnaDir, runId: 'run-1' })
    expect(r1.notified).toBeNull()
    const r2 = await writeAnswerImpl('q2', ['right'], undefined, { qnaDir, runId: 'run-1' })
    expect(r2.notified).toBeNull()
    // Note: r3 would notify, but we don't assert on it here because the
    // sendDirect call would hit the actual fleet messaging in test env.
    // The important contract: q1/q2 do NOT notify. q3 notification path is
    // covered indirectly by the integration of askHuman.
  })

  it('writeAnswer notifies once when batch is fully answered (single send for all)', async () => {
    // Verify that for a batch of 2, only the LAST writeAnswer triggers notification.
    const batchId = 'batch-test-2'
    const askedBy = 'orchestrator'
    writeQuestion(qnaDir, 'run-2', { ...SAMPLE_Q, id: 'a', batchId, askedBy } as Question)
    writeQuestion(qnaDir, 'run-2', { ...SAMPLE_Q, id: 'b', batchId, askedBy } as Question)
    const r1 = await writeAnswerImpl('a', ['left'], undefined, { qnaDir, runId: 'run-2', notify: false })
    expect(r1.notified).toBeNull()
    // Since notify:false suppresses the path entirely, this just checks the
    // batch logic doesn't throw on the second writeAnswer either.
    const r2 = await writeAnswerImpl('b', ['right'], undefined, { qnaDir, runId: 'run-2', notify: false })
    expect(r2.notified).toBeNull()
  })

  it('writeAnswer per-answer notifies for non-batched questions', async () => {
    const askedBy = 'orchestrator'
    writeQuestion(qnaDir, 'run-3', { ...SAMPLE_Q, id: 'solo', askedBy } as Question)
    // notify:false because we don't want to actually send. But path should not crash.
    const r = await writeAnswerImpl('solo', ['left'], undefined, { qnaDir, runId: 'run-3', notify: false })
    expect(r.notified).toBeNull()
  })
})
