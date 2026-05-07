import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { askAgent, formatAskTag } from '../../src/commands/ask'
import { answerAgent } from '../../src/commands/answer'
import {
  agentQnaAnswerFilePath,
  newAgentQnaId,
  readAgentQnaRecord,
} from '../../src/qna'

describe('flt ask <agent> + flt answer (agent-to-agent QnA)', () => {
  let qnaDir = ''
  const sent: Array<{ target: string; message: string; from: string }> = []
  const liveAgents = new Set<string>()

  beforeEach(() => {
    qnaDir = mkdtempSync(join(tmpdir(), 'flt-ask-agent-'))
    sent.length = 0
    liveAgents.clear()
    liveAgents.add('peer')
  })

  afterEach(() => {
    rmSync(qnaDir, { recursive: true, force: true })
  })

  it('happy path: ask delivers tagged message; answer unblocks asker with text', async () => {
    const promise = askAgent('peer', 'what is 2+2?', {
      from: 'asker',
      timeoutMs: 5000,
      pollMs: 50,
      qnaDir,
      sendFn: async (args) => { sent.push(args) },
      agentExistsFn: (name) => liveAgents.has(name),
    })

    // give the asker a tick to write the record + dispatch the send
    await new Promise(r => setTimeout(r, 20))
    expect(sent.length).toBe(1)
    const delivered = sent[0]
    expect(delivered.target).toBe('peer')
    expect(delivered.from).toBe('asker')
    expect(delivered.message.startsWith('[FLT-ASK ')).toBe(true)
    expect(delivered.message).toContain('what is 2+2?')

    // extract qna-id from the tag and submit an answer
    const match = delivered.message.match(/^\[FLT-ASK ([^\]]+)\] /)
    expect(match).not.toBeNull()
    const qnaId = match![1]

    const result = answerAgent(qnaId, { text: '4', qnaDir })
    expect(result.answer).toBe('4')
    expect(result.asker).toBe('asker')
    expect(result.target).toBe('peer')

    const askResult = await promise
    expect(askResult.status).toBe('ok')
    expect(askResult.answer).toBe('4')
    expect(askResult.qnaId).toBe(qnaId)
  })

  it('formatAskTag round-trips qnaId and question', () => {
    const id = newAgentQnaId()
    const tagged = formatAskTag(id, 'hello?')
    expect(tagged).toBe(`[FLT-ASK ${id}] hello?`)
  })

  it('timeout: asker returns timeout status when no answer arrives', async () => {
    const result = await askAgent('peer', 'are you there?', {
      from: 'asker',
      timeoutMs: 200,
      pollMs: 50,
      qnaDir,
      sendFn: async (args) => { sent.push(args) },
      agentExistsFn: (name) => liveAgents.has(name),
    })
    expect(result.status).toBe('timeout')
    expect(result.answer).toBeUndefined()
    // record stays as pending
    const record = readAgentQnaRecord(result.qnaId, qnaDir)
    expect(record).not.toBeNull()
    expect(record!.status).toBe('pending')
  })

  it('missing agent: errors immediately, does not write record or send', async () => {
    await expect(askAgent('ghost', 'hello?', {
      from: 'asker',
      timeoutMs: 5000,
      pollMs: 50,
      qnaDir,
      sendFn: async (args) => { sent.push(args) },
      agentExistsFn: (name) => liveAgents.has(name),
    })).rejects.toThrow(/not addressable/)
    expect(sent.length).toBe(0)
  })

  it('rejects self-asking', async () => {
    liveAgents.add('asker')
    await expect(askAgent('asker', 'talking to myself?', {
      from: 'asker',
      qnaDir,
      sendFn: async () => {},
      agentExistsFn: (name) => liveAgents.has(name),
    })).rejects.toThrow(/cannot ask self/)
  })

  it('--file mode: answer reads body from <qnaDir>/<qnaId>.answer.md', async () => {
    const promise = askAgent('peer', 'long question?', {
      from: 'asker',
      timeoutMs: 5000,
      pollMs: 50,
      qnaDir,
      sendFn: async (args) => { sent.push(args) },
      agentExistsFn: (name) => liveAgents.has(name),
    })

    await new Promise(r => setTimeout(r, 20))
    const match = sent[0].message.match(/^\[FLT-ASK ([^\]]+)\] /)
    const qnaId = match![1]

    const filePath = agentQnaAnswerFilePath(qnaId, qnaDir)
    writeFileSync(filePath, '# Long answer\n\nWith multiple lines.\n')
    answerAgent(qnaId, { file: true, qnaDir })

    const result = await promise
    expect(result.status).toBe('ok')
    expect(result.answer).toContain('Long answer')
    expect(result.answer).toContain('multiple lines')
  })

  it('answer errors on missing id', () => {
    expect(() => answerAgent('does-not-exist', { text: 'x', qnaDir })).toThrow(/not found/)
  })

  it('answer errors on already-resolved id', async () => {
    const promise = askAgent('peer', 'q?', {
      from: 'asker',
      timeoutMs: 5000,
      pollMs: 50,
      qnaDir,
      sendFn: async (args) => { sent.push(args) },
      agentExistsFn: (name) => liveAgents.has(name),
    })
    await new Promise(r => setTimeout(r, 20))
    const qnaId = sent[0].message.match(/^\[FLT-ASK ([^\]]+)\] /)![1]
    answerAgent(qnaId, { text: 'first', qnaDir })
    await promise
    expect(() => answerAgent(qnaId, { text: 'second', qnaDir })).toThrow(/already resolved/)
  })

  it('answer rejects both --file and inline text', async () => {
    const promise = askAgent('peer', 'q?', {
      from: 'asker',
      timeoutMs: 5000,
      pollMs: 50,
      qnaDir,
      sendFn: async (args) => { sent.push(args) },
      agentExistsFn: (name) => liveAgents.has(name),
    })
    await new Promise(r => setTimeout(r, 20))
    const qnaId = sent[0].message.match(/^\[FLT-ASK ([^\]]+)\] /)![1]
    expect(() => answerAgent(qnaId, { file: true, text: 'x', qnaDir })).toThrow(/either --file or inline text/)
    // cleanup
    answerAgent(qnaId, { text: 'cleanup', qnaDir })
    await promise
  })
})
