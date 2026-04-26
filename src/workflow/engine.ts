import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync, copyFileSync, unlinkSync } from 'fs'
import { basename, join } from 'path'
import { execSync } from 'child_process'
import { loadWorkflowDef } from './parser'
import { getAgent, allAgents } from '../state'
import type { CollectArtifactsStep, ConditionStep, HumanGateStep, MergeBestStep, ParallelStep, SpawnStep, WorkflowDef, WorkflowRun, WorkflowStepDef } from './types'
import { appendEvent } from '../activity'
import * as tmux from '../tmux'
import { sendDirect } from '../commands/send'
import type { CallerContext } from '../detect'
import { aggregateResults, writeResult } from './results'
import { evaluateCondition } from './condition'
import { buildWorkflowTreatment, permuteTreatmentMap } from './treatment'

let _spawnFn: typeof import('../commands/spawn').spawnDirect | null = null

export function _setSpawnFnForTest(fn: typeof import('../commands/spawn').spawnDirect | null): void {
  _spawnFn = fn
}

async function getSpawnFn() {
  if (_spawnFn) return _spawnFn
  return (await import('../commands/spawn')).spawnDirect
}

function getRunsDir(): string {
  return join(process.env.HOME ?? require('os').homedir(), '.flt', 'runs')
}

function getRunPath(runId: string): string {
  return join(getRunsDir(), runId, 'run.json')
}

/** Slug a free-form task string into a short, filesystem-safe identifier. */
export function slugFromTask(task: string, maxWords = 4): string {
  const words = task
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOPWORDS.has(w))
    .slice(0, maxWords)
  return words.join('-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'into', 'from', 'this', 'that', 'these', 'those',
  'flt', 'task', 'track', 'idea', 'pr', 'run', 'use', 'get', 'set', 'add', 'new',
])

function generateRunId(workflowName: string, slug?: string): string {
  const allRuns = listWorkflowRuns().filter(r => r.workflow === workflowName)
  const existingIds = new Set(allRuns.map(r => r.id))
  // Base id: workflow name + optional slug (e.g. "idea-to-pr-modal-tui")
  const base = slug ? `${workflowName}-${slug}` : workflowName
  // Always increment if collision — never reuse a run ID (protects worktree branches)
  let n = 1
  while (existingIds.has(n === 1 ? base : `${base}-${n}`)) n++
  return n === 1 ? base : `${base}-${n}`
}

export function loadWorkflowRun(runId: string): WorkflowRun | null {
  const path = getRunPath(runId)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as WorkflowRun
    if (!parsed.runDir) {
      throw new Error(`workflow run "${runId}" was created before the workflow primitives upgrade; cancel it via flt workflow cancel ${runId} and rerun`)
    }
    return parsed
  } catch (e) {
    if (e instanceof Error && e.message.includes('workflow primitives upgrade')) {
      throw e
    }
    return null
  }
}

export function saveWorkflowRun(run: WorkflowRun): void {
  const path = getRunPath(run.id)
  mkdirSync(join(getRunsDir(), run.id), { recursive: true })
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(run, null, 2) + '\n')
  renameSync(tmp, path)
}

export function listWorkflowRuns(): WorkflowRun[] {
  const dir = getRunsDir()
  if (!existsSync(dir)) return []

  const runs: WorkflowRun[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const runPath = join(dir, entry.name, 'run.json')
    if (!existsSync(runPath)) continue
    try {
      const parsed = JSON.parse(readFileSync(runPath, 'utf-8')) as WorkflowRun
      if (!parsed.runDir) continue
      runs.push(parsed)
    } catch {}
  }
  return runs
}

