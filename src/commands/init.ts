import { setOrchestrator, getOrchestrator, loadState, getStateDir } from '../state'
import { existsSync, watchFile, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

interface InitArgs {
  orchestrator?: boolean | string  // true or agent name
  cli?: string
  model?: string
  preset?: string
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
  // Spawn orchestrator agent first, then fall through to TUI
  if (args.orchestrator) {
    const { spawn } = await import('./spawn')
    const agentName = typeof args.orchestrator === 'string' ? args.orchestrator : 'orchestrator'
    const preset = args.preset ?? agentName
    const { getPreset } = await import('../presets')
    const hasPreset = !!getPreset(preset)

    // Agent dir: ~/.flt/agents/<name>/ if it exists, otherwise cwd
    // Orchestrators live in their agent home; sub-agents get --dir pointed at projects
    const agentHome = join(getStateDir(), 'agents', agentName)
    const dir = existsSync(agentHome) ? agentHome : undefined

    try {
      await spawn({
        name: agentName,
        cli: hasPreset ? undefined : (args.cli || 'claude-code'),
        model: args.model,
        preset: hasPreset ? preset : args.preset,
        dir,
        worktree: false,
      })
    } catch (e) {
      console.error(`Warning: ${(e as Error).message}`)
    }
    // Fall through to TUI — don't return
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

  // Render TUI
  const { renderTui } = await import('../tui/render')
  await renderTui()
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
