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
  let isHumanParent = false
  let crossSocket = false

  if (target === 'parent') {
    if (caller.mode !== 'agent') {
      throw new Error('Cannot send to "parent" — not running as a fleet agent.')
    }
    if (!caller.parentSession) {
      throw new Error('No parent session found (FLT_PARENT_SESSION not set).')
    }

    const state = loadState()
    session = caller.parentSession

    // If env var session is gone, fall back to state.orchestrator.tmuxSession
    const orchSession = state.orchestrator?.tmuxSession
    if (
      !tmux.hasSession(session) &&
      !tmux.hasSessionOnDefaultSocket(session) &&
      orchSession &&
      orchSession !== session
    ) {
      session = orchSession
    }

    // Determine if target is human (display-message) vs agent CLI (send-keys)
    if (state.orchestrator?.type === 'human') {
      const agentEntry = Object.values(state.agents ?? {}).find(a => a.tmuxSession === session)
      isHumanParent = !agentEntry
    }

    // Resolve which socket the session is on
    if (!tmux.hasSession(session)) {
      if (tmux.hasSessionOnDefaultSocket(session)) {
        crossSocket = true
      } else {
        throw new Error(`Parent session "${session}" is not running on flt or default socket.`)
      }
    }
  } else {
    const agent = getAgent(target)
    if (!agent) {
      throw new Error(`Agent "${target}" not found. Run "flt list" to see active agents.`)
    }
    session = agent.tmuxSession

    // Verify session is alive
    if (!tmux.hasSession(session)) {
      throw new Error(`Target session "${session}" is not running.`)
    }

    // Get the target's adapter for correct submit keys
    try {
      const adapter = resolveAdapter(agent.cli)
      submitKeys = adapter.submitKeys
    } catch {
      // Fallback to Enter
    }
  }

  if (isHumanParent) {
    // Display as a banner in the human's session — don't type into their shell
    if (crossSocket) {
      tmux.displayMessageOnDefaultSocket(session, `[flt] ${message}`)
    } else {
      tmux.displayMessage(session, `[flt] ${message}`)
    }
  } else {
    // Verify flt-socket session is alive (non-parent targets already checked above)
    if (target === 'parent' && !crossSocket && !tmux.hasSession(session)) {
      throw new Error(`Target session "${session}" is not running.`)
    }

    // Send message as a prompt to the agent CLI
    if (message.length > 200 || message.includes('\n')) {
      tmux.pasteBuffer(session, message)
    } else {
      tmux.sendLiteral(session, message)
    }

    await sleep(300)
    tmux.sendKeys(session, submitKeys)
  }

  if (caller.mode === 'human') {
    console.log(`Sent to ${target}`)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
