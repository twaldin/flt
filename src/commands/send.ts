import { getAgent, loadState } from '../state'
import { resolveAdapter } from '../adapters/registry'
import * as tmux from '../tmux'
import { detectCaller } from '../detect'

interface SendArgs {
  target: string
  message: string
}

export async function send(args: SendArgs): Promise<void> {
  const { target, message } = args
  const caller = detectCaller()

  let session: string
  let submitKeys: string[] = ['Enter']

  if (target === 'parent') {
    if (caller.mode !== 'agent') {
      throw new Error('Cannot send to "parent" — not running as a fleet agent.')
    }
    if (!caller.parentSession) {
      throw new Error('No parent session found (FLT_PARENT_SESSION not set).')
    }
    session = caller.parentSession
    // Parent could be any CLI — use Enter as default submit
  } else {
    const agent = getAgent(target)
    if (!agent) {
      throw new Error(`Agent "${target}" not found. Run "flt list" to see active agents.`)
    }
    session = agent.tmuxSession

    // Get the target's adapter for correct submit keys
    try {
      const adapter = resolveAdapter(agent.cli)
      submitKeys = adapter.submitKeys
    } catch {
      // Fallback to Enter
    }
  }

  // Verify session is alive
  if (!tmux.hasSession(session)) {
    throw new Error(`Target session "${session}" is not running.`)
  }

  // Send message
  if (message.length > 200 || message.includes('\n')) {
    tmux.pasteBuffer(session, message)
  } else {
    tmux.sendLiteral(session, message)
  }

  await sleep(300)
  tmux.sendKeys(session, submitKeys)

  if (caller.mode === 'human') {
    console.log(`Sent to ${target}`)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
