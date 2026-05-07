import { setOrchestrator, getOrchestrator, getStateDir } from '../state'
import { existsSync, writeFileSync, mkdirSync, readFileSync, copyFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// Preset reorg (2026-05): three layers.
//  1. Primitive role presets — role + skills only, no cli/model. User picks
//     harness at spawn time with --cli / --model.
//  2. Task-specific presets — variations on roles with task-tuned skill sets.
//  3. Harness-bound dupes — cc-* (claude-code + tier model) and pi-* (cli=pi,
//     model deferred to spawn). Old per-CLI bundles (codex-*, gemini-*,
//     glm-*, opencode-*, cc-opus, cc-sonnet, pi-deep) were dropped.
const SEED_PRESETS = {
  // ---- Primitive role presets (no cli, no model) ----
  'coder':             { description: 'Role: coder',             soul: 'roles/coder.md',                  skills: ['tdd', 'git-guardrails-claude-code'] },
  'architect':         { description: 'Role: architect',         soul: 'roles/architect.md',              skills: ['grill', 'improve-codebase-architecture', 'zoom-out'] },
  'reviewer':          { description: 'Role: reviewer',          soul: 'roles/reviewer.md',               skills: ['diagnose', 'git-guardrails-claude-code'] },
  'evaluator':         { description: 'Role: evaluator',         soul: 'roles/evaluator.md',              skills: ['diagnose'] },
  'spec-writer':       { description: 'Role: spec writer',       soul: 'roles/spec_writer.md',            skills: ['grill', 'to-prd', 'to-issues'] },
  'tester':            { description: 'Role: tester',            soul: 'roles/tester.md',                 skills: ['tdd'] },
  'oracle':            { description: 'Role: oracle',            soul: 'roles/oracle.md',                 skills: [] },
  'mutator':           { description: 'Role: mutator',           soul: 'roles/mutator.md',                skills: [] },
  'orchestrator':      { description: 'Role: orchestrator',      soul: 'agents/orchestrator/SOUL.md',     skills: ['grill', 'handoff'] },
  'trace-classifier':  { description: 'Role: trace classifier',  soul: 'roles/trace_classifier.md',       skills: [] },
  'verifier':          { description: 'Role: verifier',          soul: 'roles/verifier.md',               skills: [] },
  // ---- Task-specific (still no cli/model) ----
  'triage':          { description: 'Task: triage',                soul: 'roles/reviewer.md',     skills: ['triage', 'diagnose', 'git-guardrails-claude-code'] },
  'architect-deep':  { description: 'Task: architecture deep-dive', soul: 'roles/architect.md',    skills: ['grill', 'improve-codebase-architecture', 'zoom-out'] },
  'handoff-writer':  { description: 'Task: handoff writer',        soul: 'roles/spec_writer.md',  skills: ['handoff', 'grill'] },
  'prototype':       { description: 'Task: prototype builder',     soul: 'roles/coder.md',        skills: ['prototype', 'git-guardrails-claude-code'] },
  // ---- claude-code-bound dupes ----
  'cc-coder':            { cli: 'claude-code', model: 'sonnet',   description: 'Coder via claude-code',            soul: 'roles/coder.md',              skills: ['tdd', 'git-guardrails-claude-code'] },
  'cc-architect':        { cli: 'claude-code', model: 'opus[1m]', description: 'Architect via claude-code',        soul: 'roles/architect.md',          skills: ['grill', 'improve-codebase-architecture', 'zoom-out'] },
  'cc-reviewer':         { cli: 'claude-code', model: 'sonnet',   description: 'Reviewer via claude-code',         soul: 'roles/reviewer.md',           skills: ['diagnose', 'git-guardrails-claude-code'] },
  'cc-evaluator':        { cli: 'claude-code', model: 'opus[1m]', description: 'Evaluator via claude-code',        soul: 'roles/evaluator.md',          skills: ['diagnose'] },
  'cc-spec-writer':      { cli: 'claude-code', model: 'sonnet',   description: 'Spec writer via claude-code',      soul: 'roles/spec_writer.md',        skills: ['grill', 'to-prd', 'to-issues'] },
  'cc-tester':           { cli: 'claude-code', model: 'sonnet',   description: 'Tester via claude-code',           soul: 'roles/tester.md',             skills: ['tdd'] },
  'cc-oracle':           { cli: 'claude-code', model: 'sonnet',   description: 'Ephemeral oracle (claude-code)',   soul: 'roles/oracle.md',             skills: [] },
  'cc-mutator':          { cli: 'claude-code', model: 'opus[1m]', description: 'Trace-driven artifact mutator',    soul: 'roles/mutator.md',            skills: [] },
  'cc-orchestrator':     { cli: 'claude-code', model: 'opus[1m]', description: 'Persistent fleet orchestrator',    soul: 'agents/orchestrator/SOUL.md', dir: '~/.flt/agents/orchestrator', parent: 'human', worktree: false, persistent: true, skills: ['grill', 'handoff'] },
  'cc-trace-classifier': { cli: 'claude-code', model: 'haiku',    description: 'Failure classifier',               soul: 'roles/trace_classifier.md',   skills: [] },
  'cc-verifier':         { cli: 'claude-code', model: 'haiku',    description: 'Verifier via claude-code',         soul: 'roles/verifier.md',           skills: [] },
  'cc-triage':           { cli: 'claude-code', model: 'sonnet',   description: 'Triage via claude-code',           soul: 'roles/reviewer.md',           skills: ['triage', 'diagnose', 'git-guardrails-claude-code'] },
  'cc-architect-deep':   { cli: 'claude-code', model: 'opus[1m]', description: 'Deep architecture via claude-code',soul: 'roles/architect.md',          skills: ['grill', 'improve-codebase-architecture', 'zoom-out'] },
  'cc-handoff-writer':   { cli: 'claude-code', model: 'sonnet',   description: 'Handoff writer via claude-code',   soul: 'roles/spec_writer.md',        skills: ['handoff', 'grill'] },
  'cc-prototype':        { cli: 'claude-code', model: 'sonnet',   description: 'Prototype via claude-code',        soul: 'roles/coder.md',              skills: ['prototype', 'git-guardrails-claude-code'] },
  // ---- pi-bound (no model — spawn-time --model required) ----
  'pi-coder':     { cli: 'pi', description: 'Coder via pi',     soul: 'roles/coder.md',     skills: ['tdd', 'git-guardrails-claude-code'] },
  'pi-reviewer':  { cli: 'pi', description: 'Reviewer via pi',  soul: 'roles/reviewer.md',  skills: ['diagnose', 'git-guardrails-claude-code'] },
  'pi-architect': { cli: 'pi', description: 'Architect via pi', soul: 'roles/architect.md', skills: ['grill', 'improve-codebase-architecture', 'zoom-out'] },
}

function fltHome(): string {
  return join(process.env.HOME || homedir(), '.flt')
}

export function seedDefaultWorkflows(fltDir: string): void {
  const tplDir = join(import.meta.dir, '..', '..', 'templates', 'workflows')
  const dstDir = join(fltDir, 'workflows')
  if (!existsSync(tplDir)) return

  for (const f of readdirSync(tplDir).filter(n => n.endsWith('.yaml') || n.endsWith('.yml'))) {
    const src = join(tplDir, f)
    const dst = join(dstDir, f)
    if (!existsSync(dst)) copyFileSync(src, dst)
  }
}

function seedRoles(fltDir: string): number {
  const tplDir = join(import.meta.dir, '..', '..', 'templates', 'roles')
  const dstDir = join(fltDir, 'roles')
  if (!existsSync(tplDir)) return 0
  let n = 0
  for (const f of readdirSync(tplDir).filter(name => name.endsWith('.md'))) {
    if (copyIfAbsent(join(tplDir, f), join(dstDir, f))) n++
  }
  return n
}

function copyDirRecursiveIfAbsent(src: string, dst: string): boolean {
  if (existsSync(dst)) return false
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name)
    const d = join(dst, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursiveIfAbsent(s, d)
    } else if (entry.isFile()) {
      copyFileSync(s, d)
    }
  }
  return true
}

