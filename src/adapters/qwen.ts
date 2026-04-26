import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getAdapter as getHarnessAdapter } from '@twaldin/harness-ts'

const harness = getHarnessAdapter('qwen')

function loadGeminiKey(): string | undefined {
  for (const path of [
    join(process.env.HOME ?? '', '.env'),
    join(process.env.HOME ?? '', '.config', 'gemini', '.env'),
  ]) {
    try {
      if (!existsSync(path)) continue
      const content = readFileSync(path, 'utf-8')
      const match = content.match(/^GEMINI_API_KEY=(.+)$/m)
      if (match) return match[1].trim()
    } catch {}
  }
  return process.env.GEMINI_API_KEY
}

export const qwenAdapter: CliAdapter = {
  name: 'qwen',
  cliCommand: 'qwen',
  instructionFile: harness.instructionsFilename || 'AGENTS.md',
  submitKeys: harness.submitKeys ?? ['Enter'],

  spawnArgs(opts: SpawnOpts): string[] {
    // qwen-code's native gemini path always sends thinkingLevel which
    // free-tier Gemini API rejects ("Thinking level is not supported").
    // Workaround: use Gemini's OpenAI-compatible endpoint via --auth-type
    // openai. qwen's openai code path doesn't send thinkingLevel so the
    // request goes through cleanly.
    const model = opts.model ?? 'gemini-2.5-flash'
    const apiKey = loadGeminiKey() ?? 'unused'
    return [
      'qwen',
      '--yolo',
      '--auth-type', 'openai',
      '--openai-api-key', apiKey,
      '--openai-base-url', 'https://generativelanguage.googleapis.com/v1beta/openai',
      '--model', model,
    ]
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
