export interface WorkflowDef {
  name: string
  auto_pr?: boolean
  steps: WorkflowStepDef[]
}

export interface BaseStep {
  id: string
  on_complete?: string
  on_fail?: string
  max_retries?: number
  auto_pr_step?: boolean
  timeout_seconds?: number
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

export interface DynamicDagStep extends BaseStep {
  type: 'dynamic_dag'
  plan_from: string
  reconciler?: { preset: string; task: string }
  max_nodes?: number
  max_depth?: number
  max_parallel_per_wave?: number
  node_max_retries?: number
  node_reviewer_preset?: string
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
  | DynamicDagStep
  | ConditionStep
  | HumanGateStep
  | MergeBestStep
  | CollectArtifactsStep

export interface WorkflowRun {
  id: string
  workflow: string
  currentStep: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  parentName: string
  stepResult?: 'pass' | 'fail'
  stepFailReason?: string
  stepFixesFromReview?: ReviewFix[]
  stepProdCount?: number
  dagProdCounts?: Record<string, number>
  history: WorkflowStepResult[]
  retries: Record<string, number>
  vars: Record<string, Record<string, string>>
  startedAt: string
  completedAt?: string
  runDir?: string
  startBranch?: string
  parallelGroups?: Record<string, ParallelGroupState>
  dynamicDagGroups?: Record<string, DynamicDagState>
}

export interface WorkflowStepResult {
  step: string
  result: 'completed' | 'failed' | 'skipped'
  at: string
  agent?: string
}

export interface Treatment {
  roleHash: string
  skillHashes: Record<string, string>
  workflowHash: string
}

export interface ParallelGroupState {
  candidates: ParallelCandidate[]
  treatmentMap: Record<string, string>
  allDone: boolean
  baseSha?: string
  startedAt?: string
}

export interface ReviewFix {
  file: string
  kind?: 'missing' | 'wrong' | 'test-gap' | 'regression' | 'style' | string
  what: string
  suggested?: string
}

export interface WorkflowResultPayload {
  verdict: 'pass' | 'fail'
  failReason?: string
  fixes?: ReviewFix[]
}

export interface ParallelCandidate {
  label: string
  agentName: string
  preset: string
  branch?: string
  worktree?: string
  verdict?: 'pass' | 'fail'
  failReason?: string
  treatment?: Treatment
}

export interface DagNodeState {
  id: string
  task: string
  dependsOn: string[]
  preset: string
  parallel: number
  baseBranch?: string
  branch?: string
  worktree?: string
  candidates?: ParallelCandidate[]
  retries: number
  status: 'pending' | 'running' | 'reviewing' | 'passed' | 'failed' | 'skipped'
  failReason?: string
  fixesFromReview?: ReviewFix[]
  reviewerAgent?: string
  reviewerWorktree?: string
  coderAgent?: string
  mergeAgent?: string
  mergeBranch?: string
  mergeWorktree?: string
  waitingOnMerge?: boolean
  awaitingCandidateDecision?: boolean
}

export interface DynamicDagState {
  nodes: Record<string, DagNodeState>
  topoOrder: string[]
  integrationBranch: string
  integrationWorktree: string
  skipped: string[]
  pendingGateNode?: string
  reconcilerAgent?: string
  reconcilerPending?: boolean
  baseSha?: string
  startedAt?: string
}
