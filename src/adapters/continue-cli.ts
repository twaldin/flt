import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getAdapter as getHarnessAdapter } from '@twaldin/harness-ts'

const harness = getHarnessAdapter('continue-cli')
const OAUTH_PROXY = 'http://127.0.0.1:10531/v1'

function writeContinueConfig(workdir: string, model: string): string {
  // cn loads a Continue config to know which model + provider to call.
  // Write a minimal one in the workdir; spawnArgs passes --config <file>.
  const dir = join(workdir, '.flt', 'continue')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'config.yaml')
  const yaml = [
    'name: flt-continue',
    'version: 1.0.0',
    'schema: v1',
    'models:',
    '  - name: flt-model',
    `    model: ${model}`,
    '    provider: openai',
    '    apiKey: unused',
    `    apiBase: ${OAUTH_PROXY}`,
    '    roles:',
    '      - chat',
    '      - edit',
    '      - apply',
    '',
  ].join('\n')
  writeFileSync(path, yaml)
  return path
}

export const continueCliAdapter: CliAdapter = {
  name: 'continue-cli',
  cliCommand: 'cn',
  instructionFile: harness.instructionsFilename || 'AGENTS.md',
  submitKeys: harness.submitKeys ?? ['Enter'],

  spawnArgs(opts: SpawnOpts): string[] {
    const model = opts.model ?? 'gpt-5.4'
    const config = writeContinueConfig(opts.dir, model)
    return ['cn', '--config', config]
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
    return (harness.detectStatus?.(pane) ?? 'unknown') as AgentStatus
  },
}
