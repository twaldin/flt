import { AgentState } from '../state'

export type Mode = 'normal' | 'log-focus' | 'insert' | 'command' | 'inbox' | 'spawn-wizard' | 'kill-confirm'

export interface Notification {
  type: 'message' | 'status-change'
  agentName: string
  message?: string
}

export interface AgentView extends AgentState {
  name: string
  status: 'spawning' | 'ready' | 'running' | 'idle' | 'exited' | 'error' | 'rate-limited' | 'dialog' | 'unknown'
  lastSeen: number // timestamp
  notification?: Notification
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

export interface TuiState {
  mode: Mode
  agents: AgentView[]
  selectedIndex: number
  logContent: string
  logScrollOffset: number
  autoFollow: boolean
  searchQuery: string
  commandInput: string
  notifications: Notification[]
  inboxMessages: InboxMessage[]
  lastAgentsHash: string
  termHeight: number
  termWidth: number
  banner: Banner | null
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
  | { type: 'SET_TERM_SIZE'; height: number; width: number }
  | { type: 'SET_INBOX'; messages: InboxMessage[] }
  | { type: 'SET_BANNER'; banner: Banner | null }
