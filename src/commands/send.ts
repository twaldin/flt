import { getAgent, loadState } from '../state'
import { resolveAdapter } from '../adapters/registry'
import * as tmux from '../tmux'
import { detectCaller } from '../detect'
import { appendInbox } from './init'
import { userInfo } from 'os'

interface SendArgs {
  target: string
  message: string
  _caller?: CallerContext
}

type CallerContext = ReturnType<typeof detectCaller>

export async function send(args: SendArgs): Promise<void> {
  if (process.env.FLT_CONTROLLER !== '1') {
    const { ensureController } = await import('./controller')
    const { sendToController } = await import('../controller/client')
    await ensureController()
    // Capture caller context here (where FLT_AGENT_NAME is set) and pass it through
    const caller = detectCaller()
    const result = await sendToController({
      action: 'send',
      args: { ...args, _caller: caller },
    })
    if (!result.ok) throw new Error(result.error ?? 'Send failed')
    return
  }
  return sendDirect(args)
}

export async function sendDirect(args: SendArgs): Promise<void> {
  const { target, message, _caller } = args
  const caller = _caller ?? detectCaller()
  const senderName = caller.agentName ?? (caller.mode === 'human' ? detectUsername() : 'unknown')

  // Block workflow agents from sending messages — they should use flt workflow pass/fail
  if (caller.agentName) {
    try {
      const { getWorkflowForAgent } = await import('../workflow/engine')
      const workflowId = getWorkflowForAgent(caller.agentName)
      if (workflowId) {
        throw new Error(`Blocked: you are in workflow "${workflowId}". Use "flt workflow pass" or "flt workflow fail <reason>" instead of flt send.`)
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Blocked:')) throw e
    }
  }

  if (target === 'parent') {
    if (caller.mode !== 'agent') {
      throw new Error('Cannot send to "parent" — not running as a fleet agent.')
    }

    const parentName = caller.parentName
    if (!parentName) {
      throw new Error('No parent set (FLT_PARENT_NAME not set).')
    }

    // Single delivery: parent='human' or parent='cron' → inbox. Otherwise → parent agent.
    if (parentName === 'human' || parentName === 'cron') {
      appendInbox(senderName, message)
    } else {
      // Send to parent agent's tmux session
      const parentAgent = getAgent(parentName)
      if (parentAgent && tmux.hasSession(parentAgent.tmuxSession)) {
        let submitKeys: string[] = ['Enter']
        try {
          const adapter = resolveAdapter(parentAgent.cli)
          submitKeys = adapter.submitKeys
        } catch {}
        const tagged = `[${senderName.toUpperCase()}]: ${message}`
        if (tagged.length > 200 || tagged.includes('\n')) {
          tmux.pasteBuffer(parentAgent.tmuxSession, tagged)
        } else {
          tmux.sendLiteral(parentAgent.tmuxSession, tagged)
        }
        await sleep(300)
        tmux.sendKeys(parentAgent.tmuxSession, submitKeys)
      } else {
        // Parent agent not alive — fallback to inbox
        appendInbox(senderName, message)
      }
    }
  } else {
    const agent = getAgent(target)
    if (!agent) {
      throw new Error(`Agent "${target}" not found. Run "flt list" to see active agents.`)
    }

    if (!tmux.hasSession(agent.tmuxSession)) {
      throw new Error(`Target session "${agent.tmuxSession}" is not running.`)
    }

    let submitKeys: string[] = ['Enter']
    try {
      const adapter = resolveAdapter(agent.cli)
      submitKeys = adapter.submitKeys
    } catch {}

    const tagged = `[${senderName.toUpperCase()}]: ${message}`
    if (tagged.length > 200 || tagged.includes('\n')) {
      tmux.pasteBuffer(agent.tmuxSession, tagged)
    } else {
      tmux.sendLiteral(agent.tmuxSession, tagged)
    }
    await sleep(300)
    tmux.sendKeys(agent.tmuxSession, submitKeys)
  }

  if (caller.mode === 'human' && !process.env.FLT_TUI_ACTIVE) {
    console.log(`Sent to ${target}`)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function detectUsername(): string {
  try {
    return userInfo().username || 'user'
  } catch {
    return 'user'
  }
}
