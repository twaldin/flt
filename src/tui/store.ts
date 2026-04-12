import { useReducer } from 'react'
import { TuiState, TuiAction, Mode } from './types'

const initialState: TuiState = {
  mode: 'normal',
  agents: [],
  selectedIndex: 0,
  logContent: '',
  logScrollOffset: 0,
  searchQuery: '',
  commandInput: '',
  notifications: [],
  lastAgentsHash: '',
  termHeight: 24,
}

function tuiReducer(state: TuiState, action: TuiAction): TuiState {
  switch (action.type) {
    case 'SET_MODE':
      return { ...state, mode: action.mode }

    case 'SET_AGENTS':
      return {
        ...state,
        agents: action.agents,
        selectedIndex: Math.min(state.selectedIndex, Math.max(0, action.agents.length - 1)),
      }

    case 'SELECT_PREV':
      return {
        ...state,
        selectedIndex: Math.max(0, state.selectedIndex - 1),
      }

    case 'SELECT_NEXT':
      return {
        ...state,
        selectedIndex: Math.min(state.agents.length - 1, state.selectedIndex + 1),
      }

    case 'SET_LOG_CONTENT':
      return { ...state, logContent: action.content, logScrollOffset: 0 }

    case 'SCROLL_LOG_UP':
      return { ...state, logScrollOffset: Math.max(0, state.logScrollOffset - 1) }

    case 'SCROLL_LOG_DOWN': {
      const lines = state.logContent.split('\n').length
      const viewH = Math.max(4, state.termHeight - 5)
      return { ...state, logScrollOffset: Math.min(Math.max(0, lines - viewH), state.logScrollOffset + 1) }
    }

    case 'SCROLL_LOG_PAGE_UP': {
      const pageSize = Math.max(1, Math.floor((state.termHeight - 5) / 2))
      return { ...state, logScrollOffset: Math.max(0, state.logScrollOffset - pageSize) }
    }

    case 'SCROLL_LOG_PAGE_DOWN': {
      const lines = state.logContent.split('\n').length
      const viewH = Math.max(4, state.termHeight - 5)
      const pageSize = Math.max(1, Math.floor(viewH / 2))
      return { ...state, logScrollOffset: Math.min(Math.max(0, lines - viewH), state.logScrollOffset + pageSize) }
    }

    case 'JUMP_LOG_TOP':
      return { ...state, logScrollOffset: 0 }

    case 'JUMP_LOG_BOTTOM': {
      const lines = state.logContent.split('\n').length
      const viewH = Math.max(4, state.termHeight - 5)
      return { ...state, logScrollOffset: Math.max(0, lines - viewH) }
    }

    case 'SET_TERM_HEIGHT':
      return { ...state, termHeight: action.height }

    case 'SET_SEARCH_QUERY':
      return { ...state, searchQuery: action.query }

    case 'SET_COMMAND_INPUT':
      return { ...state, commandInput: action.input }

    case 'ADD_NOTIFICATION':
      return {
        ...state,
        notifications: [...state.notifications.filter(n => n.agentName !== action.notification.agentName), action.notification],
      }

    case 'CLEAR_NOTIFICATION':
      return {
        ...state,
        notifications: state.notifications.filter(n => n.agentName !== action.agentName),
      }

    default:
      return state
  }
}

export function useTuiStore() {
  return useReducer(tuiReducer, initialState)
}
