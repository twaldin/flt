import { useReducer } from 'react'
import { TuiState, TuiAction } from './types'

const initialState: TuiState = {
  mode: 'normal',
  agents: [],
  selectedIndex: 0,
  logContent: '',
  logScrollOffset: 0,
  autoFollow: true,
  searchQuery: '',
  commandInput: '',
  notifications: [],
  inboxMessages: [],
  lastAgentsHash: '',
  termHeight: 24,
  termWidth: 80,
  banner: null,
}

const BANNER_PANEL_HEIGHT = 10 // 8 lines + 2 border

function viewHeight(state: TuiState): number {
  // Content area: term height minus banner panel, footer, outer borders, scroll indicator
  return Math.max(4, state.termHeight - BANNER_PANEL_HEIGHT - 5 - 1)
}

function maxScroll(state: TuiState): number {
  const lines = state.logContent.split('\n').length
  return Math.max(0, lines - viewHeight(state))
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

    case 'SET_LOG_CONTENT': {
      const lines = action.content.split('\n').length
      const vH = viewHeight(state)
      const bottom = Math.max(0, lines - vH)
      const offset = state.autoFollow ? bottom : Math.min(state.logScrollOffset, bottom)
      return { ...state, logContent: action.content, logScrollOffset: offset }
    }

    case 'SCROLL_LOG_UP': {
      const newOffset = Math.max(0, state.logScrollOffset - 1)
      return { ...state, logScrollOffset: newOffset, autoFollow: false }
    }

    case 'SCROLL_LOG_DOWN': {
      const max = maxScroll(state)
      const newOffset = Math.min(max, state.logScrollOffset + 1)
      return { ...state, logScrollOffset: newOffset, autoFollow: newOffset >= max }
    }

    case 'SCROLL_LOG_PAGE_UP': {
      const pageSize = Math.max(1, Math.floor(viewHeight(state) / 2))
      const newOffset = Math.max(0, state.logScrollOffset - pageSize)
      return { ...state, logScrollOffset: newOffset, autoFollow: false }
    }

    case 'SCROLL_LOG_PAGE_DOWN': {
      const max = maxScroll(state)
      const pageSize = Math.max(1, Math.floor(viewHeight(state) / 2))
      const newOffset = Math.min(max, state.logScrollOffset + pageSize)
      return { ...state, logScrollOffset: newOffset, autoFollow: newOffset >= max }
    }

    case 'JUMP_LOG_TOP':
      return { ...state, logScrollOffset: 0, autoFollow: false }

    case 'JUMP_LOG_BOTTOM':
      return { ...state, logScrollOffset: maxScroll(state), autoFollow: true }

    case 'SET_TERM_SIZE':
      return { ...state, termHeight: action.height, termWidth: action.width }

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

    case 'SET_INBOX':
      return { ...state, inboxMessages: action.messages }

    case 'SET_BANNER':
      return { ...state, banner: action.banner }

    default:
      return state
  }
}

export function useTuiStore() {
  return useReducer(tuiReducer, initialState)
}
