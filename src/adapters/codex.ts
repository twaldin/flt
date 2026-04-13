import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
}

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
    pane = stripAnsi(pane)
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
    pane = stripAnsi(pane)
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
    pane = stripAnsi(pane)
    const last5 = pane.split('\n').slice(-5).join('\n')

    // Codex shows explicit status: "Working", "Thinking", "Ready"
    // in its status bar area (last few lines)
    if (/Working|Thinking/i.test(last5)) return 'running'
    if (/Ready/i.test(last5)) return 'idle'

    // Background terminal running indicator
    if (/background terminal running/i.test(last5)) return 'running'

    // Prompt visible with status bar
    if (/\d+%\s+(left|context)/i.test(last5)) return 'idle'

    return 'unknown'
  },
}
