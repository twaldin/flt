import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getAdapter as getHarnessAdapter } from '@twaldin/harness-ts'

const harness = getHarnessAdapter('factory-droid')
const OAUTH_PROXY = 'http://127.0.0.1:10531/v1'

// droid stores per-session settings JSON. The `model` field is a direct
// model slug (e.g. "gpt-5.4") — NOT a customModels ID. Droid routes
// requests through OPENAI_BASE_URL (the local OAuth proxy) when that env
// var is set, so no customModels entry is needed for flt-spawned agents.
//
// Schema fields verified empirically from past session settings:
//   model: model slug (e.g. "gpt-5.5", "gpt-5.4", "gpt-5.4-mini")
//   autonomyLevel: 'off' | 'medium' | 'high'
//   autonomyMode: 'normal' | 'auto-medium' | 'auto-high' | 'spec'
//   reasoningEffort: 'low' | 'medium' | 'high' | 'none'
//   interactionMode: 'auto' | 'spec'
function writeDroidSettings(workdir: string, modelId: string): string {
  const dir = join(workdir, '.flt', 'droid')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'settings.json')
  writeFileSync(path, JSON.stringify({
    model: modelId,
    reasoningEffort: 'medium',
    interactionMode: 'auto',
    autonomyLevel: 'high',
    autonomyMode: 'auto-high',
  }, null, 2))
  return path
}

export const droidAdapter: CliAdapter = {
  name: 'droid',
  cliCommand: 'droid',
  instructionFile: harness.instructionsFilename || 'AGENTS.md',
  submitKeys: harness.submitKeys ?? ['Enter'],

  spawnArgs(opts: SpawnOpts): string[] {
    const modelId = opts.model ?? 'gpt-5.4'
    const settings = writeDroidSettings(opts.dir, modelId)
    return ['droid', '--settings', settings]
  },

  env(): Record<string, string> {
    return {
      OPENAI_BASE_URL: OAUTH_PROXY,
      OPENAI_API_KEY: 'unused',
    }
  },

  detectReady(pane: string): ReadyState {
    return harness.detectReady?.(pane) ?? 'loading'
  },

  handleDialog(pane: string): string[] | null {
    return harness.handleDialog?.(pane) ?? null
  },

  detectStatus(pane: string): AgentStatus {
    // Catch droid's streaming/thinking indicators that the base harness regex
    // misses. Droid uses non-braille spinner glyphs (⁝ ⋮ ⋯ ⢀⢄⡠ ⣷⣟⡿) and a
    // literal "Streaming..." status line that the harness's regex doesn't
    // match — without this, an actively-streaming droid drops to 'unknown'
    // and the 5s content-stable timeout flips it to 'idle' mid-response.
    const tail = pane.split('\n').slice(-15).join('\n')
    if (/Streaming|Thinking|Working|Plan\s*·/i.test(tail)) return 'running'
    if (/[⁝⋮⋯⢀⢄⡠⡂⠅⠅⢁⣷⣯⣟⡿⢿⣻⣽⣾▰▱▮▯●○⛬]/.test(tail)) return 'running'
    return (harness.detectStatus?.(pane) ?? 'unknown') as AgentStatus
  },
}
