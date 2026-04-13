import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
}

export const sweAgentAdapter: CliAdapter = {
  name: 'swe-agent',
  cliCommand: 'mini',
  instructionFile: '', // SWE-agent uses prompt injection, no instruction file
  submitKeys: ['Escape', 'Enter'], // mini requires Esc then Enter to submit

  spawnArgs(opts: SpawnOpts): string[] {
    const args = ['mini', '-y']
    if (opts.model) args.push('--model', opts.model)
    return args
  },

  detectReady(pane: string): ReadyState {
    pane = stripAnsi(pane)
    const lines = pane.split('\n').map(l => l.trim()).filter(Boolean)
    const last20 = lines.slice(-20).join('\n')

    // mini-swe-agent shows "What do you want to do?" when ready
    if (/What do you want to do/i.test(last20)) {
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

    if (/rate.?limit/i.test(last10) || /quota/i.test(last10)) {
      return 'rate-limited'
    }

    if (/error/i.test(last10) && /fatal|crash/i.test(last10)) {
      return 'error'
    }

    // Idle: "What do you want to do?" prompt visible
    if (/What do you want to do/i.test(last10)) return 'idle'

    return 'unknown'
  },
}
