import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'
import { stripAnsi } from '../utils/stripAnsi'
import { getAdapter as getHarnessAdapter } from '@twaldin/harness-ts'

function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export const piAdapter: CliAdapter = {
  name: 'pi',
  cliCommand: 'pi',
  instructionFile: getHarnessAdapter('pi').instructionsFilename,
  submitKeys: ['Enter'],

  spawnArgs(opts: SpawnOpts): string[] {
    const modelArg = opts.model ? ` --model ${shSingleQuote(opts.model)}` : ''
    const script = [
      'if [ -s "$HOME/.nvm/nvm.sh" ]; then',
      'source "$HOME/.nvm/nvm.sh" && nvm use 22 >/dev/null;',
      'fi;',
      `pi${modelArg}`,
    ].join(' ')
    return ['bash', '-lc', script]
  },

  detectReady(pane: string): ReadyState {
    pane = stripAnsi(pane)
    const lines = pane.split('\n')
    const last20 = lines.slice(-20).join('\n')

    if (/\/[a-z][a-z0-9_-]*/i.test(last20) && /pi|model|provider/i.test(last20)) return 'ready'
    if (lines.some(l => /^\s*[>❯]\s*$/.test(l.trim()))) return 'ready'
    if (/chatgpt plus|login|oauth|select a provider/i.test(last20)) return 'ready'

    return 'loading'
  },

  handleDialog(_pane: string): string[] | null {
    return null
  },

  detectStatus(pane: string): AgentStatus {
    pane = stripAnsi(pane)
    const lines = pane.split('\n').map(l => l.trim()).filter(Boolean)
    const last10 = lines.slice(-10).join('\n')

    if (/rate.?limit|too many requests|quota/i.test(last10)) return 'rate-limited'
    if (/error|fatal|crash/i.test(last10)) return 'error'

    // Prefer explicit active marker from Pi UI:
    // "⠋ Working..." (braille spinner + working text)
    if (/[⠁-⣿]\s*Working\.\.\./i.test(last10)) return 'running'

    if (/\/[a-z][a-z0-9_-]*/i.test(last10) || /[>❯]\s*$/.test(last10)) return 'idle'

    return 'unknown'
  },
}
