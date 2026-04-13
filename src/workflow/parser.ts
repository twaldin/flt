import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { parse } from 'yaml'
import { getPreset } from '../presets'
import type { WorkflowDef, WorkflowStepDef } from './types'

function getWorkflowsDir(): string {
  return join(process.env.HOME ?? require('os').homedir(), '.flt', 'workflows')
}

export function loadWorkflowDef(name: string): WorkflowDef {
  const dir = getWorkflowsDir()
  // Try .yaml then .yml
  let filePath = join(dir, `${name}.yaml`)
  if (!existsSync(filePath)) {
    filePath = join(dir, `${name}.yml`)
  }
  if (!existsSync(filePath)) {
    throw new Error(`Workflow "${name}" not found. Expected at ${dir}/${name}.yaml`)
  }

  const raw = readFileSync(filePath, 'utf-8')
  const parsed = parse(raw)
  return validateWorkflowDef(parsed)
}

export function listWorkflowDefs(): string[] {
  const dir = getWorkflowsDir()
  if (!existsSync(dir)) return []

  return readdirSync(dir)
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map(f => f.replace(/\.(yaml|yml)$/, ''))
}

export function validateWorkflowDef(raw: unknown): WorkflowDef {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Workflow definition must be an object')
  }

  const obj = raw as Record<string, unknown>
  if (typeof obj.name !== 'string' || !obj.name) {
    throw new Error('Workflow must have a "name" field')
  }
  if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
    throw new Error('Workflow must have a non-empty "steps" array')
  }

  const stepIds = new Set<string>()
  const steps: WorkflowStepDef[] = []

  for (const step of obj.steps) {
    if (!step || typeof step !== 'object') {
      throw new Error('Each step must be an object')
    }

    const s = step as Record<string, unknown>
    if (typeof s.id !== 'string' || !s.id) {
      throw new Error('Each step must have an "id" field')
    }
    if (stepIds.has(s.id)) {
      throw new Error(`Duplicate step id: "${s.id}"`)
    }
    stepIds.add(s.id)

    // Must have either (preset + task) or run
    if (s.run) {
      if (typeof s.run !== 'string') {
        throw new Error(`Step "${s.id}": "run" must be a string`)
      }
    } else {
      if (typeof s.preset !== 'string' || !s.preset) {
        throw new Error(`Step "${s.id}": must have "preset" or "run"`)
      }
      if (typeof s.task !== 'string' || !s.task) {
        throw new Error(`Step "${s.id}": must have "task" when using "preset"`)
      }
      // Validate preset exists
      if (!getPreset(s.preset)) {
        throw new Error(`Step "${s.id}": preset "${s.preset}" not found. Run "flt presets list".`)
      }
    }

    steps.push({
      id: s.id,
      preset: s.preset as string,
      dir: s.dir as string | undefined,
      task: s.task as string,
      on_complete: s.on_complete as string | undefined,
      on_fail: s.on_fail as string | undefined,
      max_retries: typeof s.max_retries === 'number' ? s.max_retries : undefined,
      run: s.run as string | undefined,
    })
  }

  // Validate references
  for (const step of steps) {
    if (step.on_complete && step.on_complete !== 'done' && !stepIds.has(step.on_complete)) {
      throw new Error(`Step "${step.id}": on_complete references unknown step "${step.on_complete}"`)
    }
    if (step.on_fail && step.on_fail !== 'abort' && !stepIds.has(step.on_fail)) {
      throw new Error(`Step "${step.id}": on_fail references unknown step "${step.on_fail}"`)
    }
  }

  return { name: obj.name, steps }
}
