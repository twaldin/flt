import { execSync } from 'node:child_process'

export interface RunCmdOpts {
  cwd: string
  timeoutMs?: number
  allowFail?: boolean
}

export function runCmd(cmd: string, opts: RunCmdOpts): string {
  try {
    return execSync(cmd, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    if (opts.allowFail) return ''
    throw error
  }
}