export async function startWorkflow(name: string, opts?: { parent?: string; task?: string; dir?: string; slug?: string }): Promise<WorkflowRun> {
  const def = loadWorkflowDef(name)

  // Derive parent from caller if not provided
  const callerName = opts?.parent ?? process.env.FLT_AGENT_NAME
  const resolvedParent = (callerName && callerName !== 'cron') ? callerName : 'human'

  // Run-id slug: explicit --slug wins; else derive from --task; else none.
  const effectiveSlug = opts?.slug ?? (opts?.task ? slugFromTask(opts.task) : undefined) ?? undefined
  const runId = generateRunId(name, effectiveSlug || undefined)
  const runDir = join(getRunsDir(), runId)

  let startBranch = ''
  try {
    startBranch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: opts?.dir ?? process.cwd(),
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim()
  } catch {
    startBranch = ''
  }

  const run: WorkflowRun = {
    id: runId,
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
    runDir,
    startBranch,
  }

  mkdirSync(run.runDir, { recursive: true })
  mkdirSync(join(run.runDir, 'results'), { recursive: true })
  mkdirSync(join(run.runDir, 'handoffs'), { recursive: true })

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
      ...(run.vars[currentStepDef.id] ?? {}),
      worktree: agent.worktreePath ?? agent.dir,
      dir: agent.dir,
      branch: agent.worktreeBranch ?? '',
    }
  }

  const expectedN = run.parallelGroups?.[run.currentStep]
    ? run.parallelGroups[run.currentStep].candidates.length
    : 1
  if (!run.runDir) {
    throw new Error(`workflow run "${run.id}" is missing runDir`)
  }

  if (currentStepDef.type === 'human_gate') {
    const decisionPath = join(run.runDir, '.gate-decision')
    if (!existsSync(decisionPath)) return
    let decision: { approved?: boolean, candidate?: string, reason?: string } | null = null
    try {
      decision = JSON.parse(readFileSync(decisionPath, 'utf-8')) as { approved?: boolean, candidate?: string, reason?: string }
    } catch {}
    if (!decision) return

    if (decision.approved) {
      writeResult(run.runDir, currentStepDef.id, '_', 'pass')
    } else {
      writeResult(run.runDir, currentStepDef.id, '_', 'fail', decision.reason ?? 'rejected')
    }

    try { unlinkSync(decisionPath) } catch {}
    try { unlinkSync(join(run.runDir, '.gate-pending')) } catch {}
  }

  let aggregated = aggregateResults(run.runDir, run.currentStep, expectedN)
  if (!aggregated.allDone) {
    const verdictCount = aggregated.passers.length + aggregated.failures.length
    if (verdictCount === 0) {
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
        const forcedFailReason = `agent went idle ${prods + 1} times without emitting PASS or FAIL via flt workflow`
        writeResult(run.runDir, run.currentStep, '_', 'fail', forcedFailReason)
        appendEvent({ type: 'workflow', detail: `forced-fail ${run.id}/${currentStepDef.id}: ${forcedFailReason}`, at: new Date().toISOString() })
        aggregated = aggregateResults(run.runDir, run.currentStep, expectedN)
      } else {
        return
      }
    } else {
      return
    }
  }

  if (!aggregated.allDone) return

  run.stepProdCount = undefined

  const isParallelStep = Boolean(run.parallelGroups?.[run.currentStep])
  const signalResult: 'pass' | 'fail' = isParallelStep
    ? (aggregated.passers.length >= 1 ? 'pass' : 'fail')
    : (aggregated.failures.length >= 1 ? 'fail' : 'pass')
  const failReason = signalResult === 'fail'
    ? (isParallelStep
      ? aggregated.failures.map(f => `${f.label}:${f.reason ?? ''}`).join(' ; ')
      : aggregated.failures[0]?.reason)
    : undefined

  run.vars[currentStepDef.id] = {
    ...(run.vars[currentStepDef.id] ?? {}),
    verdict: signalResult,
    failReason: failReason ?? '',
  }
  saveWorkflowRun(run)

  run.history.push({
    step: currentStepDef.id,
    result: signalResult === 'fail' ? 'failed' : 'completed',
    at: new Date().toISOString(),
    agent: agentName,
  })

  const group = run.parallelGroups?.[run.currentStep]
  if (group) {
    for (const candidate of group.candidates) {
      const candidateAgent = getAgent(candidate.agentName)
      applyAutoCommit(candidateAgent, run, currentStepDef.id, true)
      try {
        const { killDirect } = await import('../commands/kill')
        killDirect({ name: candidate.agentName, preserveWorktree: true, fromWorkflow: true })
      } catch {}
    }
  } else {
    applyAutoCommit(agent, run, currentStepDef.id)

    // Kill the completed agent but preserve its worktree (next step may need it)
    try {
      const { killDirect } = await import('../commands/kill')
      killDirect({ name: agentName, preserveWorktree: true, fromWorkflow: true })
    } catch {}
  }

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
    // Self-loop on_fail (step retries itself) — honor max_retries.
    // Without this, an agent-signaled fail would respawn the same step forever.
    if (failStepId === currentStepDef.id) {
      const maxRetries = currentStepDef.max_retries ?? 0
      const retryCount = run.retries[currentStepDef.id] ?? 0
      if (retryCount >= maxRetries) {
        run.status = 'failed'
        run.stepFailReason = failReason
        run.completedAt = new Date().toISOString()
        saveWorkflowRun(run)
        appendEvent({ type: 'workflow', detail: `failed ${run.id}: ${currentStepDef.id} exhausted retries (${maxRetries}) — ${failReason ?? 'agent signaled fail'}`, at: run.completedAt })
        cleanupWorkflowWorktrees(run)
        await notifyWorkflowParent(run, `Workflow "${run.workflow}" failed at step "${currentStepDef.id}" after ${maxRetries} retries: ${failReason ?? 'agent signaled fail'}`)
        return
      }
      run.retries[currentStepDef.id] = retryCount + 1
      run.stepFailReason = failReason  // made available to next spawn via {fail_reason} template var
      saveWorkflowRun(run)
      appendEvent({ type: 'workflow', detail: `retry ${run.id} step ${currentStepDef.id} (${retryCount + 1}/${maxRetries})`, at: new Date().toISOString() })
      await executeStep(def, run, currentStepDef)
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

  if (run.runDir) {
    const expectedN = run.parallelGroups?.[run.currentStep]
      ? run.parallelGroups[run.currentStep].candidates.length
      : 1
    const aggregated = aggregateResults(run.runDir, run.currentStep, expectedN)
    if (aggregated.allDone) {
      const isParallelStep = Boolean(run.parallelGroups?.[run.currentStep])
      const collapsed = isParallelStep
        ? (aggregated.passers.length >= 1 ? 'pass' : 'fail')
        : (aggregated.failures.length >= 1 ? 'fail' : 'pass')
      if (collapsed === 'pass') {
        await advanceWorkflow(runId)
        return
      }
    }
  }

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

function applyAutoCommit(
  agent: ReturnType<typeof getAgent> | undefined,
  run: WorkflowRun,
  stepId: string,
  commitOnly = false,
): void {
  if (!agent?.worktreePath) return

  try {
    execSync('git add -A && git diff --cached --quiet || git commit -m "workflow: auto-commit step ' + stepId + '"', {
      cwd: agent.worktreePath, encoding: 'utf-8', timeout: 10_000,
    })
  } catch {}

  if (commitOnly) return

  if (agent.worktreeBranch && !run.vars._pr) {
    try {
      execSync(`git push -u origin ${agent.worktreeBranch}`, {
        cwd: agent.worktreePath, encoding: 'utf-8', timeout: 30_000,
      })
      const existing = execSync(`gh pr view ${agent.worktreeBranch} --json url 2>/dev/null || echo ""`, {
        cwd: agent.worktreePath, encoding: 'utf-8', timeout: 15_000,
      }).trim()
      if (existing) {
        try {
          const pr = JSON.parse(existing)
          run.vars._pr = { url: pr.url, branch: agent.worktreeBranch }
        } catch {}
      } else {
        const taskDesc = run.vars._input?.task ?? run.workflow
        const prUrl = execSync(
          `gh pr create --title "${taskDesc.slice(0, 70).replace(/"/g, '\\"')}" --body "Automated PR from flt workflow ${run.id}" --head ${agent.worktreeBranch}`,
          { cwd: agent.worktreePath, encoding: 'utf-8', timeout: 30_000 },
        ).trim()
        run.vars._pr = { url: prUrl, branch: agent.worktreeBranch }
      }
    } catch {}
  } else if (agent.worktreeBranch && run.vars._pr) {
    try {
      execSync('git push', { cwd: agent.worktreePath, encoding: 'utf-8', timeout: 30_000 })
    } catch {}
  }
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
    if (typeof value !== 'string') return match
    return shellEscapeArg(value)
  })
  return result
}

