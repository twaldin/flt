import type { CliAdapter, SpawnOpts, ReadyState, AgentStatus } from './types'
import { existsSync, readdirSync } from 'fs'
import { homedir } from 'os'

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
}

// Gemini CLI requires Node 20+. Find a suitable node binary.
function findNodePath(): string | null {
  const home = homedir()
  const candidates = [
    '/opt/homebrew/opt/node@24/bin',
    '/opt/homebrew/opt/node@22/bin',
    '/opt/homebrew/opt/node@20/bin',
    '/usr/local/opt/node@24/bin',
    '/usr/local/opt/node@22/bin',
    '/usr/local/opt/node@20/bin',
  ]

  // Add nvm-managed Node 20+ versions (highest first)
  const nvmDir = `${home}/.nvm/versions/node`
  if (existsSync(nvmDir)) {
    try {
      const versions = readdirSync(nvmDir)
        .filter(v => /^v(2[0-9]|[3-9]\d)/.test(v))
        .sort((a, b) => {
          const [ma, na] = a.slice(1).split('.').map(Number)
          const [mb, nb] = b.slice(1).split('.').map(Number)
          return mb - ma || nb - na
        })
      for (const v of versions) {
        candidates.push(`${nvmDir}/${v}/bin`)
      }
    } catch {}
  }

  for (const dir of candidates) {
    if (existsSync(`${dir}/node`)) return dir
  }
  return null
}

export const geminiAdapter: CliAdapter = {
  name: 'gemini',
  cliCommand: 'gemini',
  instructionFile: 'GEMINI.md',
  submitKeys: ['Enter'],

  spawnArgs(opts: SpawnOpts): string[] {
    const nodePath = findNodePath()
    // Prepend node 20+ to PATH so gemini uses it
    const prefix = nodePath ? `PATH=${nodePath}:$PATH ` : ''
    const args = [`${prefix}gemini`]
    if (opts.model) args.push('--model', opts.model)
    return args
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
    // "Action Required" / "Allow execution" permission prompt
    // Select "Allow for this session" (option 2) so it doesn't prompt again
    if (/Action Required/i.test(pane) && /Allow/i.test(pane)) {
      return ['Down', 'Enter']
    }
    return null
  },

  detectStatus(pane: string): AgentStatus {
    pane = stripAnsi(pane)
    const lines = pane.split('\n').map(l => l.trim()).filter(Boolean)
    const last20 = lines.slice(-20).join('\n')
    const last10 = lines.slice(-10).join('\n')

    // Permission prompt — auto-approve
    if (/Action Required/i.test(last20) && /Allow/i.test(last20)) {
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
