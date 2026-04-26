import { existsSync, readFileSync, statSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { createRequire } from 'module'
import { getPreset } from '../presets'
import { loadWorkflowRun, workflowAgentName } from '../workflow/engine'
import { loadWorkflowDef } from '../workflow/parser'
import type { SpawnStep, WorkflowStepDef, WorkflowRun } from '../workflow/types'
import { stripAnsi } from '../utils/stripAnsi'

export interface TranscriptLine {
  ts: string
  agent: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  tokens?: number
}

interface RunAgent {
  name: string
  cli: string
  workdir: string
}

export function traceExport(runId: string): void {
  const run = loadWorkflowRun(runId)
  if (!run) throw new Error(`No workflow run found for "${runId}"`)
  if (!run.runDir) throw new Error(`workflow run "${run.id}" is missing runDir`)

  const agents = listRunAgents(run)
  const lines: TranscriptLine[] = []

  for (const agent of agents) {
    const parsed = parseAgentTranscript(agent)
    if (parsed.length > 0) {
      lines.push(...parsed)
      continue
    }
    lines.push(fallbackPaneEntry(agent.name))
  }

  lines.sort((a, b) => a.ts.localeCompare(b.ts))
  const outPath = join(run.runDir, 'transcript.jsonl')
  writeFileSync(outPath, lines.map(line => JSON.stringify(line)).join('\n') + (lines.length ? '\n' : ''), 'utf-8')
  console.log(`Exported transcript (${lines.length} lines) to ${outPath}`)
}

export function parseAgentTranscript(agent: RunAgent): TranscriptLine[] {
  const path = resolveSessionLogPath(agent.cli, agent.workdir)
  if (!path) return []

  if (agent.cli === 'claude-code') return parseJsonlLog(path, agent.name, 'claude-code')
  if (agent.cli === 'codex') return parseJsonlLog(path, agent.name, 'codex')
  if (agent.cli === 'pi') return parseJsonlLog(path, agent.name, 'pi')
  if (agent.cli === 'gemini') return parseGeminiLog(path, agent.name)
  if (agent.cli === 'swe-agent') return parseSweTraj(path, agent.name)
  if (agent.cli === 'opencode') return parseOpencodeDb(path, agent.workdir, agent.name)
  return []
}

function listRunAgents(run: WorkflowRun): RunAgent[] {
  const def = loadWorkflowDef(run.workflow)
  const byName = new Map<string, RunAgent>()

  for (const step of def.steps) {
    if (step.type === 'parallel') {
      const group = run.parallelGroups?.[step.id]
      if (!group) continue
      for (const candidate of group.candidates) {
        const cli = getPreset(candidate.preset)?.cli ?? ''
        const workdir = candidate.worktree ?? String(run.vars._input?.dir ?? process.cwd())
        if (!cli) continue
        byName.set(candidate.agentName, { name: candidate.agentName, cli, workdir })
      }
      continue
    }

    if (!isSpawnStep(step) || !step.preset) continue
    const vars = run.vars[step.id]
    if (!vars) continue

    const cli = getPreset(step.preset)?.cli ?? ''
    const workdir =
      (typeof vars.worktree === 'string' && vars.worktree)
      || (typeof vars.dir === 'string' && vars.dir)
      || String(run.vars._input?.dir ?? process.cwd())
    if (!cli) continue

    const name = workflowAgentName(run.id, step.id)
    byName.set(name, { name, cli, workdir })
  }

  return Array.from(byName.values())
}

function isSpawnStep(step: WorkflowStepDef): step is SpawnStep {
  return step.type === undefined || step.type === 'spawn'
}

function resolveSessionLogPath(cli: string, workdir: string): string | null {
  const home = process.env.HOME ?? require('os').homedir()

  if (cli === 'claude-code') {
    const encoded = realpathSafe(workdir).replace(/[\/_]/g, '-')
    const dir = join(home, '.claude', 'projects', encoded)
    return newestWithSuffix(dir, '.jsonl')
  }

  if (cli === 'codex') {
    const dir = join(home, '.codex', 'sessions')
    return newestRecursiveWithSuffix(dir, '.jsonl')
  }

  if (cli === 'pi') {
    const encoded = '-' + realpathSafe(workdir).replace(/\//g, '-') + '--'
    const dir = join(home, '.pi', 'agent', 'sessions', encoded)
    return newestWithSuffix(dir, '.jsonl')
  }

  if (cli === 'gemini') {
    const path = join(home, '.gemini', 'tmp', basename(workdir), 'logs.json')
    return existsSync(path) ? path : null
  }

  if (cli === 'swe-agent') {
    const candidates = [
      join(workdir, '.harness', 'swe-traj.json'),
      join(workdir, 'mini-traj.json'),
      process.platform === 'darwin'
        ? join(home, 'Library', 'Application Support', 'mini-swe-agent', 'last_mini_run.traj.json')
        : join(home, '.local', 'share', 'mini-swe-agent', 'last_mini_run.traj.json'),
    ]
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }
    return null
  }

  if (cli === 'opencode') {
    const dbPath = process.env.OPENCODE_DB?.replace(/^~/, home) ?? join(home, '.local', 'share', 'opencode', 'opencode.db')
    return existsSync(dbPath) ? dbPath : null
  }

  return null
}

function parseJsonlLog(path: string, agent: string, cli: 'claude-code' | 'codex' | 'pi'): TranscriptLine[] {
  const out: TranscriptLine[] = []
  const mtime = isoFromMs(statSync(path).mtimeMs)
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const raw = line.trim()
    if (!raw.startsWith('{')) continue
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(raw) as Record<string, unknown>
    } catch {
      continue
    }

    const ts = extractTimestamp(obj) ?? mtime

    if (cli === 'claude-code') {
      if (obj.type === 'user' || obj.type === 'assistant') {
        const message = obj.message as Record<string, unknown> | undefined
        const role = obj.type === 'user' ? 'user' : 'assistant'
        const content = extractContent(message?.content ?? message)
        if (!content) continue
        const usage = message?.usage as Record<string, unknown> | undefined
        const tokens = role === 'assistant' ? numberOrUndefined(usage?.output_tokens) : numberOrUndefined(usage?.input_tokens)
        out.push({ ts, agent, role, content, ...(tokens === undefined ? {} : { tokens }) })
      }
      continue
    }

    if (cli === 'codex') {
      if (obj.type === 'response.output_text.delta') {
        const delta = typeof obj.delta === 'string' ? obj.delta : ''
        if (delta) out.push({ ts, agent, role: 'assistant', content: delta })
        continue
      }
      const payload = obj.payload as Record<string, unknown> | undefined
      const role = payload?.role
      if (role === 'user' || role === 'assistant' || role === 'tool') {
        const content = extractContent(payload.content)
        if (content) out.push({ ts, agent, role, content })
      }
      continue
    }

    const message = obj.message as Record<string, unknown> | undefined
    const role = message?.role
    if (role === 'user' || role === 'assistant' || role === 'tool') {
      const content = extractContent(message.content)
      if (!content) continue
      const usage = message.usage as Record<string, unknown> | undefined
      const tokens = role === 'assistant'
        ? numberOrUndefined(usage?.output)
        : numberOrUndefined(usage?.input)
      out.push({ ts, agent, role, content, ...(tokens === undefined ? {} : { tokens }) })
    }
  }
  return out
}