function isSpawnStep(step: WorkflowStepDef): step is SpawnStep {
  return step.type === undefined || step.type === 'spawn'
}

function hashRunStepSeed(runId: string, stepId: string): number {
  let h = 2166136261
  for (const c of `${runId}:${stepId}`) {
    h ^= c.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

async function executeParallelStep(def: WorkflowDef, run: WorkflowRun, parallelStep: ParallelStep): Promise<void> {
  const basePreset = parallelStep.step.preset
  if (!parallelStep.presets && !basePreset) {
    throw new Error(`Step "${parallelStep.id}": parallel step requires step.preset when presets is not set`)
  }

  const presets = parallelStep.presets ?? Array(parallelStep.n).fill(basePreset!)
  const treatmentMap = permuteTreatmentMap(parallelStep.n, presets, hashRunStepSeed(run.id, parallelStep.id))
  const baseName = workflowAgentName(run.id, parallelStep.id)
  const candidates = Array.from({ length: parallelStep.n }, (_, i) => {
    const label = String.fromCharCode(97 + i)
    return {
      label,
      preset: treatmentMap[label],
      treatment: buildWorkflowTreatment(run.workflow, treatmentMap[label]),
      agentName: `${baseName}-${label}`,
    }
  })

  run.parallelGroups = run.parallelGroups ?? {}
  run.parallelGroups[parallelStep.id] = {
    candidates,
    treatmentMap,
    allDone: false,
  }
  saveWorkflowRun(run)

  if (!run.runDir) {
    throw new Error(`workflow run "${run.id}" is missing runDir`)
  }

  const spawn = await getSpawnFn()
  for (const candidate of candidates) {
    await spawn({
      name: candidate.agentName,
      preset: candidate.preset,
      dir: parallelStep.step.dir
        ? resolveTemplate(parallelStep.step.dir, run)
        : (run.vars._input?.dir || undefined),
      worktree: parallelStep.step.worktree !== false,
      parent: run.parentName,
      bootstrap: resolveTemplate(parallelStep.step.task ?? '', run),
      workflow: run.workflow,
      workflowStep: parallelStep.id,
      extraEnv: {
        FLT_RUN_DIR: run.runDir,
        FLT_RUN_LABEL: candidate.label,
      },
    })

    const agent = getAgent(candidate.agentName)
    if (agent) {
      candidate.branch = agent.worktreeBranch ?? ''
      candidate.worktree = agent.worktreePath ?? agent.dir
      saveWorkflowRun(run)
    }
  }
}

function readJsonFile(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function execStderr(error: unknown): string {
  if (!(error instanceof Error)) return ''
  const withStderr = error as Error & { stderr?: Buffer | string }
  if (typeof withStderr.stderr === 'string') return withStderr.stderr.trim()
  if (withStderr.stderr instanceof Buffer) return withStderr.stderr.toString('utf-8').trim()
  return error.message
}

export function executeMergeBestStep(_def: WorkflowDef, run: WorkflowRun, step: MergeBestStep): void {
  if (!run.runDir) {
    throw new Error(`workflow run "${run.id}" is missing runDir`)
  }

  const winnerPath = join(run.runDir, 'winner.json')
  const gatePath = join(run.runDir, '.gate-decision')
  const winnerJson = readJsonFile(winnerPath)
  const gateJson = readJsonFile(gatePath)

  let winnerLabel: string | null = null
  if (typeof winnerJson?.winner === 'string' && winnerJson.winner) {
    winnerLabel = winnerJson.winner
  } else if (gateJson?.approved === true && typeof gateJson.candidate === 'string' && gateJson.candidate) {
    winnerLabel = gateJson.candidate
  }

  if (!winnerLabel) {
    writeResult(run.runDir, step.id, '_', 'fail', 'merge_best: no winner.json or .gate-decision found')
    return
  }

  const group = run.parallelGroups?.[step.candidate_var]
  if (!group) {
    writeResult(run.runDir, step.id, '_', 'fail', `merge_best: candidate_var "${step.candidate_var}" not a recognized parallel group`)
    return
  }

  const candidate = group.candidates.find(c => c.label === winnerLabel)
  if (!candidate) {
    writeResult(run.runDir, step.id, '_', 'fail', `merge_best: candidate label "${winnerLabel}" not found in group`)
    return
  }
  if (!candidate.branch) {
    writeResult(run.runDir, step.id, '_', 'fail', `merge_best: candidate label "${winnerLabel}" is missing branch`)
    return
  }

  const targetBranch = step.target_branch ?? run.startBranch
  if (!targetBranch) {
    throw new Error(`merge_best: target branch is not set (step.target_branch or run.startBranch)`)
  }

  const cwd = run.vars._input?.dir || process.cwd()
  try {
    execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5_000,
    })
  } catch {
    writeResult(run.runDir, step.id, '_', 'fail', 'merge_best: workflow dir is not a git repo')
    return
  }

  try {
    execSync(`git checkout ${targetBranch}`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15_000,
    })
  } catch (error) {
    const stderr = execStderr(error)
    writeResult(run.runDir, step.id, '_', 'fail', `merge_best: failed to checkout target branch: ${stderr || 'unknown error'}`)
    return
  }

  try {
    execSync(`git fetch origin ${candidate.branch} || true`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    })
  } catch {}

  try {
    execSync(`git merge --no-ff ${candidate.branch} -m "workflow ${run.id}: merge winner ${candidate.label}"`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    })
  } catch (error) {
    const stderr = execStderr(error)
    const firstLine = stderr.split('\n').find(Boolean) ?? 'merge failed'
    writeResult(run.runDir, step.id, '_', 'fail', `merge_best: conflict — ${firstLine}`)
    run.vars._merge = {
      winner: winnerLabel,
      branch: candidate.branch,
      conflict: 'true',
    }
    saveWorkflowRun(run)
    return
  }

  writeResult(run.runDir, step.id, '_', 'pass')
  run.vars._merge = {
    winner: winnerLabel,
    branch: candidate.branch,
    conflict: 'false',
  }
  saveWorkflowRun(run)
}

