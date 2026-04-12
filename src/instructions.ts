import { readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

const TEMPLATE_PATH = join(import.meta.dir, '..', 'templates', 'system-block.md')
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
}

export function buildSystemBlock(opts: InstructionOpts): string {
  let template = readFileSync(TEMPLATE_PATH, 'utf-8')
  template = template.replace(/\{\{name\}\}/g, opts.agentName)
  template = template.replace(/\{\{parentName\}\}/g, opts.parentName)
  template = template.replace(/\{\{cli\}\}/g, opts.cli)
  template = template.replace(/\{\{model\}\}/g, opts.model || 'default')
  return template
}

export function loadSoulMd(agentName: string): string | null {
  const soulPath = join(home(), '.flt', 'agents', agentName, 'SOUL.md')
  if (!existsSync(soulPath)) return null
  return readFileSync(soulPath, 'utf-8')
}

export function buildFullInstructions(opts: InstructionOpts): string {
  const parts: string[] = [
    FLT_MARKER_START,
    buildSystemBlock(opts),
  ]

  const soul = loadSoulMd(opts.agentName)
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
