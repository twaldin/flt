import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import type { AgentState } from '../../src/state'
import * as adapters from '../../src/adapters/registry'
import { sendDirect } from '../../src/commands/send'
import * as delivery from '../../src/delivery'
import * as state from '../../src/state'
import * as tmux from '../../src/tmux'

const mockAgent: AgentState = {
  cli: 'codex',
  model: 'gpt-5.3-codex',
  tmuxSession: 'flt-some-agent',
  parentName: 'human',
  dir: '/tmp/agent',
  spawnedAt: '2026-05-04T00:00:00.000Z',
}

describe('sendDirect uses delivery indirection', () => {
  afterEach(() => {
    mock.restore()
  })

  it('calls deliver with the target AgentState and deliverKeys with adapter submit keys', async () => {
    const adapter = adapters.resolveAdapter('codex')

    spyOn(state, 'getAgent').mockReturnValue(mockAgent)
    spyOn(tmux, 'hasSession').mockReturnValue(true)

    const deliverSpy = spyOn(delivery, 'deliver').mockImplementation(() => {})
    const deliverKeysSpy = spyOn(delivery, 'deliverKeys').mockImplementation(() => {})

    await sendDirect({
      target: 'someAgent',
      message: 'hi',
      _caller: { mode: 'agent', agentName: 'sender', depth: 0 },
    })

    expect(deliverSpy).toHaveBeenCalledTimes(1)
    expect(deliverKeysSpy).toHaveBeenCalledTimes(1)

    const [deliverAgent, deliverText] = deliverSpy.mock.calls[0] as [AgentState, string]
    expect(deliverAgent).toBe(mockAgent)
    expect(deliverText).toBe('[SENDER]: hi')

    const [keysAgent, keys] = deliverKeysSpy.mock.calls[0] as [AgentState, string[]]
    expect(keysAgent).toBe(mockAgent)
    expect(keys).toEqual(adapter.submitKeys)
  })
})
