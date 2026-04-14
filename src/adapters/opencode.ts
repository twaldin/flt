import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'
import { stripAnsi } from '../utils/stripAnsi'

const OAUTH_PROXY = 'http://127.0.0.1:10531/v1'

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

  env(): Record<string, string> {
    // OpenCode reads OPENAI_API_KEY and OPENAI_BASE_URL for GPT models
    return {
      OPENAI_BASE_URL: OAUTH_PROXY,
      OPENAI_API_KEY: 'unused',
    }
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

    // OpenCode uses braille spinners when working
    if (/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(last10)) return 'running'
    if (/thinking|running/i.test(last10)) return 'running'

    // Idle: "Ask anything" prompt visible without spinners
    const full = pane.split('\n').join('\n')
    if (/Ask anything/i.test(full)) return 'idle'

    return 'unknown'
  },
}
