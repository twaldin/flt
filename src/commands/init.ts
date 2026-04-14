import { setOrchestrator, getOrchestrator, getStateDir } from '../state'
import { existsSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

interface InitArgs {
  orchestrator?: boolean | string  // true or agent name
  cli?: string
  model?: string
  preset?: string
  dir?: string
}

export function getInboxPath(): string {
  return join(getStateDir(), 'inbox.log')
}

export function appendInbox(from: string, message: string): void {
  const inboxPath = getInboxPath()
  mkdirSync(getStateDir(), { recursive: true })
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false })
  const tag = from.toUpperCase()
  const line = `[${ts}] [${tag}]: ${message}\n`
  const fd = require('fs').openSync(inboxPath, 'a')
  require('fs').writeSync(fd, line)
  require('fs').closeSync(fd)
}

export async function init(args: InitArgs): Promise<void> {
  if (!process.env.TMUX) {
    throw new Error('flt requires tmux. Run tmux first.')
  }

  // Ensure state dir and inbox exist
  mkdirSync(getStateDir(), { recursive: true })
  const inboxPath = getInboxPath()
  if (!existsSync(inboxPath)) {
    writeFileSync(inboxPath, '')
  }

  // Set orchestrator reference (human session)
  const currentSession = detectTmuxSession()
  const existing = getOrchestrator()
  if (!existing) {
    setOrchestrator({
      tmuxSession: currentSession,
      tmuxWindow: process.env.TMUX_PANE || '0',
      type: 'human',
      initAt: new Date().toISOString(),
    })
  } else if (existing.tmuxSession !== currentSession) {
    setOrchestrator({
      ...existing,
      tmuxSession: currentSession,
      tmuxWindow: process.env.TMUX_PANE || '0',
    })
  }

  // Ensure controller is running
  const { ensureController } = await import('./controller')
  await ensureController()

  // Spawn orchestrator agent if requested
  if (args.orchestrator) {
    const { spawn } = await import('./spawn')
    const agentName = typeof args.orchestrator === 'string' ? args.orchestrator : 'orchestrator'
    const preset = args.preset ?? agentName
    const { getPreset } = await import('../presets')
    const hasPreset = !!getPreset(preset)

    let dir = args.dir
    if (dir) {
      if (dir.startsWith('~/')) dir = dir.replace('~', process.env.HOME || homedir())
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    } else {
      const agentHome = join(getStateDir(), 'agents', agentName)
      if (existsSync(agentHome)) dir = agentHome
    }

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
  }

  // Launch TUI
  const { renderTui } = await import('../tui/render')
  await renderTui()
}

/** Launch TUI only — expects controller to be running */
export async function tui(): Promise<void> {
  if (!process.env.TMUX) {
    throw new Error('flt requires tmux. Run tmux first.')
  }

  const { ensureController } = await import('./controller')
  await ensureController()

  const { renderTui } = await import('../tui/render')
  await renderTui()
}

function detectTmuxSession(): string {
  const tmuxEnv = process.env.TMUX
  if (tmuxEnv) {
    try {
      const out = require('child_process').execFileSync('tmux', [
        'display-message', '-p', '#{session_name}'
      ], { encoding: 'utf-8', timeout: 3000 }).trim()
      if (out) return out
    } catch {}
  }
  return 'unknown'
}
