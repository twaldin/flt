import { readFileSync, writeFileSync, mkdirSync, renameSync, openSync, closeSync, unlinkSync } from 'fs'
import { join } from 'path'
import type { AgentStatus } from './adapters/types'
import type { InstructionProjection } from './instructions'

export interface OrchestratorState {
  tmuxSession: string
  tmuxWindow: string
  type: 'human' | 'agent'
  initAt: string
}

export type Location =
  | { type: 'local' }
  | { type: 'ssh'; host: string }
  | { type: 'sandbox'; runtime: 'docker' | 'apple' | 'podman'; container: string }
  | { type: 'ssh+sandbox'; host: string; runtime: 'docker' | 'apple' | 'podman'; container: string }

export interface AgentState {
  cli: string
  model: string
  tmuxSession: string
  parentName: string
  dir: string
  instructionProjection?: InstructionProjection
  worktreePath?: string
  worktreeBranch?: string
  /** Project root: the base repo dir this agent was spawned to work on (resolves
   * to e.g. ~/flt regardless of whether the agent runs in its own worktree, in
   * a sibling step's worktree, or directly in the repo). Used by sidebar to
   * show `wt:~/flt` instead of the worktree path. */
  projectRoot?: string
  workflow?: string
  spawnedAt: string
  status?: AgentStatus
  statusAt?: string
  persistent?: boolean
  /** Auto-kill on first idle transition. Used by ask-oracle: oracle answers
   * once and then dies, so it can't accumulate as a zombie idle agent. */
  ephemeral?: boolean
  location?: Location
}

export interface FleetState {
  orchestrator?: OrchestratorState
  agents: Record<string, AgentState>
  config: {
    maxDepth: number
  }
}

function home(): string {
  return process.env.HOME || require('os').homedir()
}

export function getStatePath(): string {
  return join(home(), '.flt', 'state.json')
}

export function getStateDir(): string {
  return join(home(), '.flt')
}

function withStateLock<T>(fn: () => T): T {
  mkdirSync(getStateDir(), { recursive: true })
  const lockPath = getStatePath() + '.lock'
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    try {
      const fd = openSync(lockPath, 'wx')
      closeSync(fd)
      try {
        return fn()
      } finally {
        try { unlinkSync(lockPath) } catch {}
      }
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      Bun.sleepSync(10)
    }
  }
  throw new Error('State lock timeout after 5s')
}

function defaultState(): FleetState {
  return {
    agents: {},
    config: { maxDepth: 3 },
  }
}

export function loadState(): FleetState {
  try {
    const raw = readFileSync(getStatePath(), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return defaultState()
  }
}

export function saveState(state: FleetState): void {
  mkdirSync(getStateDir(), { recursive: true })
  const path = getStatePath()
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n')
  renameSync(tmp, path)
}

export function getAgent(name: string): AgentState | undefined {
  return loadState().agents[name]
}

export function setAgent(name: string, agent: AgentState): void {
  withStateLock(() => {
    const state = loadState()
    state.agents[name] = agent
    saveState(state)
  })
}

export function removeAgent(name: string): void {
  withStateLock(() => {
    const state = loadState()
    delete state.agents[name]
    saveState(state)
  })
}

export function hasAgent(name: string): boolean {
  return name in loadState().agents
}

export function setOrchestrator(orch: OrchestratorState): void {
  withStateLock(() => {
    const state = loadState()
    state.orchestrator = orch
    saveState(state)
  })
}

export function getOrchestrator(): OrchestratorState | undefined {
  return loadState().orchestrator
}

export function allAgents(): Record<string, AgentState> {
  return loadState().agents
}

export function getLocation(agent: AgentState): Location {
  return agent.location ?? { type: 'local' }
}
