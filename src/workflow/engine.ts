import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { loadWorkflowDef } from './parser'
import { getAgent, allAgents } from '../state'
import type { WorkflowDef, WorkflowRun, WorkflowStepDef } from './types'

function getRunsDir(): string {
  return join(process.env.HOME ?? require('os').homedir(), '.flt', 'workflows', 'runs')
}

function getRunPath(runId: string): string {
  return join(getRunsDir(), `${runId}.json`)
}

function generateRunId(workflowName: string): string {
  const runs = listWorkflowRuns().filter(r => r.workflow === workflowName && r.status === 'running')
  if (runs.length === 0) return workflowName
  // Find next available number
  let n = 2
  const existingIds = new Set(runs.map(r => r.id))
  while (existingIds.has(`${workflowName}-${n}`)) n++
  return `${workflowName}-${n}`
}

export function loadWorkflowRun(runId: string): WorkflowRun | null {
  const path = getRunPath(runId)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

export function saveWorkflowRun(run: WorkflowRun): void {
  const dir = getRunsDir()
  mkdirSync(dir, { recursive: true })
  const path = getRunPath(run.id)
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(run, null, 2) + '\n')
  renameSync(tmp, path)
}

export function listWorkflowRuns(): WorkflowRun[] {
  const dir = getRunsDir()
  if (!existsSync(dir)) return []

  const runs: WorkflowRun[] = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    try {
      runs.push(JSON.parse(readFileSync(join(dir, file), 'utf-8')))
    } catch {}
  }
  return runs
}

export async function startWorkflow(name: string, opts?: { parent?: string; task?: string; dir?: string }): Promise<WorkflowRun> {
  const def = loadWorkflowDef(name)

  // Derive parent from caller if not provided
  const callerName = opts?.parent ?? process.env.FLT_AGENT_NAME
  const resolvedParent = (callerName && callerName !== 'cron') ? callerName : 'human'

  const run: WorkflowRun = {
    id: generateRunId(name),
    workflow: name,
    currentStep: def.steps[0].id,
    status: 'running',
    parentName: resolvedParent,
    history: [],
    retries: {},
    vars: {
      _input: {
        task: opts?.task ?? '',
        dir: opts?.dir ?? process.cwd(),
      },
    },
    startedAt: new Date().toISOString(),
  }

  saveWorkflowRun(run)

  // Spawn the first step
  await executeStep(def, run, def.steps[0])

  return run
}

export async function advanceWorkflow(runId: string): Promise<void> {
  const run = loadWorkflowRun(runId)
  if (!run || run.status !== 'running') return

  const def = loadWorkflowDef(run.workflow)
  const currentStepDef = def.steps.find(s => s.id === run.currentStep)
  if (!currentStepDef) {
    run.status = 'failed'
    run.completedAt = new Date().toISOString()
    saveWorkflowRun(run)
    return
  }

  // Record current step completion
  const agentName = workflowAgentName(run.id, currentStepDef.id)
  const agent = getAgent(agentName)
  if (agent) {
    // Capture agent vars for template resolution
    run.vars[currentStepDef.id] = {
      worktree: agent.worktreePath ?? agent.dir,
      dir: agent.dir,
      branch: agent.worktreeBranch ?? '',
    }
  }

  run.history.push({
    step: currentStepDef.id,
    result: 'completed',
    at: new Date().toISOString(),
    agent: agentName,
  })

  // Kill the completed agent but preserve its worktree (next step may need it)
  try {
    const { killDirect } = await import('../commands/kill')
    killDirect({ name: agentName, preserveWorktree: true })
  } catch {}

  // Determine next step
  const nextStepId = currentStepDef.on_complete
  if (!nextStepId || nextStepId === 'done') {
    run.status = 'completed'
    run.completedAt = new Date().toISOString()
    saveWorkflowRun(run)
    cleanupWorkflowWorktrees(run)
    await notifyWorkflowParent(run, `Workflow "${run.workflow}" completed.`)
    return
  }

  const nextStepDef = def.steps.find(s => s.id === nextStepId)
  if (!nextStepDef) {
    run.status = 'failed'
    run.completedAt = new Date().toISOString()
    saveWorkflowRun(run)
    return
  }

  run.currentStep = nextStepId
  saveWorkflowRun(run)

  await executeStep(def, run, nextStepDef)
}

export async function handleStepFailure(runId: string): Promise<void> {
  const run = loadWorkflowRun(runId)
  if (!run || run.status !== 'running') return

  const def = loadWorkflowDef(run.workflow)
  const currentStepDef = def.steps.find(s => s.id === run.currentStep)
  if (!currentStepDef) return

  const maxRetries = currentStepDef.max_retries ?? 0
  const retryCount = run.retries[currentStepDef.id] ?? 0

  if (retryCount < maxRetries) {
    // Retry the step
    run.retries[currentStepDef.id] = retryCount + 1
    run.history.push({
      step: currentStepDef.id,
      result: 'failed',
      at: new Date().toISOString(),
    })
    saveWorkflowRun(run)

    // Kill failed agent, respawn
    const agentName = workflowAgentName(run.id, currentStepDef.id)
    try {
      const { killDirect } = await import('../commands/kill')
      killDirect({ name: agentName })
    } catch {}

    await executeStep(def, run, currentStepDef)
  } else {
    // Max retries exhausted
    run.history.push({
      step: currentStepDef.id,
      result: 'failed',
      at: new Date().toISOString(),
    })

    const failTarget = currentStepDef.on_fail
    if (failTarget && failTarget !== 'abort') {
      const failStepDef = def.steps.find(s => s.id === failTarget)
      if (failStepDef) {
        run.currentStep = failTarget
        saveWorkflowRun(run)
        await executeStep(def, run, failStepDef)
        return
      }
    }

    // Abort
    run.status = 'failed'
    run.completedAt = new Date().toISOString()
    saveWorkflowRun(run)
  }
}

