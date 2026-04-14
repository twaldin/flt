import { allAgents } from '../state'
import { killDirect } from './kill'
import { stopController } from './controller'
import { listWorkflowRuns, cancelWorkflow } from '../workflow/engine'

export async function exit(): Promise<void> {
  // 1. Cancel all running workflows
  const runs = listWorkflowRuns().filter(r => r.status === 'running')
  for (const run of runs) {
    try {
      await cancelWorkflow(run.id)
      console.log(`Cancelled workflow: ${run.id}`)
    } catch {}
  }

  // 2. Kill all agents
  const agents = allAgents()
  for (const name of Object.keys(agents)) {
    try {
      killDirect({ name })
      console.log(`Killed: ${name}`)
    } catch {}
  }

  // 3. Stop controller
  try {
    stopController()
  } catch {}

  console.log('Fleet shut down.')
}