export function executeCollectArtifactsStep(_def: WorkflowDef, run: WorkflowRun, step: CollectArtifactsStep): void {
  if (!run.runDir) {
    throw new Error(`workflow run "${run.id}" is missing runDir`)
  }

  const intoDir = join(run.runDir, step.into)
  mkdirSync(intoDir, { recursive: true })

  for (const fromId of step.from) {
    const group = run.parallelGroups?.[fromId]
    if (group) {
      for (const candidate of group.candidates) {
        if (!candidate.worktree) continue
        for (const fileName of step.files) {
          const src = join(candidate.worktree, fileName)
          if (!existsSync(src)) continue
          const dest = join(intoDir, `${fromId}-${candidate.label}-${basename(fileName)}`)
          copyFileSync(src, dest)
        }
      }
      continue
    }

    const fromVars = run.vars[fromId]
    if (!fromVars) continue
    const sourceDir = typeof fromVars.worktree === 'string'
      ? fromVars.worktree
      : (typeof fromVars.dir === 'string' ? fromVars.dir : '')
    if (!sourceDir) continue
    for (const fileName of step.files) {
      const src = join(sourceDir, fileName)
      if (!existsSync(src)) continue
      const dest = join(intoDir, `${fromId}-_-${basename(fileName)}`)
      copyFileSync(src, dest)
    }
  }

  writeResult(run.runDir, step.id, '_', 'pass')
}

