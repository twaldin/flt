import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'

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
    const lines = pane.split('\n')
    const last20 = lines.slice(-20).join('\n')

    // Check for bypass permissions confirmation dialog
    if (/bypass.?permissions/i.test(last20) && /Yes, I accept/i.test(last20)) {
      return 'dialog'
    }

    // Check for workspace trust dialog
    if (/trust this folder/i.test(last20) || /Do you trust the files/i.test(last20)) {
      return 'dialog'
    }

    // Check for ready prompt indicators
    // Claude Code shows ❯ or > when ready. Check each line individually.
    const hasPrompt = lines.some(l => /^\s*[>❯]\s*$/.test(l))
    const hasStatusBar = /bypass permissions/i.test(last20) || /Claude Code/i.test(last20)
    if (hasPrompt && hasStatusBar) {
      return 'ready'
    }

    return 'loading'
  },

  handleDialog(pane: string): string[] | null {
    const text = pane.split('\n').slice(-20).join('\n')

    // Bypass permissions: need to type "2" then Enter to accept
    if (/bypass.?permissions/i.test(text) && /Yes, I accept/i.test(text)) {
      return ['2', 'Enter']
    }

    // Workspace trust: just Enter
    if (/trust this folder/i.test(text) || /Do you trust the files/i.test(text)) {
      return ['Enter']
    }

    return null
  },

  detectStatus(pane: string): AgentStatus {
    const lines = pane.split('\n').map(l => l.trim()).filter(Boolean)
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

    // Idle at prompt — check individual lines
    if (lines.some(l => /^\s*[>❯]\s*$/.test(l))) {
      return 'idle'
    }

    return 'unknown'
  },
}
