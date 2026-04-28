import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { askHuman } from '../../src/commands/ask'
import { answerPath, questionPath, qnaRunDir, type Answer, type AskPayload } from '../../src/qna'

function makePayload(): AskPayload {
  return {
    questions: [
      {
        id: 'q1',
        header: 'Pick',
        question: 'A or B?',
        multiSelect: false,
        options: [{ label: 'a' }, { label: 'b' }],
      },
    ],
  }
}

describe('askHuman', () => {
  let qnaDir = ''

  beforeEach(() => {
    qnaDir = mkdtempSync(join(tmpdir(), 'flt-ask-human-'))
  })

  afterEach(() => {
    rmSync(qnaDir, { recursive: true, force: true })
  })

  it('writes a question file then resolves once an answer file is written', async () => {
    const payload = makePayload()
    const promise = askHuman(payload, { qnaDir, runId: 'run-x', timeoutMs: 5000, pollMs: 50 })

    // simulate human answering after a short delay
    setTimeout(() => {
      const ans: Answer = {
        questionId: 'q1',
        selected: ['a'],
        answeredAt: new Date().toISOString(),
      }
      writeFileSync(answerPath(qnaDir, 'run-x', 'q1'), JSON.stringify(ans))
    }, 100)

    const result = await promise
    expect(result.status).toBe('ok')
    expect(result.answers.length).toBe(1)
    expect(result.answers[0].selected).toEqual(['a'])

    // question file persisted
    expect(existsSync(questionPath(qnaDir, 'run-x', 'q1'))).toBe(true)
  })

  it('returns timeout when no answer arrives', async () => {
    const result = await askHuman(makePayload(), { qnaDir, runId: 'run-x', timeoutMs: 200, pollMs: 50 })
    expect(result.status).toBe('timeout')
    expect(result.answers).toEqual([])
  })

  it('errors on malformed payload', async () => {
    await expect(askHuman({} as unknown as AskPayload, { qnaDir })).rejects.toThrow()
    await expect(askHuman({ questions: [] }, { qnaDir })).rejects.toThrow()
    await expect(askHuman({ questions: [{ id: '', header: '', question: '', multiSelect: false, options: [] }] } as AskPayload, { qnaDir })).rejects.toThrow()
  })

  it('refuses to overwrite existing question id', async () => {
    const payload = makePayload()
    const path = questionPath(qnaDir, 'run-x', 'q1')
    const dir = qnaRunDir(qnaDir, 'run-x')
    require('fs').mkdirSync(dir, { recursive: true })
    writeFileSync(path, '{}')
    await expect(askHuman(payload, { qnaDir, runId: 'run-x', timeoutMs: 100, pollMs: 50 })).rejects.toThrow(/already exists/)
  })

  it('resolves all questions in a multi-question batch', async () => {
    const payload: AskPayload = {
      questions: [
        { id: 'q1', header: 'h1', question: 'one?', multiSelect: false, options: [{ label: 'x' }] },
        { id: 'q2', header: 'h2', question: 'two?', multiSelect: false, options: [{ label: 'y' }] },
      ],
    }
    const promise = askHuman(payload, { qnaDir, runId: 'run-x', timeoutMs: 5000, pollMs: 50 })
    setTimeout(() => {
      writeFileSync(answerPath(qnaDir, 'run-x', 'q1'), JSON.stringify({
        questionId: 'q1',
        selected: ['x'],
        answeredAt: new Date().toISOString(),
      } as Answer))
      writeFileSync(answerPath(qnaDir, 'run-x', 'q2'), JSON.stringify({
        questionId: 'q2',
        selected: ['y'],
        answeredAt: new Date().toISOString(),
      } as Answer))
    }, 100)

    const result = await promise
    expect(result.status).toBe('ok')
    expect(result.answers.map(a => a.questionId)).toEqual(['q1', 'q2'])
  })

  it('preserves answer-order matching question-order even if answer files appear out of order', async () => {
    const payload: AskPayload = {
      questions: [
        { id: 'qA', header: 'h', question: 'a?', multiSelect: false, options: [{ label: '1' }] },
        { id: 'qB', header: 'h', question: 'b?', multiSelect: false, options: [{ label: '2' }] },
      ],
    }
    const promise = askHuman(payload, { qnaDir, timeoutMs: 5000, pollMs: 50 })
    // write B first, A second
    setTimeout(() => {
      writeFileSync(answerPath(qnaDir, undefined, 'qB'), JSON.stringify({
        questionId: 'qB',
        selected: ['2'],
        answeredAt: new Date().toISOString(),
      } as Answer))
    }, 80)
    setTimeout(() => {
      writeFileSync(answerPath(qnaDir, undefined, 'qA'), JSON.stringify({
        questionId: 'qA',
        selected: ['1'],
        answeredAt: new Date().toISOString(),
      } as Answer))
    }, 200)

    const result = await promise
    expect(result.status).toBe('ok')
    expect(result.answers.map(a => a.questionId)).toEqual(['qA', 'qB'])
  })
})

// suppress unused warning
void readFileSync