function parseGeminiLog(path: string, agent: string): TranscriptLine[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const baseTs = isoFromMs(statSync(path).mtimeMs)

  const out: TranscriptLine[] = []
  parsed.forEach((item, idx) => {
    if (!item || typeof item !== 'object') return
    const obj = item as Record<string, unknown>
    const who = typeof obj.role === 'string' ? obj.role : (typeof obj.author === 'string' ? obj.author : 'user')
    const role = who === 'assistant' || who === 'model' ? 'assistant' : (who === 'tool' ? 'tool' : 'user')
    const content = extractContent(obj.content ?? obj.text ?? obj.message)
    if (!content) return
    const ts = extractTimestamp(obj) ?? addMs(baseTs, idx)
    out.push({ ts, agent, role, content })
  })

  return out
}

function parseSweTraj(path: string, agent: string): TranscriptLine[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') return []
  const messages = (parsed as Record<string, unknown>).messages
  if (!Array.isArray(messages)) return []

  const baseTs = isoFromMs(statSync(path).mtimeMs)
  const out: TranscriptLine[] = []
  messages.forEach((item, idx) => {
    if (!item || typeof item !== 'object') return
    const obj = item as Record<string, unknown>
    const who = typeof obj.role === 'string' ? obj.role : ''
    const role = who === 'assistant' ? 'assistant' : (who === 'tool' ? 'tool' : 'user')
    const content = extractContent(obj.content ?? obj.message)
    if (!content) return
    out.push({ ts: extractTimestamp(obj) ?? addMs(baseTs, idx), agent, role, content })
  })

  return out
}

