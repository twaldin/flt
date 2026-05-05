import { existsSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { addRemote as addRemoteEntry, loadRemotes, removeRemote as removeRemoteEntry } from '../remotes'
import type { RemoteEntry } from '../remotes'
import { rsyncTo, sshExec, sshExecCheck } from '../ssh'

interface AddRemoteArgs {
  alias: string
  host: string
  user?: string
  port?: number
  identityFile?: string
}

function validateAlias(alias: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(alias)) {
    throw new Error('Remote alias must be alphanumeric with dashes/underscores only.')
  }
}

function pad(value: string, width: number): string {
  return value.padEnd(width)
}

function mapAsset(unameOutput: string): string | null {
  const [archRaw = '', osRaw = ''] = unameOutput.trim().split(/\r?\n/)
  const arch = archRaw.trim().toLowerCase()
  const os = osRaw.trim().toLowerCase()

  const osPart = os === 'darwin' ? 'darwin' : os === 'linux' ? 'linux' : null
  const archPart = arch === 'arm64' || arch === 'aarch64'
    ? 'arm64'
    : arch === 'x86_64' || arch === 'amd64'
      ? 'x86_64'
      : null

  if (!osPart || !archPart) return null
  return `flt-${osPart}-${archPart}`
}

export async function addRemote(args: AddRemoteArgs): Promise<void> {
  validateAlias(args.alias)

  const remote: RemoteEntry = {
    host: args.host,
    user: args.user,
    port: args.port,
    identityFile: args.identityFile,
  }

  const probe = sshExecCheck(remote, 'true')
  if (probe !== true) {
    throw new Error(`SSH authentication probe failed for ${args.host}.\n${probe.error}`)
  }

  const uname = sshExec(remote, 'uname -m && uname -s')
  if (uname.status !== 0) {
    throw new Error(`Failed to detect remote architecture: ${uname.stderr || uname.stdout}`)
  }

  const asset = mapAsset(uname.stdout)
  if (!asset) {
    throw new Error(`Unsupported remote architecture. Raw uname output:\n${uname.stdout}`)
  }

  const version = require('../../package.json').version as string
  const url = `https://github.com/twaldin/flt/releases/download/v${version}/${asset}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download ${asset} from ${url}: HTTP ${response.status}`)
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'flt-remote-'))
  const tempFile = join(tempDir, 'flt')
  const bytes = new Uint8Array(await response.arrayBuffer())
  await Bun.write(tempFile, bytes)

  rsyncTo(remote, tempFile, '~/.flt/bin/flt', { isDirectory: false })

  const chmodResult = sshExec(remote, 'mkdir -p ~/.flt/bin && chmod +x ~/.flt/bin/flt')
  if (chmodResult.status !== 0) {
    throw new Error(`Failed to finalize remote binary install: ${chmodResult.stderr || chmodResult.stdout}`)
  }

  const skillsDir = join(process.env.HOME || '', '.flt', 'skills')
  if (skillsDir && existsSync(skillsDir)) {
    rsyncTo(remote, skillsDir, '~/.flt/skills/', { isDirectory: true })
  } else {
    console.warn(`Warning: local skills directory not found at ${skillsDir}; skipping skills sync.`)
  }

  addRemoteEntry(args.alias, remote)

  const user = remote.user ?? process.env.USER ?? 'user'
  const port = remote.port ?? 22
  console.log(`Added remote "${args.alias}" → ${user}@${remote.host}:${port}`)
  console.log('Next step: authenticate your coding CLI on the remote host (for example: `claude /login`).')
}

export function listRemotes(): void {
  const remotes = loadRemotes()
  const rows = Object.entries(remotes)
  if (rows.length === 0) {
    console.log('No remotes configured. Use "flt add remote <alias> <host>" to add one.')
    return
  }

  const headers = ['alias', 'host', 'user', 'port', 'identityFile']
  const body = rows.map(([alias, entry]) => [
    alias,
    entry.host,
    entry.user ?? '',
    entry.port !== undefined ? String(entry.port) : '',
    entry.identityFile ?? '',
  ])
  const widths = headers.map((header, idx) => Math.max(header.length, ...body.map((row) => row[idx].length)))

  console.log(headers.map((h, i) => pad(h, widths[i])).join('  '))
  console.log(widths.map((w) => '-'.repeat(w)).join('  '))
  for (const row of body) {
    console.log(row.map((v, i) => pad(v, widths[i])).join('  '))
  }
}

export function removeRemote(alias: string): void {
  if (removeRemoteEntry(alias)) {
    console.log(`Removed remote "${alias}".`)
    return
  }
  console.log(`No such remote: "${alias}".`)
}
