import { loadState } from '../state'
import * as tmux from '../tmux'

interface AgentInfo {
  name: string
  cli: string
  model: string
  status: string
  dir: string
  age: string
  parentName: string
  children: AgentInfo[]
}

export function list(): void {
  const state = loadState()
  const agents = state.agents ?? {}

  if (Object.keys(agents).length === 0) {
    console.log('No agents running. Use "flt spawn" to start one.')
    return
  }

  // Build agent info with live status
  const infos: Record<string, AgentInfo> = {}
  for (const [name, agent] of Object.entries(agents)) {
    const isSsh = agent.location?.type === 'ssh'
    let status = 'dead'
    if (isSsh) {
      status = agent.status ?? 'unknown'
    } else if (tmux.hasSession(agent.tmuxSession)) {
      status = agent.status ?? 'unknown'
    }

    const displayName = (agent.location?.type === 'ssh' || agent.location?.type === 'ssh+sandbox')
      ? `${name} (ssh: ${agent.location.host})`
      : name

    infos[name] = {
      name: displayName,
      cli: agent.cli,
      model: agent.model,
      status,
      dir: shortenPath(agent.dir),
      age: formatAge(agent.spawnedAt),
      parentName: agent.parentName,
      children: [],
    }
  }

  // Build tree structure
  const roots: AgentInfo[] = []
  for (const info of Object.values(infos)) {
    const parent = infos[info.parentName]
    if (parent) {
      parent.children.push(info)
    } else {
      roots.push(info)
    }
  }

  // Print header
  const orchAge = state.orchestrator
    ? formatAge(state.orchestrator.initAt)
    : '?'
  console.log(`flt fleet (initiated ${orchAge} ago)`)

  // Print tree
  for (let i = 0; i < roots.length; i++) {
    const isLast = i === roots.length - 1
    printNode(roots[i], '', isLast)
  }
}

function printNode(node: AgentInfo, prefix: string, isLast: boolean): void {
  const connector = isLast ? '└── ' : '├── '
  const statusColor = colorForStatus(node.status)

  const line = [
    padRight(node.name, 12),
    padRight(node.cli, 12),
    padRight(node.model, 14),
    padRight(statusColor, 14),
    padRight(node.dir, 30),
    node.age,
  ].join(' ')

  console.log(`${prefix}${connector}${line}`)

  const childPrefix = prefix + (isLast ? '    ' : '│   ')
  for (let i = 0; i < node.children.length; i++) {
    printNode(node.children[i], childPrefix, i === node.children.length - 1)
  }
}

function colorForStatus(status: string): string {
  switch (status) {
    case 'running': return `\x1b[33m${status}\x1b[0m` // yellow
    case 'idle': return `\x1b[32m${status}\x1b[0m`    // green
    case 'error': return `\x1b[31m${status}\x1b[0m`    // red
    case 'rate-limited': return `\x1b[31m${status}\x1b[0m`
    case 'dead': return `\x1b[90m${status}\x1b[0m`     // gray
    default: return status
  }
}

function padRight(s: string, n: number): string {
  // Strip ANSI for length calculation
  const visible = s.replace(/\x1b\[[0-9;]*m/g, '')
  const pad = Math.max(0, n - visible.length)
  return s + ' '.repeat(pad)
}

function shortenPath(p: string): string {
  const home = process.env.HOME || ''
  if (home && p.startsWith(home)) {
    return '~' + p.slice(home.length)
  }
  return p
}

function formatAge(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime()
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}
