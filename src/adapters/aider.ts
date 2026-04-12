import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
}

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
    pane = stripAnsi(pane)
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
    pane = stripAnsi(pane)
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
