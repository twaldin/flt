import { startWorkflow, loadWorkflowRun, listWorkflowRuns, cancelWorkflow } from '../workflow/engine'
import { listWorkflowDefs } from '../workflow/parser'

export async function workflowRun(name: string, opts?: { parent?: string; task?: string; dir?: string }): Promise<void> {
  const run = await startWorkflow(name, opts)
  console.log(`Started workflow "${name}" (step: ${run.currentStep}, parent: ${run.parentName})`)
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
      const run = runs.find(r => r.workflow === name)
      const statusTag = run ? ` [${run.status}: ${run.currentStep}]` : ''
      console.log(`  ${name}${statusTag}`)
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

function printRun(run: ReturnType<typeof loadWorkflowRun>): void {
  if (!run) return
  console.log(`Workflow: ${run.workflow}`)
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
