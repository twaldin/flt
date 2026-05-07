import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import {
  projectInstructions as harnessProjectInstructions,
  restoreProjectedInstructions,
  type InstructionProjection,
} from '@twaldin/harness-ts'

const BUNDLED_ROOT_TEMPLATE_PATH = join(import.meta.dir, '..', 'templates', 'system-block-root.md')
const BUNDLED_SUBAGENT_TEMPLATE_PATH = join(import.meta.dir, '..', 'templates', 'system-block-subagent.md')
const BUNDLED_WORKFLOW_PATH = join(import.meta.dir, '..', 'templates', 'workflow-block.md')

// Resolved per-call so tests (and any HOME override) pick up the right
// override directory at the time of use, not at module-load time.
function resolveTemplate(localName: string, bundledPath: string): string {
  const localPath = join(home(), '.flt', 'templates', localName)
  return existsSync(localPath) ? localPath : bundledPath
}

function rootTemplatePath(): string {
  return resolveTemplate('system-block-root.md', BUNDLED_ROOT_TEMPLATE_PATH)
}

function subagentTemplatePath(): string {
  return resolveTemplate('system-block-subagent.md', BUNDLED_SUBAGENT_TEMPLATE_PATH)
}

function workflowTemplatePath(): string {
  return resolveTemplate('workflow-block.md', BUNDLED_WORKFLOW_PATH)
}

const FLT_MARKER_START = '<!-- flt:start -->'
const FLT_MARKER_END = '<!-- flt:end -->'

function home(): string {
  return process.env.HOME || require('os').homedir()
}

interface InstructionOpts {
  agentName: string
  parentName: string
  cli: string
  model: string
  workflow?: string
  step?: string
  presetSoul?: string
  skillNames?: string[]
}

export type { InstructionProjection }

export function buildSystemBlock(opts: InstructionOpts): string {
  const templatePath = opts.workflow
    ? workflowTemplatePath()
    : (opts.parentName === 'human' || opts.parentName === 'cron')
      ? rootTemplatePath()
      : subagentTemplatePath()
  let template = readFileSync(templatePath, 'utf-8')
  template = template.replace(/\{\{name\}\}/g, opts.agentName)
  template = template.replace(/\{\{parentName\}\}/g, opts.parentName)
  template = template.replace(/\{\{cli\}\}/g, opts.cli)
  template = template.replace(/\{\{model\}\}/g, opts.model || 'default')
  template = template.replace(/\{\{workflow\}\}/g, opts.workflow || '')
  template = template.replace(/\{\{step\}\}/g, opts.step || '')
  template = template.replace(/\{\{comms\}\}/g, buildCommsBlock(opts.parentName, opts.workflow))
  template = template.replace(/\{\{skills\}\}/g, buildSkillsBlock(opts.skillNames ?? [], opts.cli))
  return template
}

export function loadSoulMd(agentName: string, presetSoul?: string): string | null {
  const soulPath = join(home(), '.flt', 'agents', agentName, 'SOUL.md')
  if (existsSync(soulPath)) return readFileSync(soulPath, 'utf-8')

  if (presetSoul) {
    const resolved = presetSoul.startsWith('/')
      ? presetSoul
      : join(home(), '.flt', presetSoul)
    if (existsSync(resolved)) return readFileSync(resolved, 'utf-8')
  }

  return null
}

function buildCommsBlock(parentName: string, workflow?: string): string {
  // In a workflow context, completion goes through the engine via
  // `flt workflow pass`/`flt workflow fail`. Telling the agent to also send
  // parent creates competing channels and the engine ignores parent messages
  // anyway — leads to noisy "code done" pings the human/orchestrator filters.
  if (workflow) {
    return [
      '- You are in a workflow run. Engine is your only consumer.',
      '- Signal completion: `flt workflow pass` (success) or `flt workflow fail "<one-line reason>"` (failure).',
      '- Do NOT `flt send parent` — engine reads $FLT_RUN_DIR/results/<step>.json, not chat.',
      '- Out-of-scope research: `flt ask oracle "..."` (reply lands in your inbox).',
      '- Detailed handoff: write `$FLT_RUN_DIR/handoffs/<your-name>.md` for the reviewer.',
    ].join('\n')
  }
  if (parentName === 'human' || parentName === 'cron') {
    return '- Parent is human. Use `flt send parent "..."` for important updates/blockers.\n- Terminal output can be useful and may be visible in logs.'
  }
  return '- Parent is another agent. Send progress/questions via `flt send parent "..."`.\n- Use parent as the primary coordination channel.'
}

function skillsDir(cli: string): string {
  if (cli === 'claude-code') return '.claude/skills'
  if (cli === 'opencode') return '.opencode/skills'
  return '.flt/skills'
}

function buildSkillsBlock(skillNames: string[], cli: string): string {
  if (skillNames.length === 0) {
    return '- No skills loaded for this run. Skills are opt-in at spawn.'
  }

  const dir = skillsDir(cli)
  const lines = ['- Enabled skills (read only when relevant):']
  for (const name of skillNames) {
    lines.push(`  - ./${dir}/${name}/SKILL.md`)
  }
  return lines.join('\n')
}

