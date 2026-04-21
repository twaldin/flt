import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { loadWorkflowDef } from './parser'
import { getAgent, allAgents } from '../state'
import type { WorkflowDef, WorkflowRun, WorkflowStepDef } from './types'
import { appendEvent } from '../activity'
import * as tmux from '../tmux'
import { sendDirect } from '../commands/send'
import type { CallerContext } from '../detect'

function getRunsDir(): string {
  return join(process.env.HOME ?? require('os').homedir(), '.flt', 'workflows', 'runs')
}

function getRunPath(runId: string): string {
  return join(getRunsDir(), `${runId}.json`)
}

function generateRunId(workflowName: string): string {
  const allRuns = listWorkflowRuns().filter(r => r.workflow === workflowName)
  const existingIds = new Set(allRuns.map(r => r.id))
  // Always increment — never reuse a run ID (protects worktree branches)
  let n = 1
  while (existingIds.has(n === 1 ? workflowName : `${workflowName}-${n}`)) n++
  return n === 1 ? workflowName : `${workflowName}-${n}`
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
  appendEvent({ type: 'workflow', detail: `started ${name}`, at: run.startedAt })

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

  // Idle-without-verdict guard: an agent that went idle without calling
  // `flt workflow pass` / `flt workflow fail <reason>` used to silently default
  // to pass, which swallowed reviewer feedback (e.g. agentelo PR 10). Instead,
  // prod the agent up to 2 times to force an explicit verdict, then fail the
  // step if they still won't report.
  if (run.stepResult === undefined) {
    const prods = run.stepProdCount ?? 0
    if (prods < 2 && agent && tmux.hasSession(agent.tmuxSession)) {
      run.stepProdCount = prods + 1
      saveWorkflowRun(run)
      const urgency = prods === 0 ? '' : ' (second prompt — next silent idle fails the step)'
      const prodMsg = `you went idle without emitting a verdict${urgency}. Review your work against the task and call exactly one of:\n  flt workflow pass\n  flt workflow fail "<one-line reason>"\nDo it now.`
      try {
        await sendDirect({ target: agentName, message: prodMsg, _caller: { mode: 'agent', agentName: 'flt-controller', depth: 0 } as CallerContext })
      } catch (e) {
        const { appendInbox } = await import('../commands/init')
        appendInbox('WORKFLOW', `Failed to prod ${agentName} for verdict: ${(e as Error).message}`)
      }
      appendEvent({ type: 'workflow', detail: `prod ${run.id}/${currentStepDef.id}: no verdict after idle (attempt ${run.stepProdCount})`, at: new Date().toISOString() })
      return
    }
    if (prods >= 2) {
      // Third silent idle — treat as fail with a clear reason.
      run.stepResult = 'fail'
      run.stepFailReason = `agent went idle ${prods + 1} times without emitting PASS or FAIL via flt workflow`
      appendEvent({ type: 'workflow', detail: `forced-fail ${run.id}/${currentStepDef.id}: ${run.stepFailReason}`, at: new Date().toISOString() })
    }
  }

  // Clear prod counter once we have a verdict (or forced one).
  run.stepProdCount = undefined

  // Check if agent signaled pass/fail (don't clear failReason yet — templates need it)
  const signalResult = run.stepResult ?? 'pass'
  const failReason = run.stepFailReason
  run.stepResult = undefined

  run.history.push({
    step: currentStepDef.id,
    result: signalResult === 'fail' ? 'failed' : 'completed',
    at: new Date().toISOString(),
    agent: agentName,
  })

  // Auto-commit any uncommitted work in the agent's worktree before killing
  if (agent?.worktreePath) {
    try {
      execSync('git add -A && git diff --cached --quiet || git commit -m "workflow: auto-commit step ' + currentStepDef.id + '"', {
        cwd: agent.worktreePath, encoding: 'utf-8', timeout: 10_000,
      })
    } catch {}

    // Auto-create PR if this is a worktree step and no PR exists yet for this branch
    if (agent.worktreeBranch && !run.vars._pr) {
      try {
        // Push the branch
        execSync(`git push -u origin ${agent.worktreeBranch}`, {
          cwd: agent.worktreePath, encoding: 'utf-8', timeout: 30_000,
        })
        // Check if PR already exists for this branch
        const existing = execSync(`gh pr view ${agent.worktreeBranch} --json url 2>/dev/null || echo ""`, {
          cwd: agent.worktreePath, encoding: 'utf-8', timeout: 15_000,
        }).trim()
        if (existing) {
          try {
            const pr = JSON.parse(existing)
            run.vars._pr = { url: pr.url, branch: agent.worktreeBranch }
          } catch {}
        } else {
          // Create PR
          const taskDesc = run.vars._input?.task ?? run.workflow
          const prUrl = execSync(
            `gh pr create --title "${taskDesc.slice(0, 70).replace(/"/g, '\\"')}" --body "Automated PR from flt workflow ${run.id}" --head ${agent.worktreeBranch}`,
            { cwd: agent.worktreePath, encoding: 'utf-8', timeout: 30_000 },
          ).trim()
          run.vars._pr = { url: prUrl, branch: agent.worktreeBranch }
        }
      } catch {}
    } else if (agent.worktreeBranch && run.vars._pr) {
      // PR exists, just push new commits
      try {
        execSync(`git push`, { cwd: agent.worktreePath, encoding: 'utf-8', timeout: 30_000 })
      } catch {}
    }
  }

  // Kill the completed agent but preserve its worktree (next step may need it)
  try {
    const { killDirect } = await import('../commands/kill')
    killDirect({ name: agentName, preserveWorktree: true, fromWorkflow: true })
  } catch {}

  // If agent signaled fail, follow on_fail path (or abort if none defined).
  // Without this guard the fail would silently fall through to on_complete and
  // the workflow would advance as if the step had passed — parent never notified.
  if (signalResult === 'fail') {
    const failStepId = currentStepDef.on_fail
    if (!failStepId || failStepId === 'abort') {
      run.status = 'failed'
      run.stepFailReason = failReason
      run.completedAt = new Date().toISOString()
      saveWorkflowRun(run)
      appendEvent({ type: 'workflow', detail: `failed ${run.id}: ${failReason ?? 'agent signaled fail'}`, at: run.completedAt })
      cleanupWorkflowWorktrees(run)
      await notifyWorkflowParent(run, `Workflow "${run.workflow}" failed at step "${currentStepDef.id}": ${failReason ?? 'agent signaled fail'}`)
      return
    }
    const failStep = def.steps.find(s => s.id === failStepId)
    if (failStep) {
      run.currentStep = failStepId
      saveWorkflowRun(run)
      appendEvent({ type: 'workflow', detail: `advanced ${run.id} step ${failStepId} (on_fail from ${currentStepDef.id})`, at: new Date().toISOString() })
      await executeStep(def, run, failStep)
      return
    }
    // on_fail points to an unknown step — treat as abort with a clear reason.
    run.status = 'failed'
    run.completedAt = new Date().toISOString()
    saveWorkflowRun(run)
    appendEvent({ type: 'workflow', detail: `failed ${run.id}: on_fail target "${failStepId}" not found`, at: run.completedAt })
    cleanupWorkflowWorktrees(run)
    await notifyWorkflowParent(run, `Workflow "${run.workflow}" failed at step "${currentStepDef.id}": on_fail target "${failStepId}" not found`)
    return
  }

  // Determine next step (pass path)
  const nextStepId = currentStepDef.on_complete
  if (!nextStepId || nextStepId === 'done') {
    run.status = 'completed'
    run.completedAt = new Date().toISOString()
    saveWorkflowRun(run)
    appendEvent({ type: 'workflow', detail: `completed ${run.id}`, at: run.completedAt })
    cleanupWorkflowWorktrees(run)
    const prUrl = run.vars._pr?.url
    const prMsg = prUrl ? ` PR: ${prUrl}` : ''
    await notifyWorkflowParent(run, `Workflow "${run.workflow}" completed.${prMsg}`)
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
  appendEvent({ type: 'workflow', detail: `advanced ${run.id} step ${nextStepId}`, at: new Date().toISOString() })

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
      killDirect({ name: agentName, fromWorkflow: true })
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
    killDirect({ name: agentName, fromWorkflow: true })
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
  // Escape shorthand vars for shell safety
  let result = template
    .replace(/\{task\}/g, shellEscapeArg(run.vars._input?.task ?? ''))
    .replace(/\{dir\}/g, shellEscapeArg(run.vars._input?.dir ?? ''))
    .replace(/\{pr\}/g, shellEscapeArg(run.vars._pr?.url ?? ''))
    .replace(/\{fail_reason\}/g, shellEscapeArg(run.stepFailReason ?? ''))
  // Escape step vars
  result = result.replace(/\{steps\.([^.]+)\.(\w+)\}/g, (match, stepId, field) => {
    const stepVars = run.vars[stepId]
    if (!stepVars) return match
    const value = stepVars[field]
    if (value === undefined) return match
    return shellEscapeArg(value)
  })
  return result
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
    workflow: run.workflow,
    workflowStep: step.id,
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
  // Shorthand template vars
  let result = template
    .replace(/\{task\}/g, run.vars._input?.task ?? '')
    .replace(/\{dir\}/g, run.vars._input?.dir ?? '')
    .replace(/\{pr\}/g, run.vars._pr?.url ?? '')
    .replace(/\{fail_reason\}/g, run.stepFailReason ?? '')
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

/** Signal pass/fail from inside a workflow agent */
export function signalWorkflowResult(result: 'pass' | 'fail', reason?: string): void {
  const runs = listWorkflowRuns().filter(r => r.status === 'running')
  // Find which run this agent belongs to by checking the caller's agent name
  const agentName = process.env.FLT_AGENT_NAME
  if (!agentName) {
    // Try tmux session env
    try {
      const { execFileSync } = require('child_process')
      const sessionName = execFileSync('tmux', ['display-message', '-p', '#{session_name}'], {
        encoding: 'utf-8', timeout: 2000,
      }).trim()
      if (sessionName.startsWith('flt-')) {
        const name = sessionName.slice(4)
        for (const run of runs) {
          const expected = workflowAgentName(run.id, run.currentStep)
          if (name === expected) {
            run.stepResult = result
            run.stepFailReason = reason
            saveWorkflowRun(run)
            return
          }
        }
      }
    } catch {}
    throw new Error('Not running inside a workflow agent')
  }

  for (const run of runs) {
    const expected = workflowAgentName(run.id, run.currentStep)
    if (agentName === expected) {
      run.stepResult = result
      run.stepFailReason = reason
      saveWorkflowRun(run)
      return
    }
  }
  throw new Error(`No running workflow found for agent "${agentName}"`)
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