async function executeConditionStep(def: WorkflowDef, run: WorkflowRun, step: ConditionStep): Promise<void> {
  if (!run.runDir) {
    throw new Error(`workflow run "${run.id}" is missing runDir`)
  }

  const condVars = {
    steps: run.vars,
    fail_reason: run.stepFailReason ?? '',
    task: run.vars._input?.task ?? '',
    dir: run.vars._input?.dir ?? '',
    pr: run.vars._pr?.url ?? '',
  }

  let result: boolean
  try {
    result = evaluateCondition(step.if, condVars)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeResult(run.runDir, step.id, '_', 'fail', `condition: ${message}`)
    await advanceWorkflow(run.id)
    return
  }

  const target = result === true ? step.then : (step.else ?? step.on_complete ?? 'done')
  writeResult(run.runDir, step.id, '_', 'pass')
  run.history.push({
    step: step.id,
    result: 'completed',
    at: new Date().toISOString(),
  })
  run.vars[step.id] = {
    ...(run.vars[step.id] ?? {}),
    verdict: 'pass',
    failReason: '',
  }

  if (target === 'done') {
    run.status = 'completed'
    run.completedAt = new Date().toISOString()
    saveWorkflowRun(run)
    return
  }

  run.currentStep = target
  saveWorkflowRun(run)

  if (target === step.id) {
    return
  }

  const nextStep = def.steps.find(s => s.id === target)
  if (!nextStep) {
    run.status = 'failed'
    run.completedAt = new Date().toISOString()
    saveWorkflowRun(run)
    return
  }

  await executeStep(def, run, nextStep)
}

