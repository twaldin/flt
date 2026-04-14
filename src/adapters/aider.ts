import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'
import { stripAnsi } from '../utils/stripAnsi'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const OAUTH_PROXY = 'http://127.0.0.1:10531/v1'

function isGptModel(model: string): boolean {
  return /^(gpt-|o[0-9])/i.test(model)
}

function loadOpenRouterKey(): string | undefined {
  // Check common locations for OpenRouter API key
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

export const aiderAdapter: CliAdapter = {
  name: 'aider',
  cliCommand: 'aider',
  instructionFile: '.flt-instructions.md',
  submitKeys: ['Enter'],

  spawnArgs(opts: SpawnOpts): string[] {
    const args: string[] = []
    // GPT models: use env(1) to set vars that litellm needs
    if (opts.model && isGptModel(opts.model)) {
      args.push('env', `OPENAI_API_KEY=unused`, `OPENAI_API_BASE=${OAUTH_PROXY}`, `OPENAI_BASE_URL=${OAUTH_PROXY}`, 'BROWSER=echo')
    }
    args.push('aider', '--yes', '--no-show-model-warnings', '--no-browser', '--read', '.flt-instructions.md')
    if (opts.model) {
      args.push('--model', opts.model)
      if (isGptModel(opts.model)) {
        args.push('--openai-api-base', OAUTH_PROXY, '--openai-api-key', 'unused')
      }
      // OpenRouter models: use openrouter/ prefix natively
      if (opts.model.startsWith('openrouter/')) {
        const orKey = loadOpenRouterKey()
        if (orKey) args.push('--api-key', `openrouter=${orKey}`)
      }
    }
    return args
  },

  env(): Record<string, string> {
    // API keys handled via env prefix in spawnArgs for reliability
    const env: Record<string, string> = {}
    const orKey = loadOpenRouterKey()
    if (orKey) env.OPENROUTER_API_KEY = orKey
    return env
  },

  detectReady(pane: string): ReadyState {
    pane = stripAnsi(pane)
    const lines = pane.split('\n').map(l => l.trim()).filter(Boolean)
    const last20 = lines.slice(-20).join('\n')

    // Aider shows > prompt when ready
    if (/^>\s*$/m.test(last20) || /aider>/i.test(last20)) {
      return 'ready'
    }

    return 'loading'
  },

  handleDialog(_pane: string): string[] | null {
    return null
  },

  detectStatus(pane: string): AgentStatus {
    pane = stripAnsi(pane)
    const last5 = pane.split('\n').slice(-5).join('\n')

    // Aider shows "Waiting for <model>" with ░█ spinner while working
    if (/Waiting for/i.test(last5) || /[░█]{2,}/.test(last5)) return 'running'
    if (/Thinking|Editing|Applying/i.test(last5)) return 'running'

    // Aider prompt: "> ", "patch> ", "multi> ", etc.
    if (/^\s*(?:\w+\s+)?>\s*$/m.test(last5)) return 'idle'

    return 'unknown'
  },
}
