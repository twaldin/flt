import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'
import { stripAnsi } from '../utils/stripAnsi'
import { getAdapter as getHarnessAdapter } from '@twaldin/harness-ts'

export const codexAdapter: CliAdapter = {
  name: 'codex',
  cliCommand: 'codex',
  instructionFile: getHarnessAdapter('codex').instructionsFilename,
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
    const lines = pane.split('\n')
    const last15 = lines.slice(-15).join('\n')
    const last5 = lines.slice(-5).join('\n')

    // Codex ground truth: "esc to interrupt" or "Working" anywhere near bottom = running
    if (/esc to interrupt/i.test(last15)) return 'running'
    if (/Working\s*\(/i.test(last15)) return 'running'
    if (/background terminal running/i.test(last15)) return 'running'

    // Idle: prompt visible (❯ or ›) without working indicator
    const hasPrompt = last5.split('\n').some(l => /^\s*[❯›]\s*$/.test(l))
    if (hasPrompt) return 'idle'

    // Idle: status bar showing model/budget without working indicator
    if (/\d+%\s+left/i.test(last5) && !/working/i.test(last5)) return 'idle'

    return 'unknown'
  },
}
