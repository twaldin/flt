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

    // Check for bypass permissions confirmation dialog
    if (/bypass.?permissions/i.test(all) && /Yes, I accept/i.test(all)) {
      return 'dialog'
    }

    // Check for workspace trust dialog
    if (/trust this folder/i.test(all) || /Do you trust the files/i.test(all)) {
      return 'dialog'
    }

    // Check for ready prompt indicators
    const hasPrompt = lines.some(l => /^\s*[>❯]\s*$/.test(l.trim()))
    const hasStatusBar = /bypass permissions/i.test(all) || /Claude Code/i.test(all)
    if (hasPrompt && hasStatusBar) {
      return 'ready'
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
    const last10 = lines.slice(-10).join('\n')

    // Rate limited
    if (/rate.?limit/i.test(last10) || /hit your limit/i.test(last10)) {
      return 'rate-limited'
    }

    // Error states
    if (/error/i.test(last10) && /fatal|crash|panic/i.test(last10)) {
      return 'error'
    }

    // Active/running indicators (thinking spinners, tool execution)
    if (/[✶✢✽✻✳]/.test(last10) || /Running|Thinking/i.test(last10)) {
      return 'running'
    }

    // Idle at prompt
    if (lines.some(l => /^\s*[>❯]\s*$/.test(l))) {
      return 'idle'
    }

    return 'unknown'
  },
}
