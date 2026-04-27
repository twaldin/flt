#!/usr/bin/env bun

import { existsSync, unlinkSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'
import type { ControllerRequest, ControllerResponse } from './client'
import { getSocketPath, getPidPath } from './client'
import { startPolling, stopPolling, setStatusChangeCallback } from './poller'
import { loadState, setAgent, allAgents, getStateDir } from '../state'

// Mark this process as the controller
process.env.FLT_CONTROLLER = '1'

const socketPath = getSocketPath()
const pidPath = getPidPath()

// Clean up stale socket
if (existsSync(socketPath)) {
  try { unlinkSync(socketPath) } catch {}
}

// Write PID file
writeFileSync(pidPath, String(process.pid))

// Reconcile: discover live agent sessions not in state
reconcileAgents()

// Start status polling
startPolling(1000)

// Workflow advancement: when an agent goes idle, check if it's a workflow step
setStatusChangeCallback((name, prev, next) => {
  if (next === 'idle' && prev === 'running') {
    // Check if this agent belongs to a workflow
    import('../workflow/engine').then(({ getWorkflowForAgent, advanceWorkflow }) => {
      const workflowName = getWorkflowForAgent(name)
      if (workflowName) {
        console.log(`[workflow] Agent "${name}" went idle — advancing workflow "${workflowName}"`)
        advanceWorkflow(workflowName, name).catch(e => {
          console.error(`[workflow] Failed to advance "${workflowName}": ${e.message}`)
        })
      }
    }).catch(() => {})
  }

  // Handle agent death → workflow failure
  if (next === 'unknown' && prev && prev !== 'unknown') {
    import('../workflow/engine').then(({ getWorkflowForAgent, handleStepFailure }) => {
      import('../tmux').then(({ hasSession }) => {
        if (!hasSession(`flt-${name}`)) {
          const workflowName = getWorkflowForAgent(name)
          if (workflowName) {
            console.log(`[workflow] Agent "${name}" died — handling failure for workflow "${workflowName}"`)
            handleStepFailure(workflowName).catch(e => {
              console.error(`[workflow] Failed to handle failure for "${workflowName}": ${e.message}`)
            })
          }
        }
      })
    }).catch(() => {})
  }
})

// HTTP server on Unix socket
const server = Bun.serve({
  unix: socketPath,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)

    // Health check endpoint
    if (url.pathname === '/ping') {
      return Response.json({ ok: true, pid: process.pid, uptime: process.uptime() })
    }

    if (url.pathname !== '/rpc' || req.method !== 'POST') {
      return Response.json({ ok: false, error: 'Not found' }, { status: 404 })
    }

    try {
      const body = await req.json() as ControllerRequest
      const result = await handleAction(body)
      return Response.json(result)
    } catch (e) {
      return Response.json({ ok: false, error: (e as Error).message }, { status: 500 })
    }
  },
})

console.log(`flt controller started (pid ${process.pid}, socket ${socketPath})`)

async function handleAction(req: ControllerRequest): Promise<ControllerResponse> {
  switch (req.action) {
    case 'ping':
      return { ok: true, data: { pid: process.pid, uptime: process.uptime() } }

    case 'spawn': {
      const { spawnDirect } = await import('../commands/spawn')
      try {
        await spawnDirect(req.args as Parameters<typeof spawnDirect>[0])
        return { ok: true, data: `Spawned ${req.args.name}` }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    }

    case 'kill': {
      const { killDirect } = await import('../commands/kill')
      try {
        killDirect(req.args)
        return { ok: true, data: `Killed ${req.args.name}` }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    }

    case 'send': {
      const { sendDirect } = await import('../commands/send')
      try {
        await sendDirect(req.args as Parameters<typeof sendDirect>[0])
        return { ok: true, data: `Sent to ${req.args.target}` }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    }

    case 'list':
      return { ok: true, data: allAgents() }

    case 'status':
      return {
        ok: true,
        data: {
          pid: process.pid,
          uptime: process.uptime(),
          agents: Object.keys(allAgents()).length,
        },
      }

    default:
      return { ok: false, error: `Unknown action: ${req.action}` }
  }
}

function reconcileAgents(): void {
  let sessions: string[]
  try {
    const out = execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], {
      encoding: 'utf-8', timeout: 5000,
    }).trim()
    sessions = out.split('\n').filter(Boolean)
  } catch {
    return
  }

  const state = loadState()
  const fltSessions = sessions.filter(s => s.startsWith('flt-'))

  for (const session of fltSessions) {
    const name = session.slice(4)
    if (['shell', 'controller'].includes(name) || state.agents[name]) continue

    let env: Record<string, string> = {}
    try {
      const raw = execFileSync('tmux', ['show-environment', '-t', session], {
        encoding: 'utf-8', timeout: 3000,
      }).trim()
      for (const line of raw.split('\n')) {
        const eq = line.indexOf('=')
        if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1)
      }
    } catch { continue }

    if (!env.FLT_AGENT_NAME) continue

    let dir = ''
    try {
      dir = execFileSync('tmux', ['display-message', '-t', session, '-p', '#{pane_current_path}'], {
        encoding: 'utf-8', timeout: 3000,
      }).trim()
    } catch {}

    let cli = 'unknown'
    let model = 'unknown'
    try {
      const pid = execFileSync('tmux', ['list-panes', '-t', session, '-F', '#{pane_pid}'], {
        encoding: 'utf-8', timeout: 3000,
      }).trim().split('\n')[0]
      if (pid) {
        let children: string[] = []
        try {
          children = execFileSync('pgrep', ['-P', pid], {
            encoding: 'utf-8', timeout: 3000,
          }).trim().split('\n').filter(Boolean)
        } catch {}

        for (const cpid of [pid, ...children]) {
          let args = ''
          try {
            args = execFileSync('ps', ['-p', cpid, '-o', 'args='], {
              encoding: 'utf-8', timeout: 3000,
            }).trim()
          } catch { continue }

          if (args.includes('codex')) { cli = 'codex'; model = extractFlag(args, '--model') ?? model }
          else if (args.includes('claude')) { cli = 'claude-code'; model = extractFlag(args, '--model') ?? model }
          else if (args.includes('gemini')) { cli = 'gemini'; model = extractFlag(args, '--model') ?? model }
          else if (args.includes('opencode')) { cli = 'opencode'; model = extractFlag(args, '--model') ?? model }

          if (cli !== 'unknown') break
        }
      }
    } catch {}

    let worktreePath: string | undefined
    let worktreeBranch: string | undefined
    if (dir.includes('flt-wt-')) {
      worktreePath = dir
      try {
        worktreeBranch = execFileSync('git', ['-C', dir, 'branch', '--show-current'], {
          encoding: 'utf-8', timeout: 3000,
        }).trim() || undefined
      } catch {}
    }

    setAgent(name, {
      cli, model, tmuxSession: session,
      parentName: env.FLT_PARENT_NAME ?? 'unknown',
      dir, worktreePath, worktreeBranch,
      spawnedAt: new Date().toISOString(),
    })
  }
}

function extractFlag(args: string, flag: string): string | null {
  const idx = args.indexOf(flag)
  if (idx === -1) return null
  const rest = args.slice(idx + flag.length).trimStart()
  const value = rest.split(/\s/)[0]
  return value || null
}

// Cleanup on shutdown
function cleanup(): void {
  stopPolling()
  try { unlinkSync(socketPath) } catch {}
  try { unlinkSync(pidPath) } catch {}
  server.stop()
  process.exit(0)
}

process.on('SIGTERM', cleanup)
process.on('SIGINT', cleanup)
