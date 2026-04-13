import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
}

export const geminiAdapter: CliAdapter = {
  name: 'gemini',
  cliCommand: 'gemini',
  instructionFile: 'GEMINI.md',
  submitKeys: ['Enter'],

  spawnArgs(opts: SpawnOpts): string[] {
    // Let PATH resolve `node`/`gemini` at runtime.
    const args = ['gemini']
    if (opts.model) args.push('--model', opts.model)
    return args
  },

  detectReady(pane: string): ReadyState {
    pane = stripAnsi(pane)
    const lines = pane.split('\n').map(l => l.trim()).filter(Boolean)
    const last20 = lines.slice(-20).join('\n')

    // Gemini ready prompt
    if (/Type your message/i.test(last20) || /[>❯]\s*$/.test(last20)) {
      return 'ready'
    }

    return 'loading'
  },

  handleDialog(pane: string): string[] | null {
    pane = stripAnsi(pane)
    // "Action Required" / "Allow execution" permission prompt
    // Select "Allow for this session" (option 2) so it doesn't prompt again
    if (/Action Required/i.test(pane) && /Allow/i.test(pane)) {
      return ['Down', 'Enter']
    }
    return null
  },

  detectStatus(pane: string): AgentStatus {
    pane = stripAnsi(pane)
    const lines = pane.split('\n').map(l => l.trim()).filter(Boolean)
    const last20 = lines.slice(-20).join('\n')
    const last10 = lines.slice(-10).join('\n')

    // Permission prompt — auto-approve
    if (/Action Required/i.test(last20) && /Allow/i.test(last20)) {
      return 'dialog' as AgentStatus
    }

    if (/rate.?limit|quota.?exceeded|resource.?exhausted/i.test(last10)) {
      return 'rate-limited'
    }

    if (/error/i.test(last10) && /fatal|crash/i.test(last10)) {
      return 'error'
    }

    // Gemini spinners: braille ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏ (tool exec) or toggle ⊶⊷ (executing)
    if (/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⊶⊷]/.test(last10)) return 'running'
    if (/Thinking\.\.\./i.test(last10)) return 'running'

    // Idle: "◇  Ready" or prompt
    if (/Ready/i.test(last10) || /Type your message/i.test(last10)) return 'idle'
    // Success markers mean task done
    if (/[✓✔]/.test(last10) && !/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⊶⊷]/.test(last10)) return 'idle'

    return 'unknown'
  },
}
