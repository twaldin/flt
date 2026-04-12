import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'

export const codexAdapter: CliAdapter = {
  name: 'codex',
  cliCommand: 'codex',
  instructionFile: 'AGENTS.md',
  submitKeys: ['Enter'],

  spawnArgs(opts: SpawnOpts): string[] {
    const args = ['codex', '--full-auto']
    if (opts.model) args.push('--model', opts.model)
    return args
  },

  detectReady(pane: string): ReadyState {
    const lines = pane.split('\n')
    const last20 = lines.slice(-20).join('\n')

    // Any "Press enter to continue" dialog (trust, full-auto, update, etc.)
    if (/Press enter to continue/i.test(last20)) {
      return 'dialog'
    }

    // Any numbered menu with › selector (update prompt, sandbox prompt, etc.)
    if (/›\s+\d+\./m.test(last20) && !/[❯]\s*$/m.test(last20)) {
      return 'dialog'
    }

    // Ready: ›/❯ prompt visible + status bar with model info + "left"
    const hasPrompt = lines.some(l => /^\s*[❯›]/.test(l))
    const hasStatusBar = /\d+%\s+left/i.test(last20) || /model:/i.test(last20)
    if (hasPrompt && hasStatusBar) {
      return 'ready'
    }

    return 'loading'
  },

  handleDialog(pane: string): string[] | null {
    const text = pane.split('\n').slice(-20).join('\n')

    // Update prompt — skip the update (select option 2)
    if (/Update available/i.test(text)) {
      return ['Down', 'Enter']
    }

    // Trust prompt or other "Press enter" dialog — accept default
    if (/Press enter/i.test(text)) {
      return ['Enter']
    }

    // Numbered menu — accept default
    if (/›\s+\d+\./m.test(text)) {
      return ['Enter']
    }

    return null
  },

  detectStatus(pane: string): AgentStatus {
    const lines = pane.split('\n').map(l => l.trim()).filter(Boolean)
    const last10 = lines.slice(-10).join('\n')

    if (/rate.?limit/i.test(last10) || /429/i.test(last10)) {
      return 'rate-limited'
    }

    if (/error/i.test(last10) && /fatal|crash/i.test(last10)) {
      return 'error'
    }

    if (/[•●]/.test(last10) || /running|thinking/i.test(last10)) {
      return 'running'
    }

    // Idle: prompt visible with status bar
    const hasPrompt = lines.some(l => /^\s*[❯›]/.test(l))
    const hasStatusBar = /\d+%\s+left/i.test(last10) || /model:/i.test(last10)
    if (hasPrompt && hasStatusBar) {
      return 'idle'
    }

    return 'unknown'
  },
}
