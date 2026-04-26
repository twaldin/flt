import type { CliAdapter } from './types'
import { claudeCodeAdapter } from './claude-code'
import { codexAdapter } from './codex'
import { geminiAdapter } from './gemini'
import { opencodeAdapter } from './opencode'
import { sweAgentAdapter } from './swe-agent'
import { piAdapter } from './pi'
import { continueCliAdapter } from './continue-cli'
import { crushAdapter } from './crush'
import { droidAdapter } from './droid'
import { openclaudeAdapter } from './openclaude'
import { qwenAdapter } from './qwen'
import { kiloAdapter } from './kilo'

// Note: aider was removed (REPL-driven /run /add /edit slash commands; no
// autonomous shell tool). Doesn't fit flt's autonomous-agent-with-tools model.
const adapters: Record<string, CliAdapter> = {
  'claude-code': claudeCodeAdapter,
  'codex': codexAdapter,
  'gemini': geminiAdapter,
  'opencode': opencodeAdapter,
  'swe-agent': sweAgentAdapter,
  'pi': piAdapter,
  'continue-cli': continueCliAdapter,
  'crush': crushAdapter,
  'droid': droidAdapter,
  'openclaude': openclaudeAdapter,
  'qwen': qwenAdapter,
  'kilo': kiloAdapter,
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
