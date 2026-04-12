import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface OrchestratorState {
  tmuxSession: string
  tmuxWindow: string
  type: 'human' | 'agent'
  initAt: string
}

export interface AgentState {
  cli: string
  model: string
  tmuxSession: string
  parentName: string
  dir: string
  worktreePath?: string
  worktreeBranch?: string
  spawnedAt: string
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
  writeFileSync(getStatePath(), JSON.stringify(state, null, 2) + '\n')
}

export function getAgent(name: string): AgentState | undefined {
  return loadState().agents[name]
}

export function setAgent(name: string, agent: AgentState): void {
  const state = loadState()
  state.agents[name] = agent
  saveState(state)
}

export function removeAgent(name: string): void {
  const state = loadState()
  delete state.agents[name]
  saveState(state)
}

export function hasAgent(name: string): boolean {
  return name in loadState().agents
}

export function setOrchestrator(orch: OrchestratorState): void {
  const state = loadState()
  state.orchestrator = orch
  saveState(state)
}

export function getOrchestrator(): OrchestratorState | undefined {
  return loadState().orchestrator
}

export function allAgents(): Record<string, AgentState> {
  return loadState().agents
}
