import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'
import { stripAnsi } from '../utils/stripAnsi'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getAdapter as getHarnessAdapter } from '@twaldin/harness-ts'

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
  instructionFile: getHarnessAdapter('swe-agent').instructionsFilename,
  submitKeys: ['Escape', 'Enter'], // mini requires Esc then Enter to submit

  spawnArgs(opts: SpawnOpts): string[] {
    // mini-swe-agent has no built-in default model — without --model and
    // without MSWEA_MODEL_NAME, the first user message crashes with
    // "ValueError: No default model set". flt always injects a model so
    // the probe / generic spawn doesn't immediately die.
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
    pane = stripAnsi(pane)
    const lines = pane.split('\n').map(l => l.trim()).filter(Boolean)
    const last20 = lines.slice(-20).join('\n')

    // mini v2: "Submit message: Esc, then Enter"
    if (/Submit message/i.test(last20)) return 'ready'
    // mini v1: "What do you want to do?"
    if (/What do you want to do/i.test(last20)) return 'ready'

    return 'loading'
  },

  handleDialog(_pane: string): string[] | null {
    return null
  },

  detectStatus(pane: string): AgentStatus {
    pane = stripAnsi(pane)
    const lines = pane.split('\n').map(l => l.trim()).filter(Boolean)
    const last10 = lines.slice(-10).join('\n')

    if (/rate.?limit/i.test(last10) || /quota/i.test(last10)) {
      return 'rate-limited'
    }

    if (/error/i.test(last10) && /fatal|crash/i.test(last10)) {
      return 'error'
    }

    // Idle: prompt visible
    if (/What do you want to do/i.test(last10)) return 'idle'
    if (/Submit message/i.test(last10)) return 'idle'

    return 'unknown'
  },
}
