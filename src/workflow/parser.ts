import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { parse } from 'yaml'
import { getPreset } from '../presets'
import type {
  CollectArtifactsStep,
  ConditionStep,
  DynamicDagStep,
  HumanGateStep,
  MergeBestStep,
  ParallelStep,
  SpawnStep,
  WorkflowDef,
  WorkflowStepDef,
} from './types'

function getWorkflowsDir(): string {
  return join(process.env.HOME ?? require('os').homedir(), '.flt', 'workflows')
}

export function resolveWorkflowYamlPath(name: string): string {
  const dir = getWorkflowsDir()
  let filePath = join(dir, `${name}.yaml`)
  if (!existsSync(filePath)) {
    filePath = join(dir, `${name}.yml`)
  }
  if (!existsSync(filePath)) {
    throw new Error(`Workflow "${name}" not found. Expected at ${dir}/${name}.yaml`)
  }
  return filePath
}

export function loadWorkflowDef(name: string): WorkflowDef {
  const raw = readFileSync(resolveWorkflowYamlPath(name), 'utf-8')
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

function validatePresetName(stepId: string, preset: string, field = 'preset'): void {
  if (!getPreset(preset)) {
    throw new Error(`Step "${stepId}": ${field} "${preset}" not found. Run "flt presets list".`)
  }
}

function parseSpawnStep(raw: Record<string, unknown>, stepId: string): SpawnStep {
  if (raw.type !== undefined && raw.type !== 'spawn') {
    throw new Error(`unknown step type: ${raw.type as string}`)
  }

  if (raw.run !== undefined && typeof raw.run !== 'string') {
    throw new Error(`Step "${stepId}": "run" must be a string`)
  }

  if (raw.run === undefined) {
    if (typeof raw.preset !== 'string' || !raw.preset) {
      throw new Error(`Step "${stepId}": must have "preset" or "run"`)
    }
    if (typeof raw.task !== 'string' || !raw.task) {
      throw new Error(`Step "${stepId}": must have "task" when using "preset"`)
    }
    validatePresetName(stepId, raw.preset)
  }

  return {
    id: stepId,
    type: raw.type === 'spawn' ? 'spawn' : undefined,
    preset: typeof raw.preset === 'string' ? raw.preset : undefined,
    dir: typeof raw.dir === 'string' ? raw.dir : undefined,
    task: typeof raw.task === 'string' ? raw.task : undefined,
    on_complete: typeof raw.on_complete === 'string' ? raw.on_complete : undefined,
    on_fail: typeof raw.on_fail === 'string' ? raw.on_fail : undefined,
    max_retries: typeof raw.max_retries === 'number' ? raw.max_retries : undefined,
    worktree: typeof raw.worktree === 'boolean' ? raw.worktree : undefined,
    run: typeof raw.run === 'string' ? raw.run : undefined,
  }
}

function parseParallelStep(raw: Record<string, unknown>, stepId: string): ParallelStep {
  if (!Number.isInteger(raw.n) || (raw.n as number) < 2) {
    throw new Error(`Step "${stepId}": parallel "n" must be an integer >= 2`)
  }

  if (!raw.step || typeof raw.step !== 'object' || Array.isArray(raw.step)) {
    throw new Error(`Step "${stepId}": parallel step must include "step"`)
  }

  if (raw.presets !== undefined) {
    if (!Array.isArray(raw.presets) || raw.presets.some(p => typeof p !== 'string' || !p)) {
      throw new Error(`Step "${stepId}": parallel "presets" must be string[]`)
    }
    if (raw.presets.length !== (raw.n as number)) {
      throw new Error(`Step "${stepId}": parallel presets length === n`)
    }
    for (const preset of raw.presets) {
      validatePresetName(stepId, preset, 'preset')
    }
  }

  const childRaw = raw.step as Record<string, unknown>
  if (typeof childRaw.id !== 'string' || !childRaw.id) {
    throw new Error(`Step "${stepId}": parallel child step must have an "id" field`)
  }

  const child = parseSpawnStep(childRaw, `${stepId}.step`)

  return {
    id: stepId,
    type: 'parallel',
    n: raw.n as number,
    presets: raw.presets as string[] | undefined,
    step: child,
    on_complete: typeof raw.on_complete === 'string' ? raw.on_complete : undefined,
    on_fail: typeof raw.on_fail === 'string' ? raw.on_fail : undefined,
    max_retries: typeof raw.max_retries === 'number' ? raw.max_retries : undefined,
  }
}

function positiveInt(raw: unknown, stepId: string, field: string): number | undefined {
  if (raw === undefined) return undefined
  if (!Number.isInteger(raw) || (raw as number) <= 0) {
    throw new Error(`Step "${stepId}": "${field}" must be a positive integer`)
  }
  return raw as number
}

function parseDynamicDagStep(raw: Record<string, unknown>, stepId: string): DynamicDagStep {
  if (typeof raw.plan_from !== 'string' || !raw.plan_from) {
    throw new Error(`Step "${stepId}": dynamic_dag requires "plan_from"`)
  }

  let reconciler: { preset: string; task: string } | undefined
  if (raw.reconciler !== undefined) {
    if (!raw.reconciler || typeof raw.reconciler !== 'object' || Array.isArray(raw.reconciler)) {
      throw new Error(`Step "${stepId}": "reconciler" must be an object`)
    }
    const r = raw.reconciler as Record<string, unknown>
    if (typeof r.preset !== 'string' || !r.preset || typeof r.task !== 'string' || !r.task) {
      throw new Error(`Step "${stepId}": reconciler requires "preset" and "task"`)
    }
    validatePresetName(stepId, r.preset, 'reconciler.preset')
    reconciler = { preset: r.preset, task: r.task }
  }

  return {
    id: stepId,
    type: 'dynamic_dag',
    plan_from: raw.plan_from,
    reconciler,
    max_nodes: positiveInt(raw.max_nodes, stepId, 'max_nodes') ?? 12,
    max_depth: positiveInt(raw.max_depth, stepId, 'max_depth') ?? 5,
    max_parallel_per_wave: positiveInt(raw.max_parallel_per_wave, stepId, 'max_parallel_per_wave') ?? 6,
    node_max_retries: positiveInt(raw.node_max_retries, stepId, 'node_max_retries') ?? 2,
    on_complete: typeof raw.on_complete === 'string' ? raw.on_complete : undefined,
    on_fail: typeof raw.on_fail === 'string' ? raw.on_fail : undefined,
    max_retries: typeof raw.max_retries === 'number' ? raw.max_retries : undefined,
  }
}

function parseConditionStep(
  raw: Record<string, unknown>,
  stepId: string,
  stepIds: Set<string>,
  positions: Map<string, number>,
): ConditionStep {
  if (typeof raw.if !== 'string' || !raw.if) {
    throw new Error(`Step "${stepId}": condition requires "if"`)
  }
  if (typeof raw.then !== 'string' || !raw.then) {
    throw new Error(`Step "${stepId}": condition requires "then"`)
  }
  if (!stepIds.has(raw.then)) {
    throw new Error(`Step "${stepId}": condition "then" references unknown step "${raw.then}"`)
  }

  const here = positions.get(stepId) ?? -1
  const thenPos = positions.get(raw.then) ?? -1
  if (thenPos < here) {
    throw new Error(`condition: backward jump from "${stepId}" to "${raw.then}" not allowed`)
  }

  if (raw.else !== undefined) {
    if (typeof raw.else !== 'string' || !raw.else) {
      throw new Error(`Step "${stepId}": condition "else" must be a string`)
    }
    if (!stepIds.has(raw.else)) {
      throw new Error(`Step "${stepId}": condition "else" references unknown step "${raw.else}"`)
    }
    const elsePos = positions.get(raw.else) ?? -1
    if (elsePos < here) {
      throw new Error(`condition: backward jump from "${stepId}" to "${raw.else}" not allowed`)
    }
  }

  return {
    id: stepId,
    type: 'condition',
    if: raw.if,
    then: raw.then,
    else: raw.else as string | undefined,
    on_complete: typeof raw.on_complete === 'string' ? raw.on_complete : undefined,
    on_fail: typeof raw.on_fail === 'string' ? raw.on_fail : undefined,
    max_retries: typeof raw.max_retries === 'number' ? raw.max_retries : undefined,
  }
}

function parseHumanGateStep(raw: Record<string, unknown>, stepId: string): HumanGateStep {
  if (raw.notify !== undefined && typeof raw.notify !== 'string') {
    throw new Error(`Step "${stepId}": human_gate "notify" must be a string`)
  }

  return {
    id: stepId,
    type: 'human_gate',
    notify: raw.notify as string | undefined,
    on_complete: typeof raw.on_complete === 'string' ? raw.on_complete : undefined,
    on_fail: typeof raw.on_fail === 'string' ? raw.on_fail : undefined,
    max_retries: typeof raw.max_retries === 'number' ? raw.max_retries : undefined,
  }
}

function parseMergeBestStep(
  raw: Record<string, unknown>,
  stepId: string,
  byId: Map<string, Record<string, unknown>>,
): MergeBestStep {
  if (typeof raw.candidate_var !== 'string' || !raw.candidate_var) {
    throw new Error(`Step "${stepId}": merge_best requires "candidate_var"`)
  }

  const target = byId.get(raw.candidate_var)
  if (!target) {
    throw new Error(`Step "${stepId}": candidate_var references unknown step "${raw.candidate_var}"`)
  }
  if (target.type !== 'parallel') {
    throw new Error(`Step "${stepId}": candidate_var must reference a parallel step`)
  }

  if (raw.target_branch !== undefined && typeof raw.target_branch !== 'string') {
    throw new Error(`Step "${stepId}": merge_best "target_branch" must be a string`)
  }

  return {
    id: stepId,
    type: 'merge_best',
    candidate_var: raw.candidate_var,
    target_branch: raw.target_branch as string | undefined,
    on_complete: typeof raw.on_complete === 'string' ? raw.on_complete : undefined,
    on_fail: typeof raw.on_fail === 'string' ? raw.on_fail : undefined,
    max_retries: typeof raw.max_retries === 'number' ? raw.max_retries : undefined,
  }
}

function parseCollectArtifactsStep(
  raw: Record<string, unknown>,
  stepId: string,
  stepIds: Set<string>,
): CollectArtifactsStep {
  if (!Array.isArray(raw.from) || raw.from.some(v => typeof v !== 'string' || !v)) {
    throw new Error(`Step "${stepId}": collect_artifacts requires "from" as string[]`)
  }
  if (raw.from.some(fromId => !stepIds.has(fromId))) {
    throw new Error(`Step "${stepId}": collect_artifacts "from" references unknown step`)
  }

  if (!Array.isArray(raw.files) || raw.files.some(v => typeof v !== 'string' || !v)) {
    throw new Error(`Step "${stepId}": collect_artifacts requires "files" as string[]`)
  }
  if (typeof raw.into !== 'string' || !raw.into) {
    throw new Error(`Step "${stepId}": collect_artifacts requires "into"`)
  }

  return {
    id: stepId,
    type: 'collect_artifacts',
    from: raw.from as string[],
    files: raw.files as string[],
    into: raw.into,
    on_complete: typeof raw.on_complete === 'string' ? raw.on_complete : undefined,
    on_fail: typeof raw.on_fail === 'string' ? raw.on_fail : undefined,
    max_retries: typeof raw.max_retries === 'number' ? raw.max_retries : undefined,
  }
}

export function validateWorkflowDef(raw: unknown): WorkflowDef {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Workflow definition must be an object')
  }

  const obj = raw as Record<string, unknown>
  if (typeof obj.name !== 'string' || !obj.name) {
    throw new Error('Workflow must have a "name" field')
  }
  if (obj.auto_pr !== undefined && typeof obj.auto_pr !== 'boolean') {
    throw new Error('Workflow "auto_pr" must be a boolean')
  }
  if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
    throw new Error('Workflow must have a non-empty "steps" array')
  }

  const stepIds = new Set<string>()
  const positions = new Map<string, number>()
  const byId = new Map<string, Record<string, unknown>>()

  for (let i = 0; i < obj.steps.length; i += 1) {
    const step = obj.steps[i]
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
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
    positions.set(s.id, i)
    byId.set(s.id, s)
  }

  const steps: WorkflowStepDef[] = []

  for (const step of obj.steps) {
    const s = step as Record<string, unknown>
    const stepId = s.id as string
    const type = s.type

    if (type === undefined || type === 'spawn') {
      steps.push(parseSpawnStep(s, stepId))
      continue
    }

    if (typeof type !== 'string') {
      throw new Error(`unknown step type: ${String(type)}`)
    }

    switch (type) {
      case 'parallel':
        steps.push(parseParallelStep(s, stepId))
        break
      case 'dynamic_dag':
        steps.push(parseDynamicDagStep(s, stepId))
        break
      case 'condition':
        steps.push(parseConditionStep(s, stepId, stepIds, positions))
        break
      case 'human_gate':
        steps.push(parseHumanGateStep(s, stepId))
        break
      case 'merge_best':
        steps.push(parseMergeBestStep(s, stepId, byId))
        break
      case 'collect_artifacts':
        steps.push(parseCollectArtifactsStep(s, stepId, stepIds))
        break
      default:
        throw new Error(`unknown step type: ${type}`)
    }
  }

  for (const step of steps) {
    if (step.on_complete && step.on_complete !== 'done' && !stepIds.has(step.on_complete)) {
      throw new Error(`Step "${step.id}": on_complete references unknown step "${step.on_complete}"`)
    }
    if (step.on_fail && step.on_fail !== 'abort' && !stepIds.has(step.on_fail)) {
      throw new Error(`Step "${step.id}": on_fail references unknown step "${step.on_fail}"`)
    }
  }

  return { name: obj.name, auto_pr: obj.auto_pr as boolean | undefined, steps }
}
