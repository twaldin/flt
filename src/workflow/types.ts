export interface WorkflowDef {
  name: string
  steps: WorkflowStepDef[]
}

export interface BaseStep {
  id: string
  on_complete?: string
  on_fail?: string
  max_retries?: number
}

export interface SpawnStep extends BaseStep {
  type?: 'spawn'
  preset?: string
  dir?: string
  task?: string
  worktree?: boolean
  run?: string
}

export interface ParallelStep extends BaseStep {
  type: 'parallel'
  n: number
  presets?: string[]
  step: SpawnStep
}

export interface ConditionStep extends BaseStep {
  type: 'condition'
  if: string
  then: string
  else?: string
}

export interface HumanGateStep extends BaseStep {
  type: 'human_gate'
  notify?: string
}

export interface MergeBestStep extends BaseStep {
  type: 'merge_best'
  candidate_var: string
  target_branch?: string
}

export interface CollectArtifactsStep extends BaseStep {
  type: 'collect_artifacts'
  from: string[]
  files: string[]
  into: string
}

export type WorkflowStepDef =
  | SpawnStep
  | ParallelStep
  | ConditionStep
  | HumanGateStep
  | MergeBestStep
  | CollectArtifactsStep

export interface WorkflowTreatment {
  roleHash: string
  skillHashes: Record<string, string>
  workflowHash: string
}

export type WorkflowVars = Record<string, string | WorkflowTreatment | undefined>

export interface WorkflowRun {
  id: string
  workflow: string
  currentStep: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  parentName: string
  stepResult?: 'pass' | 'fail'
  stepFailReason?: string
  stepProdCount?: number
  history: WorkflowStepResult[]
  retries: Record<string, number>
  vars: Record<string, WorkflowVars>
  startedAt: string
  completedAt?: string
  runDir?: string
  startBranch?: string
  parallelGroups?: Record<string, ParallelGroupState>
}

export interface WorkflowStepResult {
  step: string
  result: 'completed' | 'failed' | 'skipped'
  at: string
  agent?: string
}

export interface ParallelGroupState {
  candidates: ParallelCandidate[]
  treatmentMap: Record<string, string>
  allDone: boolean
}

export interface ParallelCandidate {
  label: string
  agentName: string
  preset: string
  treatment?: WorkflowTreatment
  branch?: string
  worktree?: string
  verdict?: 'pass' | 'fail'
  failReason?: string
}