export async function cancelWorkflow(runId: string): Promise<void> {
  const run = loadWorkflowRun(runId)
  if (!run) throw new Error(`No workflow run found for "${runId}"`)
  if (run.status !== 'running') throw new Error(`Workflow "${runId}" is not running (status: ${run.status})`)

  // Kill the current step's agent
  const agentName = workflowAgentName(run.id, run.currentStep)
  try {
    const { killDirect } = await import('../commands/kill')
    killDirect({ name: agentName })
  } catch {}

  run.status = 'cancelled'
  run.completedAt = new Date().toISOString()
  saveWorkflowRun(run)
  cleanupWorkflowWorktrees(run)
}

function shellEscapeArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function resolveTemplateShell(template: string, run: WorkflowRun): string {
  return template.replace(/\{steps\.([^.]+)\.(\w+)\}/g, (match, stepId, field) => {
    const stepVars = run.vars[stepId]
    if (!stepVars) return match
    const value = stepVars[field]
    if (value === undefined) return match
    return shellEscapeArg(value)
  })
}

async function executeStep(def: WorkflowDef, run: WorkflowRun, step: WorkflowStepDef): Promise<void> {
  if (step.run) {
    // Shell command step — execute and advance immediately
    try {
      execSync(resolveTemplateShell(step.run, run), { stdio: 'inherit', timeout: 30_000 })
      run.history.push({ step: step.id, result: 'completed', at: new Date().toISOString() })

      const nextId = step.on_complete
      if (!nextId || nextId === 'done') {
        run.status = 'completed'
        run.completedAt = new Date().toISOString()
        saveWorkflowRun(run)
        return
      }

      const nextStep = def.steps.find(s => s.id === nextId)
      if (nextStep) {
        run.currentStep = nextId
        saveWorkflowRun(run)
        await executeStep(def, run, nextStep)
      }
    } catch {
      run.history.push({ step: step.id, result: 'failed', at: new Date().toISOString() })
      run.status = 'failed'
      run.completedAt = new Date().toISOString()
      saveWorkflowRun(run)
    }
    return
  }

  // Agent step — spawn via preset
  const agentName = workflowAgentName(run.id, step.id)
  const task = resolveTemplate(step.task, run)
  const dir = step.dir
    ? resolveTemplate(step.dir, run)
    : (run.vars._input?.dir || undefined)

  const { spawnDirect } = await import('../commands/spawn')
  await spawnDirect({
    name: agentName,
    preset: step.preset,
    dir,
    worktree: step.worktree !== false,
    parent: run.parentName,
    bootstrap: task,
  })

  // Capture agent vars immediately after spawn
  const agent = getAgent(agentName)
  if (agent) {
    run.vars[step.id] = {
      worktree: agent.worktreePath ?? agent.dir,
      dir: agent.dir,
      branch: agent.worktreeBranch ?? '',
    }
    saveWorkflowRun(run)
  }
}

function resolveTemplate(template: string, run: WorkflowRun): string {
  // Shorthand: {task} → {steps._input.task}, {dir} → {steps._input.dir}
  let result = template
    .replace(/\{task\}/g, run.vars._input?.task ?? '')
    .replace(/\{dir\}/g, run.vars._input?.dir ?? '')
  // Full form: {steps.<id>.<field>}
  result = result.replace(/\{steps\.([^.]+)\.(\w+)\}/g, (match, stepId, field) => {
    const stepVars = run.vars[stepId]
    if (!stepVars) return match
    return stepVars[field] ?? match
  })
  return result
}

export function workflowAgentName(runId: string, stepId: string): string {
  return `${runId}-${stepId}`
}

function cleanupWorkflowWorktrees(run: WorkflowRun): void {
  for (const [stepId, vars] of Object.entries(run.vars)) {
    const wtPath = vars.worktree
    const branch = vars.branch
    if (!wtPath || !wtPath.includes('flt-wt-') || !branch) continue
    try {
      const { removeWorktree } = require('../worktree') as typeof import('../worktree')
      const repoDir = execSync('git rev-parse --show-toplevel', {
        cwd: wtPath, encoding: 'utf-8', timeout: 5000,
      }).trim()
      removeWorktree(repoDir, wtPath, branch)
    } catch {}
  }
}

async function notifyWorkflowParent(run: WorkflowRun, message: string): Promise<void> {
  try {
    const { appendInbox } = await import('../commands/init')
    if (run.parentName === 'human' || run.parentName === 'cron') {
      appendInbox('WORKFLOW', message)
    } else {
      const parent = getAgent(run.parentName)
      if (parent) {
        const { sendLiteral, sendKeys, hasSession } = await import('../tmux')
        const { resolveAdapter } = await import('../adapters/registry')
        if (hasSession(parent.tmuxSession)) {
          const tagged = `[WORKFLOW]: ${message}`
          sendLiteral(parent.tmuxSession, tagged)
          const adapter = resolveAdapter(parent.cli)
          sendKeys(parent.tmuxSession, adapter.submitKeys)
        }
      } else {
        appendInbox('WORKFLOW', message)
      }
    }
  } catch {}
}

// Map agent names to workflow run IDs for the controller poller
export function getWorkflowForAgent(agentName: string): string | null {
  const runs = listWorkflowRuns().filter(r => r.status === 'running')
  for (const run of runs) {
    const expectedAgent = workflowAgentName(run.id, run.currentStep)
    if (agentName === expectedAgent) return run.id
  }
  return null
}
