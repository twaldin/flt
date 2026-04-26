import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'
import { getAdapter as getHarnessAdapter } from '@twaldin/harness-ts'

const harness = getHarnessAdapter('pi')

function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export const piAdapter: CliAdapter = {
  name: 'pi',
  cliCommand: 'pi',
  instructionFile: harness.instructionsFilename,
  submitKeys: harness.submitKeys ?? ['Enter'],

  spawnArgs(opts: SpawnOpts): string[] {
    // pi 0.68+ uses Unicode regex /v flag (node ≥22). Force node 22 via nvm.
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
    return harness.detectReady?.(pane) ?? 'loading'
  },

  handleDialog(pane: string): string[] | null {
    return harness.handleDialog?.(pane) ?? null
  },

  detectStatus(pane: string): AgentStatus {
    return (harness.detectStatus?.(pane) ?? 'unknown') as AgentStatus
  },
}
