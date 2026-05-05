import { execFileSync } from 'child_process'
import { statSync } from 'fs'
import type { RemoteEntry } from './remotes'

export interface SshExecResult {
  stdout: string
  stderr: string
  status: number
}

function renderTarget(remote: RemoteEntry): string {
  return remote.user ? `${remote.user}@${remote.host}` : remote.host
}

function isTruthyString(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function buildSshOptionArgs(remote: RemoteEntry): string[] {
  const args: string[] = []

  if (typeof remote.port === 'number') {
    args.push('-p', String(remote.port))
  }
  if (isTruthyString(remote.identityFile)) {
    args.push('-i', remote.identityFile)
  }

  args.push('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5')
  return args
}

export function buildSshArgs(remote: RemoteEntry, extra: string[] = []): string[] {
  return [...buildSshOptionArgs(remote), '--', renderTarget(remote), ...extra]
}

export function sshExec(remote: RemoteEntry, command: string, opts?: { input?: string }): SshExecResult {
  try {
    const stdout = execFileSync('ssh', buildSshArgs(remote, [command]), {
      encoding: 'utf-8',
      input: opts?.input,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { stdout, stderr: '', status: 0 }
  } catch (error) {
    const e = error as NodeJS.ErrnoException & { status?: number; stdout?: string; stderr?: string }
    return {
      stdout: typeof e.stdout === 'string' ? e.stdout : '',
      stderr: typeof e.stderr === 'string' ? e.stderr : e.message,
      status: typeof e.status === 'number' ? e.status : 1,
    }
  }
}

export function sshExecCheck(remote: RemoteEntry, command: string): true | { error: string } {
  try {
    execFileSync('ssh', buildSshArgs(remote, [command]), {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return true
  } catch (error) {
    const e = error as NodeJS.ErrnoException & { status?: number; stderr?: string }
    const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : ''
    if (e.status === 255) {
      if (stderr.includes('Permission denied')) {
        return { error: `SSH authentication failed for ${remote.host}: ${stderr}` }
      }
      if (stderr.includes('Host key verification failed')) {
        return { error: `SSH host key verification failed for ${remote.host}: ${stderr}` }
      }
    }
    return { error: `SSH check failed for ${remote.host}: ${stderr || e.message}` }
  }
}

function shellEscapeArg(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

function detectDirectory(localPath: string): boolean {
  if (localPath.endsWith('/')) {
    return true
  }
  try {
    return statSync(localPath).isDirectory()
  } catch {
    return false
  }
}

export function rsyncTo(remote: RemoteEntry, localPath: string, remotePath: string, opts?: { isDirectory?: boolean }): void {
  const isDirectory = opts?.isDirectory ?? detectDirectory(localPath)
  const source = isDirectory && !localPath.endsWith('/') ? `${localPath}/` : localPath
  const destinationBase = renderTarget(remote)
  const destination = isDirectory && !remotePath.endsWith('/')
    ? `${destinationBase}:${remotePath}/`
    : `${destinationBase}:${remotePath}`

  const sshCommand = ['ssh', ...buildSshOptionArgs(remote)].map(shellEscapeArg).join(' ')

  execFileSync('rsync', ['-az', '-e', sshCommand, source, destination], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

export function shellEscapeSingle(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}
