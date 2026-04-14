export interface WorkflowDef {
  name: string
  steps: WorkflowStepDef[]
}

export interface WorkflowStepDef {
  id: string
  preset: string
  dir?: string
  task: string
  on_complete?: string
  on_fail?: string
  max_retries?: number
  worktree?: boolean  // default true; set false for evaluator steps that review another step's worktree
  run?: string
}

export interface WorkflowRun {
  id: string
  workflow: string
  currentStep: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  parentName: string  // who started this workflow — notifications go here
  history: WorkflowStepResult[]
  retries: Record<string, number>
  vars: Record<string, Record<string, string>>  // per-step resolved vars: vars[stepId] = { worktree, dir, branch }
  startedAt: string
  completedAt?: string
}

export interface WorkflowStepResult {
  step: string
  result: 'completed' | 'failed' | 'skipped'
  at: string
  agent?: string
}
