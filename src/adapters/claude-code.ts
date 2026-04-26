import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'
import { getAdapter as getHarnessAdapter } from '@twaldin/harness-ts'

const harness = getHarnessAdapter('claude-code')

export const claudeCodeAdapter: CliAdapter = {
  name: 'claude-code',
  cliCommand: 'claude',
  instructionFile: harness.instructionsFilename,
  submitKeys: harness.submitKeys ?? ['Enter'],

  spawnArgs(opts: SpawnOpts): string[] {
    const args = ['claude', '--dangerously-skip-permissions']
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
