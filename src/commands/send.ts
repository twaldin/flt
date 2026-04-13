import { getAgent, loadState } from '../state'
import { resolveAdapter } from '../adapters/registry'
import * as tmux from '../tmux'
import { detectCaller } from '../detect'
import { appendInbox } from './init'

interface SendArgs {
  target: string
  message: string
}

export async function send(args: SendArgs): Promise<void> {
  const { target, message } = args
  const caller = detectCaller()

  let session: string
  let submitKeys: string[] = ['Enter']
  let isHumanParent = false

  if (target === 'parent') {
    if (caller.mode !== 'agent') {
      throw new Error('Cannot send to "parent" — not running as a fleet agent.')
    }

    if (!caller.parentSession) {
      throw new Error('No parent session found (FLT_PARENT_SESSION not set).')
    }

    const state = loadState()
    const orchSession = state.orchestrator?.tmuxSession

    // If direct parent IS the human orchestrator session → inbox only
    if (state.orchestrator?.type === 'human' && caller.parentSession === orchSession) {
      isHumanParent = true
      session = orchSession
    } else {
      // Direct parent is an agent (e.g. cairn). Send to that agent's tmux session
      // AND bubble a copy to the human inbox so Tim sees it too.
      session = caller.parentSession
      if (state.orchestrator?.type === 'human') {
        appendInbox(caller.agentName ?? 'agent', message)
      }
    }
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
    } catch {}
  }

  // Verify session is alive (skip for human parent — inbox is file-based)
  if (!isHumanParent && !tmux.hasSession(session)) {
    throw new Error(`Target session "${session}" is not running.`)
  }

  // Determine sender label
  const senderName = caller.agentName ?? (caller.mode === 'human' ? 'tim' : 'unknown')

  if (isHumanParent) {
    // Write to inbox log — human's `flt init` tails this file
    appendInbox(senderName, message)
  } else {
    // Prepend [SENDER]: so the receiving agent knows who sent the message
    const tagged = `[${senderName.toUpperCase()}]: ${message}`
    if (tagged.length > 200 || tagged.includes('\n')) {
      tmux.pasteBuffer(session, tagged)
    } else {
      tmux.sendLiteral(session, tagged)
    }
    await sleep(300)
    tmux.sendKeys(session, submitKeys)
  }

  // Only log when running as standalone CLI, not inside the TUI
  if (caller.mode === 'human' && !process.env.FLT_TUI_ACTIVE) {
    console.log(`Sent to ${target}`)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
