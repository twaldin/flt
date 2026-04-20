import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'
import { stripAnsi } from '../utils/stripAnsi'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getAdapter as getHarnessAdapter } from '@twaldin/harness-ts'

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
  instructionFile: getHarnessAdapter('gemini').instructionsFilename,
  submitKeys: ['Enter'],

  spawnArgs(opts: SpawnOpts): string[] {
    const args = ['gemini']
    if (opts.model) args.push('--model', opts.model)
    return args
  },

  env(): Record<string, string> {
    const env: Record<string, string> = {}
    const key = loadGeminiKey()
    if (key) env.GEMINI_API_KEY = key
    return env
  },

  detectReady(pane: string): ReadyState {
    pane = stripAnsi(pane)
    const lines = pane.split('\n').map(l => l.trim()).filter(Boolean)
    const last20 = lines.slice(-20).join('\n')

    // Gemini ready prompt
    if (/Type your message/i.test(last20) || /[>❯]\s*$/.test(last20)) {
      return 'ready'
    }

    return 'loading'
  },

  handleDialog(pane: string): string[] | null {
    pane = stripAnsi(pane)
    // Trust folder dialog — option 1 is already selected, just press Enter
    if (/Do you trust the files/i.test(pane) || /Trust folder/i.test(pane)) {
      return ['Enter']
    }
    // Permission prompts: "Action Required" or "Allow execution of [tool]?"
    // Accept whatever option is selected (usually "Allow once")
    if (/Action Required/i.test(pane) && /Allow/i.test(pane)) {
      return ['Enter']
    }
    if (/Allow execution of/i.test(pane)) {
      return ['Enter']
    }
    return null
  },

  detectStatus(pane: string): AgentStatus {
    pane = stripAnsi(pane)
    const lines = pane.split('\n').map(l => l.trim()).filter(Boolean)
    const last20 = lines.slice(-20).join('\n')
    const last10 = lines.slice(-10).join('\n')

    // Trust folder or permission prompt — auto-approve
    if (/Do you trust the files/i.test(last20) || /Trust folder/i.test(last20)) {
      return 'dialog' as AgentStatus
    }
    if (/Action Required/i.test(last20) && /Allow/i.test(last20)) {
      return 'dialog' as AgentStatus
    }
    if (/Allow execution of/i.test(last20)) {
      return 'dialog' as AgentStatus
    }

    if (/rate.?limit|quota.?exceeded|resource.?exhausted/i.test(last10)) {
      return 'rate-limited'
    }

    if (/error/i.test(last10) && /fatal|crash/i.test(last10)) {
      return 'error'
    }

    // Gemini spinners: braille ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏ (tool exec) or toggle ⊶⊷ (executing)
    if (/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⊶⊷]/.test(last10)) return 'running'
    if (/Thinking\.\.\./i.test(last10)) return 'running'

    // Idle: "◇  Ready" or prompt
    if (/Ready/i.test(last10) || /Type your message/i.test(last10)) return 'idle'
    // Success markers mean task done
    if (/[✓✔]/.test(last10) && !/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⊶⊷]/.test(last10)) return 'idle'

    return 'unknown'
  },
}
