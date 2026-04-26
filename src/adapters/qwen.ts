import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'
import { getAdapter as getHarnessAdapter } from '@twaldin/harness-ts'

const harness = getHarnessAdapter('qwen')
const OAUTH_PROXY = 'http://127.0.0.1:10531/v1'

export const qwenAdapter: CliAdapter = {
  name: 'qwen',
  cliCommand: 'qwen',
  instructionFile: harness.instructionsFilename || 'AGENTS.md',
  submitKeys: harness.submitKeys ?? ['Enter'],

  spawnArgs(opts: SpawnOpts): string[] {
    const model = opts.model ?? 'gpt-5.4'
    return ['qwen', '--model', model]
  },

  env(): Record<string, string> {
    return {
      OPENAI_BASE_URL: OAUTH_PROXY,
      OPENAI_API_KEY: 'unused',
    }
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
