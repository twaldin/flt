import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'

export const codexAdapter: CliAdapter = {
  name: 'codex',
  cliCommand: 'codex',
  instructionFile: 'AGENTS.md',
  submitKeys: ['Enter'],

  spawnArgs(opts: SpawnOpts): string[] {
    const args = ['codex', '--dangerously-bypass-approvals-and-sandbox']
    if (opts.model) args.push('--model', opts.model)
    return args
  },

  detectReady(pane: string): ReadyState {
    const lines = pane.split('\n')
    const full = lines.join('\n')

    // Check for ready FIRST — prompt visible + status bar with model info
    // This prevents treating info banners (Update available) as blocking dialogs
    const hasPrompt = lines.some(l => /^\s*[❯›]\s+\S/.test(l) || /^\s*[❯›]\s*$/.test(l))
    const hasStatusBar = /\d+%\s+left/i.test(full) || /model:/i.test(full)
    if (hasPrompt && hasStatusBar) {
      return 'ready'
    }

    // Blocking dialogs (only checked when prompt is NOT visible)
    if (/Press enter to continue/i.test(full)) {
      return 'dialog'
    }
    if (/›\s+\d+\./m.test(full) && !hasPrompt) {
      return 'dialog'
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
    const last20 = lines.slice(-20).join('\n')

    if (/rate.?limit(ed|ing| exceeded| reached)/i.test(last10) || /429/i.test(last10)) {
      return 'rate-limited'
    }

    if (/error/i.test(last10) && /fatal|crash/i.test(last10)) {
      return 'error'
    }

    // Permission/approval prompt — auto-approve by sending Enter
    if (/Would you like to run/i.test(last20) || /Press enter to confirm/i.test(last20)) {
      return 'dialog' as AgentStatus
    }

    if (/[•●]/.test(last10) || /running|thinking|working/i.test(last10)) {
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
