import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'

export const geminiAdapter: CliAdapter = {
  name: 'gemini',
  cliCommand: 'gemini',
  instructionFile: 'GEMINI.md',
  submitKeys: ['Enter'],

  spawnArgs(opts: SpawnOpts): string[] {
    const args = ['gemini', '--sandbox']
    if (opts.model) args.push('--model', opts.model)
    return args
  },

  detectReady(pane: string): ReadyState {
    const lines = pane.split('\n').map(l => l.trim()).filter(Boolean)
    const last20 = lines.slice(-20).join('\n')

    // Gemini ready prompt
    if (/Type your message/i.test(last20) || /[>❯]\s*$/.test(last20)) {
      return 'ready'
    }

    return 'loading'
  },

  handleDialog(_pane: string): string[] | null {
    return null
  },

  detectStatus(pane: string): AgentStatus {
    const lines = pane.split('\n').map(l => l.trim()).filter(Boolean)
    const last10 = lines.slice(-10).join('\n')

    if (/rate.?limit|quota.?exceeded|resource.?exhausted/i.test(last10)) {
      return 'rate-limited'
    }

    if (/error/i.test(last10) && /fatal|crash/i.test(last10)) {
      return 'error'
    }

    // Gemini thinking/working indicators
    if (/[✦⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(last10)) {
      return 'running'
    }

    if (/Type your message/i.test(last10) || /[>❯]\s*$/.test(last10)) {
      return 'idle'
    }

    return 'unknown'
  },
}
