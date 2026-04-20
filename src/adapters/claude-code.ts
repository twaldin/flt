import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'
import { stripAnsi } from '../utils/stripAnsi'
import { getAdapter as getHarnessAdapter } from '@twaldin/harness-ts'

export const claudeCodeAdapter: CliAdapter = {
  name: 'claude-code',
  cliCommand: 'claude',
  instructionFile: getHarnessAdapter('claude-code').instructionsFilename,
  submitKeys: ['Enter'],

  spawnArgs(opts: SpawnOpts): string[] {
    const args = ['claude', '--dangerously-skip-permissions']
    if (opts.model) args.push('--model', opts.model)
    return args
  },

  detectReady(pane: string): ReadyState {
    const clean = stripAnsi(pane)
    const lines = clean.split('\n')
    const all = lines.join('\n')
    const last15 = lines.slice(-15).join('\n')

    // Check for ready FIRST — prompt visible + status bar
    const hasPrompt = lines.some(l => /^\s*[>❯]\s*$/.test(l.trim()))
    const hasStatusBar = /bypass permissions/i.test(all) || /Claude Code/i.test(all)
    if (hasPrompt && hasStatusBar) {
      return 'ready'
    }

    // Dialogs only checked in last 15 lines (avoids false positives from chat history)
    if (/bypass.?permissions/i.test(last15) && /Yes, I accept/i.test(last15)) {
      return 'dialog'
    }
    if (/trust this folder/i.test(last15) || /Do you trust the files/i.test(last15)) {
      return 'dialog'
    }

    return 'loading'
  },

  handleDialog(pane: string): string[] | null {
    const clean = stripAnsi(pane)

    // Bypass permissions: need to type "2" then Enter to accept
    if (/bypass.?permissions/i.test(clean) && /Yes, I accept/i.test(clean)) {
      return ['2', 'Enter']
    }

    // Workspace trust: just Enter
    if (/trust this folder/i.test(clean) || /Do you trust the files/i.test(clean)) {
      return ['Enter']
    }

    return null
  },

  detectStatus(pane: string): AgentStatus {
    const clean = stripAnsi(pane)
    const lines = clean.split('\n').map(l => l.trim()).filter(Boolean)
    const last5 = lines.slice(-5).join('\n')

    // Rate limited
    if (/rate.?limit/i.test(last5) || /hit your limit/i.test(last5)) {
      return 'rate-limited'
    }

    // Spinner icon detection (fallback for non-TUI callers like flt list)
    // Active spinner cycles through ✽✳✢✻✶· — but we can't track delta here
    // Best we can do: check if there's an active timer pattern
    if (/\((?:\d+m\s+)?\d+s[\s·)]/.test(last5)) {
      return 'running'
    }

    return 'unknown'
  },
}