async function executeHumanGateStep(_def: WorkflowDef, run: WorkflowRun, step: HumanGateStep): Promise<void> {
  if (!run.runDir) {
    throw new Error(`workflow run "${run.id}" is missing runDir`)
  }

  // Resolve {task}, {steps.X.Y}, {pr}, {fail_reason} in the notify text — same
  // template substitution coder/reviewer/verifier task strings get.
  const resolvedNotify = step.notify ? resolveTemplate(step.notify, run) : ''

  const pendingPath = join(run.runDir, '.gate-pending')
  const tmpPath = `${pendingPath}.tmp`
  writeFileSync(tmpPath, JSON.stringify({
    step: step.id,
    notify: resolvedNotify,
    at: new Date().toISOString(),
  }) + '\n')
  renameSync(tmpPath, pendingPath)

  const notifySuffix = resolvedNotify ? `: ${resolvedNotify}` : ''
  await notifyWorkflowParent(run, `Workflow ${run.workflow} paused at human_gate "${step.id}"${notifySuffix}`)
}

async function executeStep(def: WorkflowDef, run: WorkflowRun, step: WorkflowStepDef): Promise<void> {
  if (step.type === 'parallel') {
    await executeParallelStep(def, run, step)
    return
  }
  if (step.type === 'merge_best') {
    executeMergeBestStep(def, run, step)
    return
  }
  if (step.type === 'collect_artifacts') {
    executeCollectArtifactsStep(def, run, step)
    return
  }
  if (step.type === 'condition') {
    return executeConditionStep(def, run, step)
  }
  if (step.type === 'human_gate') {
    return executeHumanGateStep(def, run, step)
  }
  if (!isSpawnStep(step)) {
    return
  }

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
  if (!step.preset || !step.task) {
    throw new Error(`Step "${step.id}": spawn step requires preset and task when run is not set`)
  }

  const agentName = workflowAgentName(run.id, step.id)
  const task = resolveTemplate(step.task, run)
  const dir = step.dir
    ? resolveTemplate(step.dir, run)
    : (run.vars._input?.dir || undefined)

  const spawn = await getSpawnFn()
  await spawn({
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
      treatment: buildWorkflowTreatment(run.workflow, step.preset),
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
    const value = stepVars[field]
    return typeof value === 'string' ? value : match
  })
  return result
}

export function workflowAgentName(runId: string, stepId: string): string {
  return `${runId}-${stepId}`
}

function cleanupWorkflowWorktrees(run: WorkflowRun): void {
  for (const [stepId, vars] of Object.entries(run.vars)) {
    const wtPath = typeof vars.worktree === 'string' ? vars.worktree : ''
    const branch = typeof vars.branch === 'string' ? vars.branch : ''
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
  const caller = process.env.FLT_AGENT_NAME ?? resolveAgentNameFromTmux()
  if (!caller) {
    throw new Error('Not running inside a workflow agent')
  }

  for (const run of runs) {
    const expected = workflowAgentName(run.id, run.currentStep)
    const group = run.parallelGroups?.[run.currentStep]
    const candidate = group?.candidates.find(c => c.agentName === caller)
    if (caller !== expected && !candidate) continue
    if (!run.runDir) {
      throw new Error(`workflow run "${run.id}" is missing runDir`)
    }
    const label = candidate?.label ?? '_'
    writeResult(run.runDir, run.currentStep, label, result, reason)
    return
  }

  throw new Error(`No running workflow found for agent "${caller}"`)
}

// Map agent names to workflow run IDs for the controller poller
export function getWorkflowForAgent(agentName: string): string | null {
  const runs = listWorkflowRuns().filter(r => r.status === 'running')
  for (const run of runs) {
    const expectedAgent = workflowAgentName(run.id, run.currentStep)
    if (agentName === expectedAgent) return run.id
    const candidate = run.parallelGroups?.[run.currentStep]?.candidates.find(c => c.agentName === agentName)
    if (candidate) return run.id
  }
  return null
}

function resolveAgentNameFromTmux(): string | null {
  try {
    const { execFileSync } = require('child_process')
    const sessionName = execFileSync('tmux', ['display-message', '-p', '#{session_name}'], {
      encoding: 'utf-8', timeout: 2000,
    }).trim()
    if (sessionName.startsWith('flt-')) {
      return sessionName.slice(4)
    }
  } catch {}
  return null
}
