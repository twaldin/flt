import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { getAdapter as getHarnessAdapter } from '@twaldin/harness-ts'

const harness = getHarnessAdapter('factory-droid')
const OAUTH_PROXY = 'http://127.0.0.1:10531/v1'

interface FactoryCustomModel {
  id?: unknown
  model?: unknown
}

function factorySettingsPath(): string {
  return join(process.env.FACTORY_HOME || join(process.env.HOME || homedir(), '.factory'), 'settings.json')
}

function stripProvider(model: string): string {
  return model.replace(/^(openai|openai-codex)\//, '')
}

function resolveDroidModelId(model: string): string {
  const requested = stripProvider(model.trim())
  const bare = requested.replace(/^custom:/, '')
  const settingsPath = factorySettingsPath()

  if (existsSync(settingsPath)) {
    try {
      const parsed = JSON.parse(readFileSync(settingsPath, 'utf-8')) as { customModels?: FactoryCustomModel[] }
      const customModels = Array.isArray(parsed.customModels) ? parsed.customModels : []
      const exact = customModels.find(m => m.id === requested)
      if (typeof exact?.id === 'string') return exact.id
      const byModel = customModels.find(m => m.model === bare)
      if (typeof byModel?.id === 'string') return byModel.id
    } catch {
      // Fall through to the historical shorthand.
    }
  }

  return requested.startsWith('custom:') ? requested : `custom:${requested}`
}

// droid stores per-session settings JSON. For BYOK/OpenAI OAuth routes, the
// `model` field must be the exact customModels[].id from ~/.factory/settings.json
// (e.g. "custom:gpt-5.5-(codex-oauth)-0"), not the bare proxy model slug.
function writeDroidSettings(workdir: string, modelId: string): string {
  const dir = join(workdir, '.flt', 'droid')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'settings.json')
  writeFileSync(path, JSON.stringify({
    model: resolveDroidModelId(modelId),
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
