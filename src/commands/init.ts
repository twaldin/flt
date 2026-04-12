import { setOrchestrator, getOrchestrator, loadState, getStateDir } from '../state'
import { existsSync, watchFile, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

interface InitArgs {
  orchestrator?: boolean
  cli?: string
  model?: string
}

export function getInboxPath(): string {
  return join(getStateDir(), 'inbox.log')
}

export function appendInbox(from: string, message: string): void {
  const inboxPath = getInboxPath()
  mkdirSync(getStateDir(), { recursive: true })
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false })
  const line = `[${ts}] ${from}: ${message}\n`
  const fd = require('fs').openSync(inboxPath, 'a')
  require('fs').writeSync(fd, line)
  require('fs').closeSync(fd)
}

export async function init(args: InitArgs): Promise<void> {
  if (args.orchestrator) {
    const { spawn } = await import('./spawn')
    await spawn({
      name: 'orchestrator',
      cli: args.cli || 'claude-code',
      model: args.model,
      worktree: false,
    })
    console.log('Agent orchestrator spawned. Use "flt list" to check status.')
    return
  }

  // Human orchestrator — determine current tmux session
  const currentSession = detectTmuxSession()

  const existing = getOrchestrator()
  if (existing && existing.tmuxSession === currentSession) {
    // Same session — just start watching inbox
  } else if (existing) {
    // Session changed — update reference
    setOrchestrator({
      ...existing,
      tmuxSession: currentSession,
      tmuxWindow: process.env.TMUX_PANE || '0',
    })
    console.log(`Updated fleet parent session → ${currentSession}`)
  } else {
    setOrchestrator({
      tmuxSession: currentSession,
      tmuxWindow: process.env.TMUX_PANE || '0',
      type: 'human',
      initAt: new Date().toISOString(),
    })
  }

  // Ensure inbox file exists
  const inboxPath = getInboxPath()
  mkdirSync(getStateDir(), { recursive: true })
  if (!existsSync(inboxPath)) {
    writeFileSync(inboxPath, '')
  }

  console.log('Fleet initialized. You are the orchestrator.')
  console.log('Use "flt spawn <name> --cli <cli>" to add agents.')
  console.log('Agent messages will appear below. Ctrl+C to exit.\n')
  console.log('─'.repeat(60))

  // Tail the inbox file — show new messages as they arrive
  let lastSize = readFileSync(inboxPath).length

  const check = () => {
    try {
      const content = readFileSync(inboxPath)
      if (content.length > lastSize) {
        const newBytes = content.subarray(lastSize)
        process.stdout.write(newBytes.toString())
        lastSize = content.length
      }
    } catch {}
  }

  // Poll every 500ms (watchFile is unreliable on some systems)
  const interval = setInterval(check, 500)

  // Keep alive until Ctrl+C
  process.on('SIGINT', () => {
    clearInterval(interval)
    console.log('\nFleet session ended. Agents keep running.')
    process.exit(0)
  })

  // Block forever
  await new Promise(() => {})
}

function detectTmuxSession(): string {
  // TMUX env var format: /tmp/tmux-501/default,12345,0
  const tmuxEnv = process.env.TMUX
  if (tmuxEnv) {
    // Extract session name from tmux
    try {
      const out = require('child_process').execFileSync('tmux', [
        'display-message', '-p', '#{session_name}'
      ], { encoding: 'utf-8', timeout: 3000 }).trim()
      if (out) return out
    } catch {}
  }
  return 'unknown'
}
