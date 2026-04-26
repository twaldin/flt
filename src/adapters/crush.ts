import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'
import { getAdapter as getHarnessAdapter } from '@twaldin/harness-ts'

const harness = getHarnessAdapter('crush')
const OAUTH_PROXY = 'http://127.0.0.1:10531/v1'

export const crushAdapter: CliAdapter = {
  name: 'crush',
  cliCommand: 'crush',
  instructionFile: harness.instructionsFilename || 'AGENTS.md',
  submitKeys: harness.submitKeys ?? ['Enter'],

  spawnArgs(_opts: SpawnOpts): string[] {
    // crush has no --model flag; model is configured per-project. We rely
    // on env vars to pick the OpenAI provider as the only one with a valid
    // api_key (Anthropic env intentionally unset).
    // -y = yolo: auto-approve all permissions.
    return ['crush', '-y']
  },

  env(): Record<string, string> {
    // crush's bundled providers.json reads $OPENAI_API_KEY and
    // $OPENAI_API_ENDPOINT (NOT $OPENAI_BASE_URL — that's opencode's name).
    return {
      OPENAI_API_KEY: 'unused',
      OPENAI_API_ENDPOINT: OAUTH_PROXY,
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
