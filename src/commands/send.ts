import { getAgent, loadState, getOrchestrator, getStateDir } from '../state'
import { resolveAdapter } from '../adapters/registry'
import * as tmux from '../tmux'
import { deliver, deliverKeys } from '../delivery'
import { detectCaller } from '../detect'
import { appendInbox } from './init'
import { userInfo } from 'os'
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'

interface SendArgs {
  target: string
  message: string
  /** Explicit sender label override (--from flag). Highest precedence. */
  from?: string
  _caller?: CallerContext
}

type CallerContext = ReturnType<typeof detectCaller>

/**
 * Resolve the sender label shown in inbox messages.
 *
 * Precedence:
 *   1. Explicit --from flag (args.from)
 *   2. FLT_AGENT env var (script-level override; cron entries can set this)
 *   3. caller.agentName (workflow agents have FLT_AGENT_NAME plumbed)
 *   4. Cron auto-detect: when stdin is not a TTY and TMUX is unset, the
 *      caller is almost certainly a cron / launchd / systemd-timer script.
 *      Default sender to "cron" so cron messages don't masquerade as the
 *      unix user (issue #70).
 *   5. detectUsername() (interactive human at a terminal)
 *   6. "unknown" (agent context with no name — shouldn't happen)
 */
function resolveSender(args: SendArgs, caller: CallerContext): string {
  if (args.from && args.from.length > 0) return args.from
  const envFrom = process.env.FLT_AGENT
  if (envFrom && envFrom.length > 0) return envFrom
  if (caller.agentName) return caller.agentName
  if (caller.mode === 'human') {
    if (isCronContext()) return 'cron'
    return detectUsername()
  }
  return 'unknown'
}

function isCronContext(): boolean {
  // cron / launchd / systemd-timer scripts run without a controlling
  // terminal and outside any tmux session. If both signals say "no
  // interactive terminal," treat as cron.
  if (process.stdin.isTTY) return false
  if (process.env.TMUX) return false
  if (process.env.SSH_TTY) return false
  return true
}

export async function send(args: SendArgs): Promise<void> {
  if (process.env.FLT_CONTROLLER !== '1') {
    const { ensureController } = await import('./controller')
    const { sendToController } = await import('../controller/client')
    await ensureController()
    // Capture caller context here (where FLT_AGENT_NAME is set) and pass it through.
    // ALSO pre-resolve the sender label here — TTY / TMUX / SSH_TTY signals
    // for cron auto-detect must be sampled in the caller's process, not the
    // controller daemon's (which has its own, unrelated TTY state).
    const caller = detectCaller()
    const resolvedFrom = args.from ?? resolveSender(args, caller)
    const result = await sendToController({
      action: 'send',
      args: { ...args, from: resolvedFrom, _caller: caller },
    })
    if (!result.ok) throw new Error(result.error ?? 'Send failed')
    return
  }
  return sendDirect(args)
}

export async function sendDirect(args: SendArgs): Promise<void> {
  const { target, message, _caller } = args
  const caller = _caller ?? detectCaller()
  const senderName = resolveSender(args, caller)

  let effectiveTarget = target

  // Subagents cannot message human directly; auto-reroute to parent.
  if (caller.mode === 'agent' && caller.parentName && caller.parentName !== 'human' && target === 'human') {
    effectiveTarget = 'parent'
    process.stderr.write('[flt] warning: rerouted send target from "human" to "parent" for subagent\n')
  }


  if (effectiveTarget === 'parent') {
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
    } else if (isExternalOrchestrator(parentName)) {
      // External orchestrator (e.g. hermes): write to inbox.log + events.jsonl
      appendInbox(senderName, message)
      appendExternalEvent(senderName, parentName, message)
    } else {
      // Send to parent agent's tmux session
      const parentAgent = getAgent(parentName)
      if (parentAgent && tmux.hasSession(parentAgent.tmuxSession)) {
        let submitKeys: string[] = ['Enter']
        try {
          const adapter = resolveAdapter(parentAgent.cli)
          submitKeys = adapter.submitKeys
        } catch {}
        const tagged = flattenNewlines(`[${senderName.toUpperCase()}]: ${message}`)
        deliver(parentAgent, tagged)
        await sleep(300)
        deliverKeys(parentAgent, submitKeys)
      } else {
        // Parent agent not alive — fallback to inbox
        appendInbox(senderName, message)
      }
    }
  } else {
    const agent = getAgent(effectiveTarget)
    if (!agent) {
      throw new Error(`Agent "${effectiveTarget}" not found. Run "flt list" to see active agents.`)
    }

    if (!tmux.hasSession(agent.tmuxSession)) {
      throw new Error(`Target session "${agent.tmuxSession}" is not running.`)
    }

    let submitKeys: string[] = ['Enter']
    try {
      const adapter = resolveAdapter(agent.cli)
      submitKeys = adapter.submitKeys
    } catch {}

    const tagged = flattenNewlines(`[${senderName.toUpperCase()}]: ${message}`)
    deliver(agent, tagged)
    await sleep(300)
    deliverKeys(agent, submitKeys)
  }

  if (caller.mode === 'human' && !process.env.FLT_TUI_ACTIVE) {
    console.log(`Sent to ${effectiveTarget}`)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

// Flatten CR/LF so pasted multi-line messages never submit mid-delivery.
// Target agents interpret any \n in a paste-buffer stream as Enter, which
// prematurely submits the prompt. send() is one-shot → single spacebar join.
function flattenNewlines(text: string): string {
  return text.replace(/\r\n|\r|\n/g, ' ')
}

function detectUsername(): string {
  try {
    return userInfo().username || 'user'
  } catch {
    return 'user'
  }
}

function isExternalOrchestrator(name: string): boolean {
  const orch = getOrchestrator()
  return orch?.type === 'external' && orch.name === name
}

export function appendExternalEvent(from: string, to: string, message: string): void {
  try {
    const dir = getStateDir()
    mkdirSync(dir, { recursive: true })
    const event = JSON.stringify({ type: 'message', from, to, message, ts: new Date().toISOString() })
    appendFileSync(join(dir, 'events.jsonl'), event + '\n', 'utf-8')
  } catch {
    // Best-effort — never throw from event logging
  }
}
