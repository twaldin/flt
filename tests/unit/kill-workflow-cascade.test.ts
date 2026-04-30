import { describe, it, expect, mock, beforeAll } from 'bun:test'

mock.module('../../src/state', () => ({
  getAgent: mock(() => null),
  removeAgent: mock(() => {}),
  loadState: mock(() => ({})),
}))

mock.module('../../src/worktree', () => ({
  removeWorktree: mock(() => {}),
}))

mock.module('../../src/instructions', () => ({
  restoreInstructions: mock(() => {}),
}))

mock.module('../../src/skills', () => ({
  cleanupSkills: mock(() => {}),
}))

mock.module('../../src/adapters/registry', () => ({
  resolveAdapter: mock(() => ({})),
}))

mock.module('../../src/tmux', () => ({
  getPanePid: mock(() => null),
  killSession: mock(() => {}),
}))

mock.module('../../src/activity', () => ({
  appendEvent: mock(() => {}),
}))

mock.module('../../src/harness', () => ({
  harnessExtract: mock(() => null),
  archiveRun: mock(() => {}),
}))

mock.module('../../src/commands/init', () => ({
  appendInbox: mock(() => {}),
}))

let notifyEngineOfKill: typeof import('../../src/commands/kill').notifyEngineOfKill

beforeAll(async () => {
  const mod = await import('../../src/commands/kill')
  notifyEngineOfKill = mod.notifyEngineOfKill
})

describe('notifyEngineOfKill', () => {
  it('calls handleStepFailure when agent belongs to a workflow and kill is external', async () => {
    const getWorkflowForAgent = mock(() => 'run-1' as string | null)
    const handleStepFailure = mock(async (_id: string) => {})
    const cancelWorkflow = mock(async (_id: string) => {})

    await notifyEngineOfKill('worker', undefined, {
      getWorkflowForAgent,
      handleStepFailure,
      cancelWorkflow,
    })

    expect(getWorkflowForAgent).toHaveBeenCalledTimes(1)
    expect(getWorkflowForAgent).toHaveBeenCalledWith('worker')
    expect(handleStepFailure).toHaveBeenCalledTimes(1)
    expect(handleStepFailure).toHaveBeenCalledWith('run-1')
    expect(cancelWorkflow).toHaveBeenCalledTimes(0)
  })

  it('does nothing for engine-initiated kills', async () => {
    const getWorkflowForAgent = mock(() => 'run-1' as string | null)
    const handleStepFailure = mock(async (_id: string) => {})
    const cancelWorkflow = mock(async (_id: string) => {})

    await notifyEngineOfKill('worker', true, {
      getWorkflowForAgent,
      handleStepFailure,
      cancelWorkflow,
    })

    expect(getWorkflowForAgent).toHaveBeenCalledTimes(0)
    expect(handleStepFailure).toHaveBeenCalledTimes(0)
    expect(cancelWorkflow).toHaveBeenCalledTimes(0)
  })

  it('does nothing when agent is not in a workflow', async () => {
    const getWorkflowForAgent = mock(() => null as string | null)
    const handleStepFailure = mock(async (_id: string) => {})
    const cancelWorkflow = mock(async (_id: string) => {})

    await notifyEngineOfKill('worker', undefined, {
      getWorkflowForAgent,
      handleStepFailure,
      cancelWorkflow,
    })

    expect(getWorkflowForAgent).toHaveBeenCalledTimes(1)
    expect(getWorkflowForAgent).toHaveBeenCalledWith('worker')
    expect(handleStepFailure).toHaveBeenCalledTimes(0)
    expect(cancelWorkflow).toHaveBeenCalledTimes(0)
  })
})
