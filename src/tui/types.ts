import { AgentState } from '../state'

export type Mode = 'normal' | 'log-focus' | 'command' | 'spawn-wizard' | 'kill-confirm'

export interface Notification {
  type: 'message' | 'status-change'
  agentName: string
  message?: string
}

export interface AgentView extends AgentState {
  name: string
  status: 'spawning' | 'ready' | 'running' | 'exited' | 'error'
  lastSeen: number // timestamp
  notification?: Notification
}

export interface TuiState {
  mode: Mode
  agents: AgentView[]
  selectedIndex: number
  logContent: string
  logScrollOffset: number
  searchQuery: string
  commandInput: string
  notifications: Notification[]
  lastAgentsHash: string
  termHeight: number
}

export type TuiAction =
  | { type: 'SET_MODE'; mode: Mode }
  | { type: 'SET_AGENTS'; agents: AgentView[] }
  | { type: 'SELECT_PREV' }
  | { type: 'SELECT_NEXT' }
  | { type: 'SET_LOG_CONTENT'; content: string }
  | { type: 'SCROLL_LOG_UP' }
  | { type: 'SCROLL_LOG_DOWN' }
  | { type: 'SCROLL_LOG_PAGE_UP' }
  | { type: 'SCROLL_LOG_PAGE_DOWN' }
  | { type: 'JUMP_LOG_TOP' }
  | { type: 'JUMP_LOG_BOTTOM' }
  | { type: 'SET_SEARCH_QUERY'; query: string }
  | { type: 'SET_COMMAND_INPUT'; input: string }
  | { type: 'ADD_NOTIFICATION'; notification: Notification }
  | { type: 'CLEAR_NOTIFICATION'; agentName: string }
  | { type: 'SET_TERM_HEIGHT'; height: number }
