import { setOrchestrator, getOrchestrator, getStateDir } from '../state'
import { existsSync, writeFileSync, mkdirSync, readFileSync, copyFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const SEED_PRESETS = {
  'cc-architect': { cli: 'claude-code', model: 'opus[1m]', description: 'Architect via claude-code', soul: 'roles/architect.md' },
  'cc-coder': { cli: 'claude-code', model: 'sonnet', description: 'Coder via claude-code', soul: 'roles/coder.md' },
  'cc-evaluator': { cli: 'claude-code', model: 'opus[1m]', description: 'Evaluator via claude-code', soul: 'roles/evaluator.md' },
  'cc-mutator': { cli: 'claude-code', model: 'opus[1m]', description: 'Trace-driven artifact mutator', soul: 'roles/mutator.md' },
  'cc-opus': { cli: 'claude-code', model: 'opus[1m]', description: 'Routing bundle: claude-code + opus[1m] (judgment tier; soul injected by spawn --role)', soul: 'roles/architect.md' },
  'cc-oracle': { cli: 'claude-code', model: 'sonnet', description: 'Ephemeral oracle (spawn-on-message)', soul: 'roles/oracle.md' },
  'cc-reviewer': { cli: 'claude-code', model: 'sonnet', description: 'Reviewer via claude-code', soul: 'roles/reviewer.md' },
  'cc-sonnet': { cli: 'claude-code', model: 'sonnet', description: 'Routing bundle: claude-code + sonnet (execution-judgment tier; soul injected by spawn --role)', soul: 'roles/reviewer.md' },
  'cc-spec-writer': { cli: 'claude-code', model: 'sonnet', description: 'Spec writer via claude-code', soul: 'roles/spec_writer.md' },
  'cc-tester': { cli: 'claude-code', model: 'sonnet', description: 'Tester via claude-code', soul: 'roles/tester.md' },
  'cc-trace-classifier': { cli: 'claude-code', model: 'haiku', description: 'Failure classifier', soul: 'roles/trace_classifier.md' },
  'cc-verifier': { cli: 'claude-code', model: 'haiku', description: 'Verifier via claude-code', soul: 'roles/verifier.md' },
  'codex-coder': { cli: 'codex', model: 'gpt-5.3-codex', description: 'Coder via codex', soul: 'roles/coder.md' },
  'codex-reviewer': { cli: 'codex', model: 'gpt-5.4', description: 'Reviewer via codex', soul: 'roles/reviewer.md' },
  'gemini-coder': { cli: 'gemini', model: 'gemini-2.5-pro', description: 'Long-context coder via gemini', soul: 'roles/coder.md' },
  'glm-coder': { cli: 'claude-code', model: 'sonnet', description: 'claude-code via z.ai → GLM-5.1', soul: 'roles/coder.md', env: { ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic', API_TIMEOUT_MS: '3000000', ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5.1', ANTHROPIC_AUTH_TOKEN: '${Z_AI_API_KEY}', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } },
  'glm-fast': { cli: 'claude-code', model: 'haiku', description: 'claude-code via z.ai → GLM-4.5-Air', soul: 'roles/coder.md', env: { ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic', API_TIMEOUT_MS: '3000000', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-4.5-air', ANTHROPIC_AUTH_TOKEN: '${Z_AI_API_KEY}', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } },
  'glm-opus': { cli: 'claude-code', model: 'opus[1m]', description: 'claude-code via z.ai → GLM-4.7', soul: 'roles/coder.md', env: { ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic', API_TIMEOUT_MS: '3000000', ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-4.7', ANTHROPIC_AUTH_TOKEN: '${Z_AI_API_KEY}', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } },
  'opencode-coder': { cli: 'opencode', model: 'default', description: 'Coder via opencode', soul: 'roles/coder.md' },
  'orchestrator': { cli: 'claude-code', model: 'opus[1m]', description: 'Persistent fleet orchestrator', dir: '~/.flt/agents/orchestrator', parent: 'human', worktree: false, persistent: true, soul: 'agents/orchestrator/SOUL.md' },
  'pi-coder': { cli: 'pi', model: 'gpt-5.3-codex', description: 'Coder via pi (gpt-5.3-codex)', soul: 'roles/coder.md' },
  'pi-deep': { cli: 'pi', model: 'gpt-5.4-high', description: 'Deep-reasoning oracle via pi (gpt-5.4 high)', soul: 'roles/oracle.md' },
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
    'orchestrator: cc-opus',
    'spec_writer: cc-sonnet',
    'architect: cc-opus',
    'coder: pi-coder',
    'tester: pi-coder',
    'reviewer: cc-sonnet',
    'verifier: pi-coder',
    'evaluator: cc-opus',
    'oracle: pi-deep',
    'mutator: cc-opus',
    'trace_classifier: pi-coder',
    '',
  ].join('\n'))) restored++

  if (writeIfAbsent(join(fltDir, 'routing', 'escalation.yaml'), [
    'triggers:',
    '  same_step_failed_twice:',
    '    coder: cc-opus',
    '    reviewer: cc-opus',
    '  low_confidence_blocker:',
    '    "*": pi-deep',
    '  security_tagged_diff:',
    '    reviewer: cc-opus',
    '  hard_debug_reproducible:',
    '    "*": pi-deep',
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
