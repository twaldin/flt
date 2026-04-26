import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getAdapter as getHarnessAdapter } from '@twaldin/harness-ts'

const harness = getHarnessAdapter('gemini')

function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

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

export const geminiAdapter: CliAdapter = {
  name: 'gemini',
  cliCommand: 'gemini',
  instructionFile: harness.instructionsFilename,
  submitKeys: harness.submitKeys ?? ['Enter'],

  spawnArgs(opts: SpawnOpts): string[] {
    // gemini-cli's bundle uses Unicode regex /v flag (node ≥22).
    // --yolo (or -y) auto-approves all tool actions so mid-run "Apply this
    // change?" doesn't block. handleDialog also catches it as backstop.
    const modelArg = opts.model ? ` --model ${shSingleQuote(opts.model)}` : ''
    const script = [
      'if [ -s "$HOME/.nvm/nvm.sh" ]; then',
      'source "$HOME/.nvm/nvm.sh" && nvm use 22 >/dev/null;',
      'fi;',
      `gemini --yolo${modelArg}`,
    ].join(' ')
    return ['bash', '-lc', script]
  },

  env(): Record<string, string> {
    const env: Record<string, string> = {}
    const key = loadGeminiKey()
    if (key) env.GEMINI_API_KEY = key
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