function parseOpencodeDb(dbPath: string, workdir: string, agent: string): TranscriptLine[] {
  const db = openDb(dbPath)
  if (!db) return []

  try {
    const rows = db.all(
      `
      SELECT
        m.time_created AS ts,
        json_extract(m.data, '$.role') AS role,
        json_extract(m.data, '$.content') AS content,
        json_extract(m.data, '$.tokens.output') AS out_tokens,
        json_extract(m.data, '$.tokens.input') AS in_tokens
      FROM message m
      WHERE m.session_id IN (
        SELECT id FROM session WHERE directory LIKE ? ORDER BY time_updated DESC LIMIT 1
      )
      ORDER BY m.time_created ASC
      `,
      `%${basename(realpathSafe(workdir))}%`,
    )

    const out: TranscriptLine[] = []
    for (const row of rows) {
      const roleRaw = String(row.role ?? '')
      const role = roleRaw === 'assistant' || roleRaw === 'tool' || roleRaw === 'user'
        ? roleRaw
        : 'assistant'
      const content = extractContent(row.content)
      if (!content) continue
      const tokens = role === 'assistant'
        ? numberOrUndefined(row.out_tokens)
        : numberOrUndefined(row.in_tokens)
      out.push({
        ts: normalizeTimestamp(row.ts),
        agent,
        role,
        content,
        ...(tokens === undefined ? {} : { tokens }),
      })
    }
    return out
  } catch {
    return []
  } finally {
    db.close()
  }
}

function fallbackPaneEntry(agent: string): TranscriptLine {
  const home = process.env.HOME ?? require('os').homedir()
  const path = join(home, '.flt', 'logs', `flt-${agent}.tmux.log`)
  let content = ''
  if (existsSync(path)) {
    content = stripAnsi(readFileSync(path, 'utf-8')).trim()
  }
  if (!content) content = '(no parsed session log available)'
  if (content.length > 4000) content = content.slice(-4000)
  return {
    ts: new Date().toISOString(),
    agent,
    role: 'assistant',
    content,
  }
}

function extractContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const parts = value
      .map(v => {
        if (typeof v === 'string') return v
        if (v && typeof v === 'object') {
          const obj = v as Record<string, unknown>
          if (typeof obj.text === 'string') return obj.text
          if (typeof obj.content === 'string') return obj.content
        }
        return ''
      })
      .filter(Boolean)
    return parts.join('\n').trim()
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (typeof obj.text === 'string') return obj.text
    if (typeof obj.content === 'string') return obj.content
  }
  return ''
}

function extractTimestamp(obj: Record<string, unknown>): string | null {
  for (const key of ['ts', 'timestamp', 'created_at', 'time']) {
    const raw = obj[key]
    if (typeof raw === 'string' && raw) return normalizeTimestamp(raw)
    if (typeof raw === 'number') return normalizeTimestamp(raw)
  }
  return null
}

function normalizeTimestamp(raw: string | number): string {
  if (typeof raw === 'number') {
    return isoFromMs(raw < 10_000_000_000 ? raw * 1000 : raw)
  }

  const asNum = Number(raw)
  if (!Number.isNaN(asNum)) {
    return normalizeTimestamp(asNum)
  }

  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return new Date().toISOString()
  return d.toISOString()
}

function numberOrUndefined(value: unknown): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function newestWithSuffix(dir: string, suffix: string): string | null {
  if (!existsSync(dir)) return null
  let best: { path: string; t: number } | null = null
  for (const entry of require('fs').readdirSync(dir)) {
    if (!entry.endsWith(suffix)) continue
    const path = join(dir, entry)
    const t = statSync(path).mtimeMs
    if (!best || t > best.t) best = { path, t }
  }
  return best?.path ?? null
}

function newestRecursiveWithSuffix(dir: string, suffix: string): string | null {
  if (!existsSync(dir)) return null
  let best: { path: string; t: number } | null = null
  const walk = (d: string) => {
    for (const entry of require('fs').readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.name.endsWith(suffix)) continue
      const t = statSync(full).mtimeMs
      if (!best || t > best.t) best = { path: full, t }
    }
  }
  walk(dir)
  return best?.path ?? null
}

function realpathSafe(path: string): string {
  try {
    return require('fs').realpathSync(path)
  } catch {
    return path
  }
}

function addMs(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString()
}

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString()
}

interface DbHandle {
  all(sql: string, ...params: unknown[]): Array<Record<string, unknown>>
  close(): void
}

function openDb(path: string): DbHandle | null {
  const requireFn = createRequire(import.meta.url)
  const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'

  if (isBun) {
    try {
      const mod = requireFn('bun:sqlite') as {
        Database: new (p: string, opts?: unknown) => {
          query: (sql: string) => { all: (...params: unknown[]) => Array<Record<string, unknown>> }
          close: () => void
        }
      }
      const db = new mod.Database(path, { readonly: true })
      return {
        all: (sql, ...params) => db.query(sql).all(...params),
        close: () => db.close(),
      }
    } catch {
      return null
    }
  }

  try {
    const BetterSqlite = requireFn('better-sqlite3') as new (p: string, opts?: unknown) => {
      prepare: (sql: string) => { all: (...params: unknown[]) => Array<Record<string, unknown>> }
      close: () => void
    }
    const db = new BetterSqlite(path, { readonly: true, timeout: 5000 })
    return {
      all: (sql, ...params) => db.prepare(sql).all(...params),
      close: () => db.close(),
    }
  } catch {
    return null
  }
}