function seedDefaultSkills(fltDir: string): number {
  const tplDir = join(import.meta.dir, '..', '..', 'templates', 'skills')
  const dstDir = join(fltDir, 'skills')
  if (!existsSync(tplDir)) return 0
  let n = 0
  for (const entry of readdirSync(tplDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (copyDirRecursiveIfAbsent(join(tplDir, entry.name), join(dstDir, entry.name))) n++
  }
  return n
}

function seedOrchestratorSoul(fltDir: string): number {
  const src = join(import.meta.dir, '..', '..', 'templates', 'agents', 'orchestrator', 'SOUL.md')
  const dst = join(fltDir, 'agents', 'orchestrator', 'SOUL.md')
  if (!existsSync(src)) return 0
  mkdirSync(join(fltDir, 'agents', 'orchestrator'), { recursive: true })
  return copyIfAbsent(src, dst) ? 1 : 0
}

function mergeMissingPresets(fltDir: string): number {
  const path = join(fltDir, 'presets.json')
  if (!existsSync(path)) return 0
  let current: Record<string, unknown>
  try {
    current = JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return 0
  }
  let added = 0
  for (const [name, def] of Object.entries(SEED_PRESETS)) {
    if (!(name in current)) {
      current[name] = def
      added++
    }
  }
  if (added > 0) {
    writeFileSync(path, JSON.stringify(current, null, 2) + '\n')
  }
  return added
}

function writeIfAbsent(path: string, content: string): boolean {
  if (existsSync(path)) return false
  writeFileSync(path, content)
  return true
}

function copyIfAbsent(src: string, dst: string): boolean {
  if (existsSync(dst)) return false
  copyFileSync(src, dst)
  return true
}

export function seedFlt(): void {
  const fltDir = fltHome()
  const reusing = existsSync(fltDir)

  for (const sub of ['roles', 'agents', 'skills', 'workflows', 'templates', 'runs', 'logs', 'bin', 'backups', 'routing']) {
    mkdirSync(join(fltDir, sub), { recursive: true })
  }

  let restored = 0

  if (writeIfAbsent(join(fltDir, 'routing', 'policy.yaml'), [
    '# Two-families split: Claude=judgment, GPT=execution',
    'orchestrator: cc-orchestrator',
    'spec_writer: cc-spec-writer',
    'architect: cc-architect',
    'coder: pi-coder',
    'tester: cc-tester',
    'reviewer: cc-reviewer',
    'verifier: cc-verifier',
    'evaluator: cc-evaluator',
    'oracle: cc-oracle',
    'mutator: cc-mutator',
    'trace_classifier: cc-trace-classifier',
    '',
  ].join('\n'))) restored++

  if (writeIfAbsent(join(fltDir, 'routing', 'escalation.yaml'), [
    'triggers:',
    '  same_step_failed_twice:',
    '    coder: cc-architect',
    '    reviewer: cc-architect',
    '  low_confidence_blocker:',
    '    "*": cc-oracle',
    '  security_tagged_diff:',
    '    reviewer: cc-architect',
    '  hard_debug_reproducible:',
    '    "*": cc-oracle',
    '',
  ].join('\n'))) restored++

  if (writeIfAbsent(join(fltDir, 'state.json'), JSON.stringify({ agents: {}, config: { maxDepth: 3 } }, null, 2) + '\n')) restored++
  if (writeIfAbsent(join(fltDir, '.managed-skills.json'), '{}\n')) restored++
  if (writeIfAbsent(join(fltDir, 'config.json'), JSON.stringify({ version: 1 }, null, 2) + '\n')) restored++
  if (writeIfAbsent(join(fltDir, 'models.json'), '{}\n')) restored++
  if (writeIfAbsent(join(fltDir, 'presets.json'), JSON.stringify(SEED_PRESETS, null, 2) + '\n')) restored++

  const bundledTemplates = join(import.meta.dir, '..', '..', 'templates')
  for (const tmpl of ['system-block-root.md', 'system-block-subagent.md', 'workflow-block.md']) {
    if (copyIfAbsent(join(bundledTemplates, tmpl), join(fltDir, 'templates', tmpl))) restored++
  }

  seedDefaultWorkflows(fltDir)
  restored += seedRoles(fltDir)
  restored += seedOrchestratorSoul(fltDir)
  restored += seedDefaultSkills(fltDir)
  restored += mergeMissingPresets(fltDir)

  if (reusing) {
    console.log(`Reusing existing ~/.flt${restored ? ` (restored ${restored} missing seed file${restored === 1 ? '' : 's'})` : ' (no missing seeds)'}`)
  } else {
    console.log('Initialized ~/.flt')
    console.log('  roles/ agents/ skills/ workflows/ templates/ runs/ logs/ bin/ backups/ routing/')
    console.log('  presets.json   config.json   models.json   state.json   .managed-skills.json')
    console.log('  routing/policy.yaml   routing/escalation.yaml')
  }
}

interface InitArgs {
  orchestrator?: boolean | string  // true or agent name
  cli?: string
  model?: string
  preset?: string
  dir?: string
}

export function getInboxPath(): string {
  return join(getStateDir(), 'inbox.log')
}

function loadTimeFormat(): boolean {
  try {
    const configPath = join(getStateDir(), 'config.json')
    if (!existsSync(configPath)) return true
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    if (config.timeFormat === '24h') return false
    return true  // default: 12h
  } catch {
    return true
  }
}

export function appendInbox(from: string, message: string): void {
  const inboxPath = getInboxPath()
  mkdirSync(getStateDir(), { recursive: true })
  const hour12 = loadTimeFormat()
  const ts = new Date().toLocaleTimeString('en-US', { hour12 })
  const tag = from.toUpperCase()
  // Escape newlines so multiline messages stay on one line in the log
  const escaped = message.replace(/\n/g, '\\n')
  const line = `[${ts}] [${tag}]: ${escaped}\n`
  const fd = require('fs').openSync(inboxPath, 'a')
  require('fs').writeSync(fd, line)
  require('fs').closeSync(fd)
}

export async function init(args: InitArgs): Promise<void> {
  seedFlt()

  if (!process.env.TMUX) {
    throw new Error('flt requires tmux. Run tmux first.')
  }

  // Ensure state dir and inbox exist
  mkdirSync(getStateDir(), { recursive: true })
  const inboxPath = getInboxPath()
  if (!existsSync(inboxPath)) {
    writeFileSync(inboxPath, '')
  }

  // Set orchestrator reference (human session)
  const currentSession = detectTmuxSession()
  const existing = getOrchestrator()
  if (!existing) {
    setOrchestrator({
      tmuxSession: currentSession,
      tmuxWindow: process.env.TMUX_PANE || '0',
      type: 'human',
      initAt: new Date().toISOString(),
    })
  } else if (existing.tmuxSession !== currentSession) {
    setOrchestrator({
      ...existing,
      tmuxSession: currentSession,
      tmuxWindow: process.env.TMUX_PANE || '0',
    })
  }

  // Ensure controller is running
  const { ensureController } = await import('./controller')
  await ensureController()

  // Spawn orchestrator agent if requested
  if (args.orchestrator) {
    const { spawn } = await import('./spawn')
    const agentName = typeof args.orchestrator === 'string' ? args.orchestrator : 'orchestrator'
    const preset = args.preset ?? agentName
    const { getPreset } = await import('../presets')
    const hasPreset = !!getPreset(preset)

    let dir = args.dir
    if (dir) {
      if (dir.startsWith('~/')) dir = dir.replace('~', process.env.HOME || homedir())
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    } else {
      const agentHome = join(getStateDir(), 'agents', agentName)
      if (existsSync(agentHome)) dir = agentHome
    }

    try {
      await spawn({
        name: agentName,
        cli: hasPreset ? undefined : (args.cli || 'claude-code'),
        model: args.model,
        preset: hasPreset ? preset : args.preset,
        dir,
        worktree: false,
      })
    } catch (e) {
      console.error(`Warning: ${(e as Error).message}`)
    }
  }

  // Launch TUI
  const { renderTui } = await import('../tui/render')
  await renderTui()
}

/** Launch TUI only — expects controller to be running */
export async function tui(): Promise<void> {
  if (!process.env.TMUX) {
    throw new Error('flt requires tmux. Run tmux first.')
  }

  const { ensureController } = await import('./controller')
  await ensureController()

  const { renderTui } = await import('../tui/render')
  await renderTui()
}

function detectTmuxSession(): string {
  const tmuxEnv = process.env.TMUX
  if (tmuxEnv) {
    try {
      const out = require('child_process').execFileSync('tmux', [
        'display-message', '-p', '#{session_name}'
      ], { encoding: 'utf-8', timeout: 3000 }).trim()
      if (out) return out
    } catch {}
  }
  return 'unknown'
}
