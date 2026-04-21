import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'
import { stripAnsi } from '../utils/stripAnsi'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const OAUTH_PROXY = 'http://127.0.0.1:10531/v1'

function loadOpenRouterKey(): string | undefined {
  for (const path of [
    join(process.env.HOME ?? '', '.agentelo', '.env'),
    join(process.env.HOME ?? '', '.env'),
  ]) {
    try {
      if (!existsSync(path)) continue
      const content = readFileSync(path, 'utf-8')
      const match = content.match(/^OPENROUTER_API_KEY=(.+)$/m)
      if (match) return match[1].trim()
    } catch {}
  }
  return process.env.OPENROUTER_API_KEY
}

export const opencodeAdapter: CliAdapter = {
  name: 'opencode',
  cliCommand: 'opencode',
  instructionFile: '.opencode/agents/flt.md',
  submitKeys: ['Enter'],

  spawnArgs(opts: SpawnOpts): string[] {
    const args = ['opencode', '--agent', 'flt']
    if (opts.model) args.push('--model', opts.model)
    return args
  },

  env(): Record<string, string> {
    // OAUTH_PROXY handles ChatGPT-sub models; OPENROUTER_API_KEY needed for openrouter-provider models.
    const env: Record<string, string> = {
      OPENAI_BASE_URL: OAUTH_PROXY,
      OPENAI_API_KEY: 'unused',
    }
    const orKey = loadOpenRouterKey()
    if (orKey) env.OPENROUTER_API_KEY = orKey
    return env
  },

  detectReady(pane: string): ReadyState {
    pane = stripAnsi(pane)
    const lines = pane.split('\n')
    const full = lines.join('\n')
    const last5 = lines.slice(-5).join('\n')

    // Update-prompt / version-banner modal: opencode shows this BEFORE the
    // normal TUI. If we return 'ready' while this is visible, spawn.ts
    // delivers the bootstrap task + Enter, which installs the update and
    // kills the session. Always report 'dialog' here so the caller dismisses
    // the modal (Escape) before treating the agent as ready.
    if (/update available|a new version of opencode|upgrade now/i.test(full)) {
      return 'dialog'
    }

    // "Ask anything" appears in the input area; version in the bottom status bar.
    // They can be 30+ lines apart in a tall terminal, so scan the full pane.
    if (/Ask anything/i.test(full) && /\d+\.\d+\.\d+/.test(last5)) {
      return 'ready'
    }

    return 'loading'
  },

  handleDialog(pane: string): string[] | null {
    const stripped = stripAnsi(pane)
    // Dismiss opencode's update prompt without installing. Escape is the
    // safe neutral — 'n' or similar answers vary by build and could still
    // advance the dialog. Escape is consistently "cancel this modal".
    if (/update available|a new version of opencode|upgrade now/i.test(stripped)) {
      return ['Escape']
    }
    return null
  },

  detectStatus(pane: string): AgentStatus {
    pane = stripAnsi(pane)
    const lines = pane.split('\n').map(l => l.trim()).filter(Boolean)
    const last10 = lines.slice(-10).join('\n')

    if (/rate.?limit/i.test(last10) || /try again later/i.test(last10)) {
      return 'rate-limited'
    }

    if (/error/i.test(last10) && /fatal|crash/i.test(last10)) {
      return 'error'
    }

    // OpenCode uses braille spinners when working
    if (/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(last10)) return 'running'
    if (/thinking|running/i.test(last10)) return 'running'

    // Idle: "Ask anything" prompt visible without spinners
    const full = pane.split('\n').join('\n')
    if (/Ask anything/i.test(full)) return 'idle'

    return 'unknown'
  },
}
