import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { basename, join } from 'path'
import { loadWorkflowDef } from '../workflow/parser'
import { loadWorkflowRun, workflowAgentName } from '../workflow/engine'
import { getAgent } from '../state'
import { getPreset } from '../presets'
import { redactSecrets } from '../redact'

type TranscriptRole = 'user' | 'assistant' | 'tool'

export interface TranscriptEntry {
  ts: string
  agent: string
  role: TranscriptRole
  content: string
  tokens?: number
}

interface AgentRef {
  name: string
  cli?: string
  workdir?: string
}

const ISO_FALLBACK = '1970-01-01T00:00:00.000Z'

function toIso(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value) return fallback
  const t = Date.parse(value)
  if (!Number.isFinite(t)) return fallback
  return new Date(t).toISOString()
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function parseJsonl(path: string): unknown[] {
  const out: unknown[] = []
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      out.push(JSON.parse(trimmed))
    } catch {
      // skip malformed lines
    }
  }
  return out
}

function contentFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(contentFromUnknown).filter(Boolean).join('\n')
  if (!value || typeof value !== 'object') return ''
  const obj = value as Record<string, unknown>
  if (typeof obj.text === 'string') return obj.text
  if (typeof obj.content === 'string') return obj.content
  if (typeof obj.message === 'string') return obj.message
  if (obj.content !== undefined) return contentFromUnknown(obj.content)
  if (obj.text !== undefined) return contentFromUnknown(obj.text)
  return ''
}

function roleFromUnknown(value: unknown): TranscriptRole | null {
  if (value === 'model') return 'assistant'
  if (value === 'assistant' || value === 'user' || value === 'tool') return value
  if (value === 'human') return 'user'
  if (value === 'tool_use' || value === 'tool_result') return 'tool'
  return null
}

function parseClaude(path: string, agent: string, fallbackTs: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = []
  for (const ev of parseJsonl(path)) {
    if (!ev || typeof ev !== 'object') continue
    const obj = ev as Record<string, unknown>
    const role = roleFromUnknown(obj.type)
    if (!role) continue
    const msg = obj.message as Record<string, unknown> | undefined
    const usage = msg?.usage as Record<string, unknown> | undefined
    const tokens = typeof usage?.output_tokens === 'number' ? usage.output_tokens : undefined
    entries.push({
      ts: toIso(obj.timestamp, fallbackTs),
      agent,
      role,
      content: contentFromUnknown(msg?.content ?? obj.content),
      ...(tokens === undefined ? {} : { tokens }),
    })
  }
  return entries
}

function parseRoleJsonl(path: string, agent: string, fallbackTs: string): TranscriptEntry[] {
  const out: TranscriptEntry[] = []
  for (const ev of parseJsonl(path)) {
    if (!ev || typeof ev !== 'object') continue
    const obj = ev as Record<string, unknown>
    const payload = (obj.payload && typeof obj.payload === 'object') ? obj.payload as Record<string, unknown> : undefined
    const message = (obj.message && typeof obj.message === 'object') ? obj.message as Record<string, unknown> : undefined
    const role = roleFromUnknown(obj.role ?? payload?.role ?? message?.role)
    if (!role) continue
    out.push({
      ts: toIso(obj.timestamp ?? payload?.timestamp, fallbackTs),
      agent,
      role,
      content: contentFromUnknown(obj.content ?? payload?.content ?? message?.content ?? message?.text),
    })
  }
  return out
}

function parseGemini(path: string, agent: string, fallbackTs: string): TranscriptEntry[] {
  const raw = readJson(path)
  if (!Array.isArray(raw)) return []
  return raw
    .filter(ev => ev && typeof ev === 'object')
    .map(ev => ev as Record<string, unknown>)
    .map(ev => ({
      ts: toIso(ev.ts ?? ev.timestamp ?? ev.createdAt, fallbackTs),
      agent,
      role: roleFromUnknown(ev.role) ?? 'assistant',
      content: contentFromUnknown(ev.content ?? ev.message ?? ev.text),
    }))
}

function parseSwe(path: string, agent: string, fallbackTs: string): TranscriptEntry[] {
  const raw = readJson(path)
  if (!raw || typeof raw !== 'object') return []
  const obj = raw as Record<string, unknown>
  const trajectory = Array.isArray(obj.trajectory) ? obj.trajectory : (Array.isArray(obj.messages) ? obj.messages : [])
  const entries: TranscriptEntry[] = []
  for (let i = 0; i < trajectory.length; i += 1) {
    const step = trajectory[i]
    if (!step || typeof step !== 'object') continue
    const rec = step as Record<string, unknown>
    const role = roleFromUnknown(rec.role) ?? (i % 2 === 0 ? 'user' : 'assistant')
    entries.push({
      ts: toIso(rec.ts ?? rec.timestamp, fallbackTs),
      agent,
      role,
      content: contentFromUnknown(rec.content ?? rec.message ?? rec.text),
    })
  }
  return entries
}

