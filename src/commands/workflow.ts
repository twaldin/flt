import { existsSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { startWorkflow, loadWorkflowRun, listWorkflowRuns, cancelWorkflow, advanceWorkflow, saveWorkflowRun, slugFromTask } from '../workflow/engine'
import { listWorkflowDefs, loadWorkflowDef } from '../workflow/parser'

export async function workflowRun(name: string, opts?: { parent?: string; task?: string; dir?: string; n?: number; slug?: string }): Promise<void> {
  if (opts?.n !== undefined && opts.n > 1) {
    for (let i = 0; i < opts.n; i += 1) {
      const run = await startWorkflow(name, { parent: opts.parent, task: opts.task, dir: opts.dir, slug: opts.slug })
      console.log(`Started workflow "${run.id}" (step: ${run.currentStep}, parent: ${run.parentName})`)
    }
    return
  }

  const run = await startWorkflow(name, { parent: opts?.parent, task: opts?.task, dir: opts?.dir, slug: opts?.slug })
  console.log(`Started workflow "${run.id}" (step: ${run.currentStep}, parent: ${run.parentName})`)
}

export async function workflowApprove(runId: string, opts?: { candidate?: string }): Promise<void> {
  const run = loadWorkflowRun(runId)
  if (!run) {
    throw new Error(`No workflow run found for "${runId}"`)
  }
  if (run.status !== 'running') {
    throw new Error(`Workflow "${runId}" is not running (status: ${run.status})`)
  }

  const def = loadWorkflowDef(run.workflow)
  const currentStepDef = def.steps.find(s => s.id === run.currentStep)
  if (currentStepDef?.type !== 'human_gate') {
    throw new Error(`Workflow "${runId}" current step "${run.currentStep}" is not a human_gate`)
  }
  if (!run.runDir) {
    throw new Error(`workflow run "${run.id}" is missing runDir`)
  }

  const decisionPath = join(run.runDir, '.gate-decision')
  const tmp = `${decisionPath}.tmp`
  writeFileSync(tmp, JSON.stringify({
    approved: true,
    ...(opts?.candidate === undefined ? {} : { candidate: opts.candidate }),
    at: new Date().toISOString(),
  }) + '\n')
  renameSync(tmp, decisionPath)

  console.log(`Approved ${runId}${opts?.candidate ? ` (candidate: ${opts.candidate})` : ''}`)
  await advanceWorkflow(runId)
}

/**
 * Manually trigger advanceWorkflow for a stuck run.
 * Useful when result files exist but the controller poller didn't fire because
 * the agent went idle without a status change. Idempotent.
 */
export async function workflowAdvance(runId: string): Promise<void> {
  const run = loadWorkflowRun(runId)
  if (!run) throw new Error(`No workflow run found for "${runId}"`)
  if (run.status !== 'running') {
    console.log(`Workflow "${runId}" is not running (status: ${run.status}); nothing to advance.`)
    return
  }
  await advanceWorkflow(runId)
  const after = loadWorkflowRun(runId)
  console.log(`Advanced ${runId}: step=${after?.currentStep} status=${after?.status}`)
}

/**
 * Backfill rename of a TERMINAL workflow run id to a slug-based id.
 * Requires status !== 'running' to avoid breaking live agent name lookups.
 * Renames run.json id field, mvs the runDir on disk, updates run.runDir.
 * Old worktree branches (flt/<oldId>-<step>) are left alone — git keeps them as historical labels.
 */
export async function workflowRename(oldId: string, opts?: { slug?: string }): Promise<void> {
  const run = loadWorkflowRun(oldId)
  if (!run) throw new Error(`No workflow run found for "${oldId}"`)
  if (run.status === 'running') {
    throw new Error(`Cannot rename "${oldId}" while running (status: ${run.status}). Cancel first.`)
  }

  const slug = opts?.slug ?? (run.vars._input?.task ? slugFromTask(run.vars._input.task) : '')
  if (!slug) {
    throw new Error(`No --slug given and could not derive one from run.vars._input.task`)
  }

  const fltRunsDir = join(process.env.HOME ?? homedir(), '.flt', 'runs')
  let newId = `${run.workflow}-${slug}`
  let n = 2
  while (existsSync(join(fltRunsDir, newId))) {
    newId = `${run.workflow}-${slug}-${n}`
    n++
  }

  const oldDir = join(fltRunsDir, oldId)
  const newDir = join(fltRunsDir, newId)
  if (!existsSync(oldDir)) throw new Error(`Run dir missing: ${oldDir}`)

  renameSync(oldDir, newDir)
  run.id = newId
  run.runDir = newDir
  saveWorkflowRun(run)

  console.log(`Renamed ${oldId} → ${newId}`)
  console.log(`  runDir: ${newDir}`)
}

export async function workflowReject(runId: string, reason: string): Promise<void> {
  const run = loadWorkflowRun(runId)
  if (!run) {
    throw new Error(`No workflow run found for "${runId}"`)
  }
  if (run.status !== 'running') {
    throw new Error(`Workflow "${runId}" is not running (status: ${run.status})`)
  }

  const def = loadWorkflowDef(run.workflow)
  const currentStepDef = def.steps.find(s => s.id === run.currentStep)
  if (currentStepDef?.type !== 'human_gate') {
    throw new Error(`Workflow "${runId}" current step "${run.currentStep}" is not a human_gate`)
  }
  if (!reason) {
    throw new Error('reject requires --reason')
  }
  if (!run.runDir) {
    throw new Error(`workflow run "${run.id}" is missing runDir`)
  }

  const decisionPath = join(run.runDir, '.gate-decision')
  const tmp = `${decisionPath}.tmp`
  writeFileSync(tmp, JSON.stringify({
    approved: false,
    reason,
    at: new Date().toISOString(),
  }) + '\n')
  renameSync(tmp, decisionPath)

  console.log(`Rejected ${runId}: ${reason}`)
  await advanceWorkflow(runId)
}

export function workflowStatus(name?: string): void {
  if (name) {
    const run = loadWorkflowRun(name)
    if (!run) {
      console.log(`No workflow run found for "${name}".`)
      return
    }
    printRun(run)
    return
  }

  // Show most recent active run
  const runs = listWorkflowRuns().filter(r => r.status === 'running')
  if (runs.length === 0) {
    console.log('No active workflow runs.')
    return
  }
  for (const run of runs) {
    printRun(run)
  }
}

export function workflowList(): void {
  const defs = listWorkflowDefs()
  const runs = listWorkflowRuns()

  if (defs.length === 0 && runs.length === 0) {
    console.log('No workflows found. Create YAML files in ~/.flt/workflows/')
    return
  }

  if (defs.length > 0) {
    console.log('Workflow definitions:')
    for (const name of defs) {
      const active = runs.filter(r => r.workflow === name && r.status === 'running')
      if (active.length === 0) {
        console.log(`  ${name}`)
      } else {
        for (const run of active) {
          console.log(`  ${name} [${run.id}: ${run.currentStep}]`)
        }
      }
    }
  }

  const completed = runs.filter(r => r.status !== 'running')
  if (completed.length > 0) {
    console.log('\nRecent runs:')
    for (const run of completed.slice(-5)) {
      console.log(`  ${run.workflow} — ${run.status} (${run.completedAt ?? 'unknown'})`)
    }
  }
}

export async function workflowCancel(name: string): Promise<void> {
  await cancelWorkflow(name)
  console.log(`Cancelled workflow "${name}".`)
}

export async function workflowNodeDecision(action: 'retry' | 'skip' | 'abort', runId: string, nodeId?: string): Promise<void> {
  const run = loadWorkflowRun(runId)
  if (!run) throw new Error(`No workflow run found for "${runId}"`)
  if (run.status !== 'running') throw new Error(`Workflow "${runId}" is not running (status: ${run.status})`)

  const def = loadWorkflowDef(run.workflow)
  const currentStepDef = def.steps.find(s => s.id === run.currentStep)
  if (currentStepDef?.type !== 'dynamic_dag') {
    throw new Error(`Workflow "${runId}" current step "${run.currentStep}" is not a dynamic_dag step`)
  }
  if (!run.runDir) throw new Error(`workflow run "${run.id}" is missing runDir`)

  const group = run.dynamicDagGroups?.[run.currentStep]
  if (!group) throw new Error(`Workflow "${runId}" has no dynamic DAG state for step "${run.currentStep}"`)

  if (action !== 'abort') {
    if (!nodeId) throw new Error(`workflow node ${action} requires <node-id>`)
    if (!group.nodes[nodeId]) throw new Error(`Unknown node id "${nodeId}"`) 
  }

  const decisionPath = join(run.runDir, '.gate-decision')
  const tmp = `${decisionPath}.tmp`
  writeFileSync(tmp, JSON.stringify({
    kind: 'node-fail',
    step: run.currentStep,
    ...(nodeId ? { nodeId } : {}),
    action,
    at: new Date().toISOString(),
  }) + '\n')
  renameSync(tmp, decisionPath)

  console.log(`Queued node gate decision for ${runId}: ${action}${nodeId ? ` ${nodeId}` : ''}`)
  await advanceWorkflow(runId)
}

export function workflowPass(): void {
  const { signalWorkflowResult } = require('../workflow/engine') as typeof import('../workflow/engine')
  signalWorkflowResult('pass')
  console.log('Signaled PASS — workflow will advance to on_complete step.')
}

export function workflowFail(reason?: string): void {
  const { signalWorkflowResult } = require('../workflow/engine') as typeof import('../workflow/engine')
  signalWorkflowResult('fail', reason)
  console.log(`Signaled FAIL${reason ? ': ' + reason : ''} — workflow will follow on_fail path.`)
}

function printRun(run: ReturnType<typeof loadWorkflowRun>): void {
  if (!run) return
  console.log(`Workflow: ${run.workflow} (id: ${run.id})`)
  console.log(`Status: ${run.status}`)
  console.log(`Current step: ${run.currentStep}`)
  console.log(`Started: ${run.startedAt}`)
  if (run.completedAt) console.log(`Completed: ${run.completedAt}`)
  if (run.history.length > 0) {
    console.log('History:')
    for (const h of run.history) {
      console.log(`  ${h.step}: ${h.result} at ${h.at}${h.agent ? ` (agent: ${h.agent})` : ''}`)
    }
  }
  const retries = Object.entries(run.retries).filter(([, v]) => v > 0)
  if (retries.length > 0) {
    console.log('Retries:', retries.map(([k, v]) => `${k}=${v}`).join(', '))
  }
}
