import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'

// Strip ANSI escape sequences for pattern matching
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
}

export const claudeCodeAdapter: CliAdapter = {
  name: 'claude-code',
  cliCommand: 'claude',
  instructionFile: 'CLAUDE.md',
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

    // Active work indicators — check last 3 non-empty lines.
    // ACTIVE spinner: "✽ Tomfoolering… (2m 43s · ↓ 708 tokens · thinking)"
    //   — has token counter (↓/↑ N tokens) or "esc to interrupt"
    // DONE marker: "✻ Cogitated for 2m 53s" or "✢ Thought for 1m 22s"
    //   — past tense verb + "for Xm Ys", NO token counter
    const last3 = lines.slice(-3).join('\n')
    if (/[✶✢✽✻✳]/.test(last3)) {
      // If it has a token counter or "esc to interrupt" → actively working
      if (/tokens|esc to interrupt/i.test(last3)) {
        return 'running'
      }
      // If it says "<verb> for Xm" with no token counter → done, not running
    }
    if (/Thinking|Tomfoolering|Working|Reading.*files/i.test(last3) && /tokens|esc to interrupt/i.test(last3)) {
      return 'running'
    }

    // Context percentage in status bar — if visible, agent is alive
    // Check if the prompt line is truly empty (idle) vs has content being typed
    const promptLine = lines.findLast(l => /^\s*[>❯]/.test(l))
    if (promptLine && /^\s*[>❯]\s*$/.test(promptLine)) {
      return 'idle'
    }

    // Has status bar but no empty prompt — likely mid-generation
    if (/bypass permissions/i.test(last5) || /\d+%/.test(last5)) {
      return 'running'
    }

    return 'unknown'
  },
}
