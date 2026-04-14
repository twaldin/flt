import { readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

const TEMPLATE_PATH = join(import.meta.dir, '..', 'templates', 'system-block.md')
const WORKFLOW_TEMPLATE_PATH = join(import.meta.dir, '..', 'templates', 'workflow-block.md')
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
}

export function buildSystemBlock(opts: InstructionOpts): string {
  const templatePath = opts.workflow ? WORKFLOW_TEMPLATE_PATH : TEMPLATE_PATH
  let template = readFileSync(templatePath, 'utf-8')
  template = template.replace(/\{\{name\}\}/g, opts.agentName)
  template = template.replace(/\{\{parentName\}\}/g, opts.parentName)
  template = template.replace(/\{\{cli\}\}/g, opts.cli)
  template = template.replace(/\{\{model\}\}/g, opts.model || 'default')
  template = template.replace(/\{\{workflow\}\}/g, opts.workflow || '')
  template = template.replace(/\{\{step\}\}/g, opts.step || '')
  return template
}

export function loadSoulMd(agentName: string, presetSoul?: string): string | null {
  // 1. Check agent-specific SOUL.md
  const soulPath = join(home(), '.flt', 'agents', agentName, 'SOUL.md')
  if (existsSync(soulPath)) return readFileSync(soulPath, 'utf-8')

  // 2. Fall back to preset soul path
  if (presetSoul) {
    const resolved = presetSoul.startsWith('/')
      ? presetSoul
      : join(home(), '.flt', presetSoul)
    if (existsSync(resolved)) return readFileSync(resolved, 'utf-8')
  }

  return null
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

export function projectInstructions(
  workDir: string,
  instructionFile: string,
  opts: InstructionOpts,
): void {
  const filePath = join(workDir, instructionFile)
  const fltBlock = buildFullInstructions(opts)

  // Ensure parent directory exists (for nested paths like .opencode/agents/flt.md)
  mkdirSync(dirname(filePath), { recursive: true })

  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, 'utf-8')

    // If already has flt block, replace it
    if (existing.includes(FLT_MARKER_START)) {
      const re = new RegExp(
        `${escapeRegex(FLT_MARKER_START)}[\\s\\S]*?${escapeRegex(FLT_MARKER_END)}`,
      )
      writeFileSync(filePath, existing.replace(re, fltBlock))
      return
    }

    // Backup existing file, prepend flt block
    const backupPath = join(workDir, `.flt-backup-${instructionFile}`)
    copyFileSync(filePath, backupPath)
    writeFileSync(filePath, fltBlock + '\n\n' + existing)
  } else {
    writeFileSync(filePath, fltBlock + '\n')
  }
}

export function restoreInstructions(workDir: string, instructionFile: string): void {
  const backupPath = join(workDir, `.flt-backup-${instructionFile}`)
  const filePath = join(workDir, instructionFile)

  if (existsSync(backupPath)) {
    copyFileSync(backupPath, filePath)
    try { unlinkSync(backupPath) } catch {}
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
