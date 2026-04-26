import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getAdapter as getHarnessAdapter } from '@twaldin/harness-ts'

const harness = getHarnessAdapter('swe-agent')
const OAUTH_PROXY = 'http://127.0.0.1:10531/v1'

function loadOpenRouterKey(): string | undefined {
  for (const path of [
    join(process.env.HOME ?? '', '.agentelo', '.env'),
    join(process.env.HOME ?? '', '.env'),
  ]) {
    try {
      if (!existsSync(path)) continue
      const content = readFileSync(path, 'utf-8')
      const match = content.match(/^OPENROUTER_API_KEY=(.+)$/m)
      if (match) return match[1].trim()
    } catch {}
  }
  return process.env.OPENROUTER_API_KEY
}

export const sweAgentAdapter: CliAdapter = {
  name: 'swe-agent',
  cliCommand: 'mini',
  instructionFile: harness.instructionsFilename || 'AGENTS.md',
  submitKeys: harness.submitKeys ?? ['Escape', 'Enter'],

  spawnArgs(opts: SpawnOpts): string[] {
    // mini-swe-agent has no built-in default model — without --model and without
    // MSWEA_MODEL_NAME, the first user message crashes. Always inject one.
    const model = opts.model ?? 'gpt-5.4'
    const args: string[] = []
    const isGpt = /^(gpt-|o[0-9]|openai\/)/i.test(model)
    if (isGpt) {
      args.push('env', `OPENAI_API_KEY=unused`, `OPENAI_BASE_URL=${OAUTH_PROXY}`, `MSWEA_COST_TRACKING=ignore_errors`)
    } else {
      args.push('env', `MSWEA_COST_TRACKING=ignore_errors`)
    }
    args.push('mini', '-y', '--model', model)
    return args
  },

  env(): Record<string, string> {
    const env: Record<string, string> = {
      OPENAI_BASE_URL: OAUTH_PROXY,
      OPENAI_API_KEY: 'unused',
    }
    const orKey = loadOpenRouterKey()
    if (orKey) env.OPENROUTER_API_KEY = orKey
    return env
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
