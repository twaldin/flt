import type { AgentState } from '../state'
import type { GroupBy, Period } from '../metrics'
import type { WorkflowModalState } from './modal-workflows'
import type { GatesModalState } from './modal-gates'

export type { GroupBy, Period } from '../metrics'

export type Mode = 'normal' | 'log-focus' | 'insert' | 'command' | 'inbox' | 'presets' | 'kill-confirm' | 'shell' | 'workflows' | 'metrics' | 'gates'

export type ModalType = 'spawn' | 'kill' | 'presets'

export interface ModalField {
  label: string
  value: string
  cursor: number
  options?: string[]
  required: boolean
}

export interface ModalListItem {
  label: string
  detail: string
}

export interface ModalState {
  type: ModalType
  title: string
  fields: ModalField[]
  activeField: number
  listItems: ModalListItem[]
  selectedIndex: number
  error?: string
  rawCommand?: string
}

export interface AgentView extends AgentState {
  name: string
  status: 'spawning' | 'ready' | 'running' | 'idle' | 'exited' | 'error' | 'rate-limited' | 'unknown'
  lastSeen: number
  collapsedChildCount?: number  // set when agent is collapsed; value = number of hidden descendants
}

export interface InboxMessage {
  timestamp: string
  from: string
  text: string
}

export interface CompletionItem {
  value: string
  label?: string
  description?: string
}

export interface Banner {
  text: string
  color: string
}

export interface MetricsModalState {
  period: Period
  groupBy: GroupBy
  runsListFocused: boolean
  runsScrollOffset: number
}

export interface AppState {
  mode: Mode
  previousMode: Mode
  agents: AgentView[]
  selectedIndex: number
  logContent: string
  logScrollOffset: number
  autoFollow: boolean
  searchQuery: string
  commandInput: string
  commandCursor: number
  inboxMessages: InboxMessage[]
  inboxSelectedMsg: number
  termHeight: number
  termWidth: number
  banner: Banner | null
  notifications: Record<string, 'message' | 'status'>
  killConfirmAgent?: string
  sidebarScrollOffset: number
  collapsedAgents: string[]
  modal: ModalState | null
  workflowsModal: WorkflowModalState | null
  gatesModal: GatesModalState | null
  metrics: MetricsModalState | null
  completionItems: CompletionItem[]
  completionSelectedIndex: number
  sidebarWidth: number
  commandHistory: string[]
  commandHistoryIndex: number
}

export function createInitialState(width = 80, height = 24): AppState {
  return {
    mode: 'normal',
    previousMode: 'normal',
    agents: [],
    selectedIndex: 0,
    logContent: '',
    logScrollOffset: 0,
    autoFollow: true,
    searchQuery: '',
    commandInput: '',
    commandCursor: 0,
    inboxMessages: [],
    inboxSelectedMsg: 0,
    termHeight: height,
    termWidth: width,
    banner: null,
    notifications: {},
    killConfirmAgent: undefined,
    sidebarScrollOffset: 0,
    collapsedAgents: [],
    modal: null,
    workflowsModal: null,
    gatesModal: null,
    metrics: null,
    completionItems: [],
    completionSelectedIndex: 0,
    sidebarWidth: 30,
    commandHistory: [],
    commandHistoryIndex: -1,
  }
}
