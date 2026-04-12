import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
}

export const opencodeAdapter: CliAdapter = {
  name: 'opencode',
  cliCommand: 'opencode',
  instructionFile: '.opencode/agents/flt.md',
  submitKeys: ['Enter'],

  spawnArgs(opts: SpawnOpts): string[] {
    const args = ['opencode']
    if (opts.model) args.push('--model', opts.model)
    return args
  },

  detectReady(pane: string): ReadyState {
    pane = stripAnsi(pane)
    const lines = pane.split('\n')
    // "Ask anything" appears in the input area; version in the bottom status bar.
    // They can be 30+ lines apart in a tall terminal, so scan the full pane.
    const full = lines.join('\n')
    const last5 = lines.slice(-5).join('\n')

    // OpenCode shows "Ask anything..." placeholder and version in status bar
    if (/Ask anything/i.test(full) && /\d+\.\d+\.\d+/.test(last5)) {
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

    if (/rate.?limit/i.test(last10) || /try again later/i.test(last10)) {
      return 'rate-limited'
    }

    if (/error/i.test(last10) && /fatal|crash/i.test(last10)) {
      return 'error'
    }

    if (/thinking|running/i.test(last10)) {
      return 'running'
    }

    if (/Ask anything/i.test(last10) || /\d+\.\d+\.\d+/.test(last10)) {
      return 'idle'
    }

    return 'unknown'
  },
}
