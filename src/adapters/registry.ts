import type { CliAdapter } from './types'
import { claudeCodeAdapter } from './claude-code'
import { codexAdapter } from './codex'
import { geminiAdapter } from './gemini'
import { aiderAdapter } from './aider'
import { opencodeAdapter } from './opencode'
import { sweAgentAdapter } from './swe-agent'

const adapters: Record<string, CliAdapter> = {
  'claude-code': claudeCodeAdapter,
  'codex': codexAdapter,
  'gemini': geminiAdapter,
  'aider': aiderAdapter,
  'opencode': opencodeAdapter,
  'swe-agent': sweAgentAdapter,
}

export function getAdapter(name: string): CliAdapter | undefined {
  return adapters[name]
}

export function listAdapters(): string[] {
  return Object.keys(adapters)
}

export function resolveAdapter(name: string): CliAdapter {
  const adapter = getAdapter(name)
  if (!adapter) {
    const available = listAdapters().join(', ')
    throw new Error(`Unknown CLI adapter: "${name}". Available: ${available}`)
  }
  return adapter
}
