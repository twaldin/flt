import type { CliAdapter } from './types'
import { getAdapter as getHarnessAdapter } from '@twaldin/harness-ts'
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

const knownAdapters = [
  'claude-code',
  'codex',
  'gemini',
  'opencode',
  'swe-agent',
  'pi',
  'continue-cli',
  'crush',
  'droid',
  'openclaude',
  'qwen',
  'kilo',
]

const adapterCommands: Record<string, string> = {
  'claude-code': 'claude',
  'codex': 'codex',
  'gemini': 'gemini',
  'opencode': 'opencode',
  'swe-agent': 'sweagent',
  'pi': 'pi',
  'continue-cli': 'cn',
  'crush': 'crush',
  'droid': 'droid',
  'openclaude': 'openclaude',
  'qwen': 'qwen',
  'kilo': 'kilo',
}

const adapterFactories: Record<string, () => CliAdapter> = {
  'claude-code': () => claudeCodeAdapter,
  'codex': () => codexAdapter,
  'gemini': () => geminiAdapter,
  'opencode': () => opencodeAdapter,
  'swe-agent': () => sweAgentAdapter,
  'pi': () => piAdapter,
  'continue-cli': () => continueCliAdapter,
  'crush': () => crushAdapter,
  'droid': () => droidAdapter,
  'openclaude': () => openclaudeAdapter,
  'qwen': () => qwenAdapter,
  'kilo': () => kiloAdapter,
}

function fallbackAdapter(name: string): CliAdapter | undefined {
  if (!knownAdapters.includes(name)) return undefined
  const harness = getHarnessAdapter(name)
  return {
    name,
    cliCommand: adapterCommands[name] ?? name,
    instructionFile: harness.instructionsFilename,
    submitKeys: harness.submitKeys ?? ['Enter'],
    spawnArgs(opts) {
      const args = [adapterCommands[name] ?? name]
      if (opts.model) args.push('--model', opts.model)
      return args
    },
    detectReady(pane) {
      return harness.detectReady?.(pane) ?? 'loading'
    },
    handleDialog(pane) {
      return harness.handleDialog?.(pane) ?? null
    },
    detectStatus(pane) {
      return (harness.detectStatus?.(pane) ?? 'unknown') as ReturnType<CliAdapter['detectStatus']>
    },
  }
}

// Note: aider was removed (REPL-driven /run /add /edit slash commands; no
// autonomous shell tool). Doesn't fit flt's autonomous-agent-with-tools model.
export function getAdapter(name: string): CliAdapter | undefined {
  const factory = adapterFactories[name]
  if (!factory) return undefined
  try {
    return factory()
  } catch (error) {
    if (error instanceof ReferenceError) {
      return fallbackAdapter(name)
    }
    throw error
  }
}

export function listAdapters(): string[] {
  return [...knownAdapters]
}

export function resolveAdapter(name: string): CliAdapter {
  const adapter = getAdapter(name)
  if (!adapter) {
    const available = listAdapters().join(', ')
    throw new Error(`Unknown CLI adapter: "${name}". Available: ${available}`)
  }
  return adapter
}
