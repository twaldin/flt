import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getPendingGatesCount } from '../../src/tui/modal-gates'

function makeRunDir(runsDir: string, runId: string): string {
  const runDir = join(runsDir, runId)
  mkdirSync(runDir, { recursive: true })
  writeFileSync(
    join(runDir, 'run.json'),
    JSON.stringify({ id: runId, workflow: 'test', status: 'running' }),
  )
  return runDir
}

function writeGate(runDir: string): void {
  writeFileSync(join(runDir, '.gate-pending'), JSON.stringify([{ kind: 'human_gate' }]))
}

function writeQuestion(qnaDir: string, runId: string, questionId: string, batchId?: string): void {
  const runDir = join(qnaDir, runId)
  mkdirSync(runDir, { recursive: true })
  writeFileSync(
    join(runDir, `${questionId}.question.json`),
    JSON.stringify({
      id: questionId,
      header: 'Q',
      question: 'What?',
      multiSelect: false,
      options: [{ label: 'A' }],
      ...(batchId ? { batchId } : {}),
    }),
  )
}

describe('getPendingGatesCount', () => {
  let testDir: string
  let runsDir: string
  let qnaDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'flt-badge-test-'))
    runsDir = join(testDir, 'runs')
    qnaDir = join(testDir, 'qna')
    mkdirSync(runsDir, { recursive: true })
    mkdirSync(qnaDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test('0 gates and 0 questions -> 0', () => {
    expect(getPendingGatesCount(runsDir, qnaDir)).toBe(0)
  })

  test('1 gate -> 1', () => {
    const runDir = makeRunDir(runsDir, 'run-001')
    writeGate(runDir)
    expect(getPendingGatesCount(runsDir, qnaDir)).toBe(1)
  })

  test('1 batch of 3 questions -> 1', () => {
    writeQuestion(qnaDir, 'run-q1', 'q1', 'batch-abc')
    writeQuestion(qnaDir, 'run-q1', 'q2', 'batch-abc')
    writeQuestion(qnaDir, 'run-q1', 'q3', 'batch-abc')
    expect(getPendingGatesCount(runsDir, qnaDir)).toBe(1)
  })

  test('1 batch of 3 questions + 1 standalone -> 2', () => {
    writeQuestion(qnaDir, 'run-q1', 'q1', 'batch-abc')
    writeQuestion(qnaDir, 'run-q1', 'q2', 'batch-abc')
    writeQuestion(qnaDir, 'run-q1', 'q3', 'batch-abc')
    writeQuestion(qnaDir, 'run-q1', 'q4')
    expect(getPendingGatesCount(runsDir, qnaDir)).toBe(2)
  })
})
