import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'
import { getAdapter as getHarnessAdapter } from '@twaldin/harness-ts'

const harness = getHarnessAdapter('continue-cli')

export const continueCliAdapter: CliAdapter = {
  name: 'continue-cli',
  cliCommand: 'cn',
  instructionFile: harness.instructionsFilename || 'AGENTS.md',
  submitKeys: harness.submitKeys ?? ['Enter'],

  spawnArgs(opts: SpawnOpts): string[] {
    const args = ['cn']
    if (opts.model) args.push('--model', opts.model)
    return args
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