export function buildFullInstructions(opts: InstructionOpts): string {
  const parts: string[] = [
    FLT_MARKER_START,
    buildSystemBlock(opts),
  ]

  const soul = loadSoulMd(opts.agentName, opts.presetSoul)
  if (soul) {
    parts.push('')
    parts.push(soul)
  }

  parts.push(FLT_MARKER_END)
  return parts.join('\n')
}

/**
 * Pre-clean any orphaned flt-managed content from a project instructions
 * file before projection. Defensive against the scenario where a past
 * spawn's restoreInstructions never ran (e.g., agent killed by external
 * signal before kill.ts could clean up, controller crashed mid-spawn,
 * the .flt-backup/ file was lost). Result: file is left with
 * `<!-- flt:start -->` ... `<!-- flt:end -->` content from a stale
 * spawn, OR with legacy `# Fleet Agent:` boilerplate without proper
 * markers (older flt versions). When the next agent's projection runs,
 * harness's marker-replace branch only handles the well-formed case;
 * mismatched/missing markers fall through to prepend, leaving stale
 * agent-role text on top of the new projection — directly contradicting
 * the new block (e.g., the leftover says "use flt send parent" while
 * the workflow block says "do NOT").
 *
 * This sweep runs idempotently before the projection write. It removes:
 *   1. Any well-formed `flt:start` ... `flt:end` block (the next step
 *      will replace this anyway, but explicit is clearer).
 *   2. An unterminated `flt:start` block (no matching `flt:end`) — wipes
 *      from the start marker to EOF since we have no way to know where
 *      the user's content begins.
 *   3. A legacy "# Fleet Agent:" header at the top of the file with no
 *      surrounding markers (pre-marker flt versions). Wipes from that
 *      header to the next `## ` h2 break or to EOF if it's the whole file.
 *
 * Returns the cleaned-up path so the caller knows whether anything was
 * removed (for logging / metrics).
 */
function sweepOrphanedFltContent(
  workDir: string,
  instructionFile: string,
): { cleaned: boolean; reason?: string } {
  const filePath = require('path').join(workDir, instructionFile)
  const fs = require('fs') as typeof import('fs')
  if (!fs.existsSync(filePath)) return { cleaned: false }
  let content: string
  try {
    content = fs.readFileSync(filePath, 'utf-8')
  } catch {
    return { cleaned: false }
  }

  let cleaned = ''
  let reason: string | undefined

  const startIdx = content.indexOf(FLT_MARKER_START)
  const endIdx = content.indexOf(FLT_MARKER_END)

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Well-formed block. Drop it (next projection will rewrite).
    cleaned = (content.slice(0, startIdx) + content.slice(endIdx + FLT_MARKER_END.length)).replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n')
    reason = 'well-formed-block'
  } else if (startIdx !== -1) {
    // Unterminated start marker — drop everything from start marker onward.
    cleaned = content.slice(0, startIdx).replace(/\n+$/, '\n')
    reason = 'unterminated-start'
  } else if (/^# Fleet Agent:\s/m.test(content)) {
    // Legacy flt block (pre-marker era) — drop from "# Fleet Agent:" header
    // up to but not including the next `## ` h2 boundary, or to EOF if
    // there is no next h2. Manual scan because JS /m makes `$` match EOL,
    // not EOF, which would truncate the cleanup at the first newline.
    const headerMatch = content.match(/^# Fleet Agent:.*$/m)
    if (headerMatch && headerMatch.index !== undefined) {
      const startPos = headerMatch.index
      const after = content.slice(startPos)
      const h2Idx = after.indexOf('\n## ')
      const stalePart = h2Idx !== -1 ? after.slice(0, h2Idx + 1) : after
      cleaned = (content.slice(0, startPos) + content.slice(startPos + stalePart.length)).replace(/^\n+/, '')
      reason = 'legacy-header'
    } else {
      return { cleaned: false }
    }
  } else {
    return { cleaned: false }
  }

  // Only write if the file actually changed
  if (cleaned !== content) {
    if (cleaned.trim().length === 0) {
      // Whole file was leftover flt content — remove the file entirely so
      // the projection re-creates it cleanly with existedBefore=false
      try { fs.unlinkSync(filePath) } catch {}
    } else {
      fs.writeFileSync(filePath, cleaned, 'utf-8')
    }
    return { cleaned: true, reason }
  }
  return { cleaned: false }
}

export function projectInstructions(
  workDir: string,
  instructionFile: string,
  opts: InstructionOpts,
): InstructionProjection {
  const sweep = sweepOrphanedFltContent(workDir, instructionFile)
  if (sweep.cleaned) {
    // Surface the cleanup so debugging is possible. Stderr because some
    // CLIs treat stdout output as part of their input pipeline.
    process.stderr.write(`[flt] swept orphaned content from ${instructionFile} (${sweep.reason})\n`)
  }
  const fltBlock = buildFullInstructions(opts)
  return harnessProjectInstructions(workDir, instructionFile, fltBlock, {
    mode: 'prepend',
    backup: true,
    replaceBetweenMarkers: {
      start: FLT_MARKER_START,
      end: FLT_MARKER_END,
    },
  })
}

export function restoreInstructions(projection: InstructionProjection): void {
  restoreProjectedInstructions(projection)
}
