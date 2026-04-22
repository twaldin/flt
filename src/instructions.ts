import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import {
  projectInstructions as harnessProjectInstructions,
  restoreProjectedInstructions,
  type InstructionProjection,
} from '@twaldin/harness-ts'

// Local override templates take precedence over bundled ones
// This allows template updates without waiting for npm publish
const BUNDLED_TEMPLATE_PATH = join(import.meta.dir, '..', 'templates', 'system-block.md')
const BUNDLED_WORKFLOW_PATH = join(import.meta.dir, '..', 'templates', 'workflow-block.md')

function resolveTemplate(localName: string, bundledPath: string): string {
  const localPath = join(home(), '.flt', 'templates', localName)
  return existsSync(localPath) ? localPath : bundledPath
}

const TEMPLATE_PATH = resolveTemplate('system-block.md', BUNDLED_TEMPLATE_PATH)
const WORKFLOW_TEMPLATE_PATH = resolveTemplate('workflow-block.md', BUNDLED_WORKFLOW_PATH)
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

export type { InstructionProjection }

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
): InstructionProjection {
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
