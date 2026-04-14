import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { loadWorkflowDef } from './parser'
import { getAgent, allAgents } from '../state'
import type { WorkflowDef, WorkflowRun, WorkflowStepDef } from './types'

function getWorkflowRunDir(workflowName: string): string {
  return join(process.env.HOME ?? require('os').homedir(), '.flt', 'workflows', workflowName)
}

function getRunPath(workflowName: string): string {
  return join(getWorkflowRunDir(workflowName), 'run.json')
}

export function loadWorkflowRun(workflowName: string): WorkflowRun | null {
  const path = getRunPath(workflowName)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

export function saveWorkflowRun(run: WorkflowRun): void {
  const dir = getWorkflowRunDir(run.workflow)
  mkdirSync(dir, { recursive: true })
  const path = getRunPath(run.workflow)
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(run, null, 2) + '\n')
  renameSync(tmp, path)
}

export function listWorkflowRuns(): WorkflowRun[] {
  const baseDir = join(process.env.HOME ?? require('os').homedir(), '.flt', 'workflows')
  if (!existsSync(baseDir)) return []

  const runs: WorkflowRun[] = []
  for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const runFile = join(baseDir, entry.name, 'run.json')
    if (existsSync(runFile)) {
      try {
        runs.push(JSON.parse(readFileSync(runFile, 'utf-8')))
      } catch {}
    }
  }
  return runs
}

export async function startWorkflow(name: string, opts?: { parent?: string; task?: string; dir?: string }): Promise<WorkflowRun> {
  const def = loadWorkflowDef(name)

  // Check for existing active run
  const existing = loadWorkflowRun(name)
  if (existing && existing.status === 'running') {
    throw new Error(`Workflow "${name}" is already running (step: ${existing.currentStep}).`)
  }

  // Derive parent from caller if not provided
  const callerName = opts?.parent ?? process.env.FLT_AGENT_NAME
  const resolvedParent = (callerName && callerName !== 'cron') ? callerName : 'human'

  const run: WorkflowRun = {
    id: `${name}-${Date.now()}`,
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

export async function advanceWorkflow(workflowName: string): Promise<void> {
  const run = loadWorkflowRun(workflowName)
  if (!run || run.status !== 'running') return

  const def = loadWorkflowDef(workflowName)
  const currentStepDef = def.steps.find(s => s.id === run.currentStep)
  if (!currentStepDef) {
    run.status = 'failed'
    run.completedAt = new Date().toISOString()
    saveWorkflowRun(run)
    return
  }

  // Record current step completion
  const agentName = workflowAgentName(workflowName, currentStepDef.id)
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

export async function handleStepFailure(workflowName: string): Promise<void> {
  const run = loadWorkflowRun(workflowName)
  if (!run || run.status !== 'running') return

  const def = loadWorkflowDef(workflowName)
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
    const agentName = workflowAgentName(workflowName, currentStepDef.id)
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

export async function cancelWorkflow(workflowName: string): Promise<void> {
  const run = loadWorkflowRun(workflowName)
  if (!run) throw new Error(`No workflow run found for "${workflowName}"`)
  if (run.status !== 'running') throw new Error(`Workflow "${workflowName}" is not running (status: ${run.status})`)

  // Kill the current step's agent
  const agentName = workflowAgentName(workflowName, run.currentStep)
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
  const agentName = workflowAgentName(run.workflow, step.id)
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

export function workflowAgentName(workflowName: string, stepId: string): string {
  return `${workflowName}-${stepId}`
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

// Map agent names to workflow names for the controller poller
export function getWorkflowForAgent(agentName: string): string | null {
  const runs = listWorkflowRuns().filter(r => r.status === 'running')
  for (const run of runs) {
    const expectedAgent = workflowAgentName(run.workflow, run.currentStep)
    if (agentName === expectedAgent) return run.workflow
  }
  return null
}
