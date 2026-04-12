import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'

export const aiderAdapter: CliAdapter = {
  name: 'aider',
  cliCommand: 'aider',
  instructionFile: '.flt-instructions.md',
  submitKeys: ['Enter'],

  spawnArgs(opts: SpawnOpts): string[] {
    const args = ['aider', '--yes', '--read', '.flt-instructions.md']
    if (opts.model) args.push('--model', opts.model)
    return args
  },

  detectReady(pane: string): ReadyState {
    const lines = pane.split('\n').map(l => l.trim()).filter(Boolean)
    const last20 = lines.slice(-20).join('\n')

    // Aider shows > prompt when ready
    if (/^>\s*$/m.test(last20) || /aider>/i.test(last20)) {
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

    if (/rate.?limit/i.test(last10) || /429/i.test(last10)) {
      return 'rate-limited'
    }

    if (/error/i.test(last10) && /fatal|crash/i.test(last10)) {
      return 'error'
    }

    // Aider thinking
    if (/Thinking|Editing|Applying/i.test(last10)) {
      return 'running'
    }

    if (/^>\s*$/m.test(last10) || /aider>/i.test(last10)) {
      return 'idle'
    }

    return 'unknown'
  },
}
