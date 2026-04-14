import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'
import { stripAnsi } from '../utils/stripAnsi'

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
    const last5 = pane.split('\n').slice(-5).join('\n')

    // Aider shows "Waiting for <model>" with ░█ spinner while working
    if (/Waiting for/i.test(last5) || /[░█]{2,}/.test(last5)) return 'running'
    if (/Thinking|Editing|Applying/i.test(last5)) return 'running'

    // Aider prompt: "> ", "patch> ", "multi> ", etc.
    if (/^\s*(?:\w+\s+)?>\s*$/m.test(last5)) return 'idle'

    return 'unknown'
  },
}
