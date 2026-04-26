import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getAdapter as getHarnessAdapter } from '@twaldin/harness-ts'

const harness = getHarnessAdapter('opencode')
const OAUTH_PROXY = 'http://127.0.0.1:10531/v1'

function loadDotenvKey(name: string): string | undefined {
  for (const path of [
    join(process.env.HOME ?? '', '.agentelo', '.env'),
    join(process.env.HOME ?? '', '.env'),
  ]) {
    try {
      if (!existsSync(path)) continue
      const content = readFileSync(path, 'utf-8')
      const match = content.match(new RegExp(`^${name}=(.+)$`, 'm'))
      if (match) return match[1].trim()
    } catch {}
  }
  return process.env[name]
}

export const opencodeAdapter: CliAdapter = {
  name: 'opencode',
  cliCommand: 'opencode',
  // Note: instructionFile points at a custom agent file (.opencode/agents/flt.md)
  // because opencode auto-loads project AGENTS.md but we want a flt-specific agent.
  instructionFile: '.opencode/agents/flt.md',
  submitKeys: harness.submitKeys ?? ['Enter'],
  flattenOnPaste: harness.flattenOnPaste ?? true,

  spawnArgs(opts: SpawnOpts): string[] {
    const args = ['opencode', '--agent', 'flt']
    if (opts.model) args.push('--model', opts.model)
    return args
  },

  env(): Record<string, string> {
    const env: Record<string, string> = {
      OPENAI_BASE_URL: OAUTH_PROXY,
      OPENAI_API_KEY: 'unused',
    }
    for (const key of ['OPENROUTER_API_KEY', 'Z_AI_API_KEY', 'VERTEX_API_KEY']) {
      const v = loadDotenvKey(key)
      if (v) env[key] = v
    }
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
