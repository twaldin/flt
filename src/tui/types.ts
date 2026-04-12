import type { AgentState } from '../state'

export type Mode = 'normal' | 'log-focus' | 'insert' | 'command' | 'inbox'

export interface AgentView extends AgentState {
  name: string
  status: 'spawning' | 'ready' | 'running' | 'idle' | 'exited' | 'error' | 'rate-limited' | 'unknown'
  lastSeen: number
}

export interface InboxMessage {
  timestamp: string
  from: string
  text: string
}

export interface Banner {
  text: string
  color: string
}

export interface AppState {
  mode: Mode
  agents: AgentView[]
  selectedIndex: number
  logContent: string
  logScrollOffset: number
  autoFollow: boolean
  searchQuery: string
  commandInput: string
  commandCursor: number
  inboxMessages: InboxMessage[]
  termHeight: number
  termWidth: number
  banner: Banner | null
}

export function createInitialState(width = 80, height = 24): AppState {
  return {
    mode: 'normal',
    agents: [],
    selectedIndex: 0,
    logContent: '',
    logScrollOffset: 0,
    autoFollow: true,
    searchQuery: '',
    commandInput: '',
    commandCursor: 0,
    inboxMessages: [],
    termHeight: height,
    termWidth: width,
    banner: null,
  }
}