function parseOpencode(sessionPath: string, agent: string, fallbackTs: string): TranscriptEntry[] {
  const dbPath = sessionPath.split('#')[0]
  const sessionHint = sessionPath.match(/session\(([^)]+)\)$/)?.[1] ?? ''
  if (!existsSync(dbPath)) return []
  const { Database } = require('bun:sqlite') as { Database: new (path: string, opts?: { readonly?: boolean }) => {
    prepare: (sql: string) => { all: (...params: unknown[]) => unknown[] }
    close: () => void
  } }
  const db = new Database(dbPath, { readonly: true })
  try {
    const rows = db.prepare(`
      SELECT message.data AS data, message.time_created AS ts
      FROM message
      JOIN session ON session.id = message.session_id
      WHERE session.directory LIKE ?
      ORDER BY message.time_created ASC
    `).all(`%${sessionHint}%`)

    const out: TranscriptEntry[] = []
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      const record = row as Record<string, unknown>
      const payloadRaw = record.data
      if (typeof payloadRaw !== 'string') continue
      let payload: unknown
      try {
        payload = JSON.parse(payloadRaw)
      } catch {
        continue
      }
      if (!payload || typeof payload !== 'object') continue
      const obj = payload as Record<string, unknown>
      const role = roleFromUnknown(obj.role)
      if (!role) continue
      out.push({
        ts: toIso(typeof record.ts === 'number' ? new Date(record.ts).toISOString() : record.ts, fallbackTs),
        agent,
        role,
        content: contentFromUnknown(obj.content ?? obj.text),
      })
    }
    return out
  } finally {
    db.close()
  }
}

function sessionLogPath(cli: string, workdir: string): string | null {
  try {
    const { getAdapter } = require('@twaldin/harness-ts') as { getAdapter: (name: string) => { sessionLogPath?: (wd: string) => string | null } }
    const name = cli === 'droid' ? 'factory-droid' : cli
    const adapter = getAdapter(name)
    return adapter.sessionLogPath?.(workdir) ?? null
  } catch {
    return null
  }
}

function fallbackEntry(agent: string, ts: string): TranscriptEntry[] {
  const path = join(process.env.HOME ?? homedir(), '.flt', 'logs', `flt-${agent}.tmux.log`)
  const content = existsSync(path) ? readFileSync(path, 'utf-8') : ''
  return [{ ts, agent, role: 'assistant', content }]
}

function collectAgents(run: NonNullable<ReturnType<typeof loadWorkflowRun>>): AgentRef[] {
  const byName = new Map<string, AgentRef>()
  for (const group of Object.values(run.parallelGroups ?? {})) {
    for (const candidate of group.candidates) {
      byName.set(candidate.agentName, {
        name: candidate.agentName,
        cli: getPreset(candidate.preset)?.cli,
        workdir: candidate.worktree,
      })
    }
  }

  const def = (() => {
    try {
      return loadWorkflowDef(run.workflow)
    } catch {
      return null
    }
  })()
  const stepPreset = new Map<string, string>()
  if (def) {
    for (const step of def.steps) {
      if ((step.type === undefined || step.type === 'spawn') && step.preset) {
        stepPreset.set(step.id, step.preset)
      }
    }
  }

  for (const h of run.history) {
    if (!h.agent) continue
    const stepId = Array.from(stepPreset.keys()).find(id => workflowAgentName(run.id, id) === h.agent)
    const vars = stepId ? run.vars[stepId] : undefined
    const preset = stepId ? stepPreset.get(stepId) : undefined
    byName.set(h.agent, {
      name: h.agent,
      cli: preset ? getPreset(preset)?.cli : undefined,
      workdir: vars?.worktree ?? vars?.dir,
    })
  }

  for (const [name, ref] of byName) {
    const stateAgent = getAgent(name)
    if (!stateAgent) continue
    byName.set(name, {
      ...ref,
      cli: ref.cli ?? stateAgent.cli,
      workdir: ref.workdir ?? stateAgent.worktreePath ?? stateAgent.dir,
    })
  }

  return Array.from(byName.values())
}

function parseForCli(cli: string, path: string, agent: string, fallbackTs: string): TranscriptEntry[] {
  if (cli === 'claude-code') return parseClaude(path, agent, fallbackTs)
  if (cli === 'codex' || cli === 'pi') return parseRoleJsonl(path, agent, fallbackTs)
  if (cli === 'gemini') return parseGemini(path, agent, fallbackTs)
  if (cli === 'swe-agent') return parseSwe(path, agent, fallbackTs)
  if (cli === 'opencode') return parseOpencode(path, agent, fallbackTs)
  throw new Error(`unsupported cli: ${cli}`)
}

export async function traceExport(runId: string): Promise<{ outPath: string; entryCount: number }> {
  const run = loadWorkflowRun(runId)
  if (!run || !run.runDir) {
    throw new Error(`Workflow run "${runId}" not found.`)
  }

  const refs = collectAgents(run)
  if (refs.length === 0) {
    throw new Error(`Workflow run "${runId}" has no agents.`)
  }

  const out: TranscriptEntry[] = []
  const fallbackTs = toIso(run.startedAt, ISO_FALLBACK)
  for (const ref of refs) {
    if (!ref.cli || !ref.workdir) {
      out.push(...fallbackEntry(ref.name, fallbackTs))
      continue
    }

    const logPath = sessionLogPath(ref.cli, ref.workdir)
    if (!logPath) {
      out.push(...fallbackEntry(ref.name, fallbackTs))
      continue
    }

    try {
      const parsed = parseForCli(ref.cli, logPath, ref.name, fallbackTs)
      if (parsed.length === 0) {
        out.push(...fallbackEntry(ref.name, fallbackTs))
      } else {
        out.push(...parsed)
      }
    } catch {
      out.push(...fallbackEntry(ref.name, fallbackTs))
    }
  }

  const redacted = out
    .map(entry => ({ ...entry, content: redactSecrets(entry.content), ts: toIso(entry.ts, fallbackTs) }))
    .sort((a, b) => a.ts.localeCompare(b.ts))

  const outPath = join(run.runDir, 'transcript.jsonl')
  const tmp = `${outPath}.tmp`
  const payload = redacted.map(e => JSON.stringify(e)).join('\n') + (redacted.length ? '\n' : '')
  writeFileSync(tmp, payload, 'utf-8')
  renameSync(tmp, outPath)

  return { outPath, entryCount: redacted.length }
}
