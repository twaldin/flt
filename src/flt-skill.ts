import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const BUNDLED_DIR = join(import.meta.dir, '..', 'templates', 'flt-skill')

export interface FltSkillOpts {
  name: string
  parent: string
  cli: string
  model: string
  workflow?: string
  step?: string
  worktree: boolean
}

function home(): string {
  return process.env.HOME || homedir()
}

function userOverrideDir(): string {
  return join(home(), '.flt', 'templates', 'flt-skill')
}

function resolveTemplateFile(filename: string): string {
  const userPath = join(userOverrideDir(), filename)
  return existsSync(userPath) ? userPath : join(BUNDLED_DIR, filename)
}

function readIfExists(filename: string): string | null {
  const path = resolveTemplateFile(filename)
  if (!existsSync(path)) return null
  return readFileSync(path, 'utf-8')
}

function modeFor(opts: FltSkillOpts): 'workflow' | 'subagent' | 'root' {
  if (opts.workflow) return 'workflow'
  if (opts.parent === 'human' || opts.parent === 'cron') return 'root'
  return 'subagent'
}

function applyVars(template: string, opts: FltSkillOpts): string {
  const mode = modeFor(opts)
  return template
    .replace(/\{\{name\}\}/g, opts.name)
    .replace(/\{\{parent\}\}/g, opts.parent)
    .replace(/\{\{cli\}\}/g, opts.cli)
    .replace(/\{\{model\}\}/g, opts.model || 'default')
    .replace(/\{\{workflow\}\}/g, opts.workflow || '')
    .replace(/\{\{step\}\}/g, opts.step || '')
    .replace(/\{\{mode\}\}/g, mode)
}

/**
 * Build the full /flt skill SKILL.md content for this spawn context.
 * Concatenates base.md with the appropriate `.append` files based on
 * mode (root|subagent|workflow) and worktree flag.
 */
export function buildFltSkillContent(opts: FltSkillOpts): string {
  const base = readIfExists('base.md')
  if (!base) {
    throw new Error(`flt-skill template not found: ${join(BUNDLED_DIR, 'base.md')}`)
  }
  const parts: string[] = [base.trimEnd()]

  const mode = modeFor(opts)
  const modeAppend = readIfExists(`${mode}.md.append`)
  if (modeAppend) parts.push(modeAppend.trimEnd())

  if (opts.worktree) {
    const wt = readIfExists('worktree.md.append')
    if (wt) parts.push(wt.trimEnd())
  }

  return applyVars(parts.join('\n\n') + '\n', opts)
}

const FLT_SKILL_DESCRIPTION =
  'Protocol for operating as an agent in a flt fleet — comms etiquette, command catalog, completion signaling. Read on every conversation start.'

export function getFltSkillDescription(): string {
  return FLT_SKILL_DESCRIPTION
}
