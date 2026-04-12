import { Mode, TuiAction } from './types'

export interface KeyBinding {
  mode: Mode
  key: string
  action: TuiAction
}

type KeyHandler = (key: string) => TuiAction | undefined

export const keybindingMap: Record<Mode, Record<string, (dispatch: any) => void>> = {
  normal: {
    j: (dispatch) => dispatch({ type: 'SELECT_NEXT' }),
    k: (dispatch) => dispatch({ type: 'SELECT_PREV' }),
    return: (dispatch) => dispatch({ type: 'SET_MODE', mode: 'log-focus' }),
    tab: (dispatch) => dispatch({ type: 'SET_MODE', mode: 'log-focus' }),
    ':': (dispatch) => dispatch({ type: 'SET_MODE', mode: 'command' }),
    q: () => process.exit(0),
  },
  'log-focus': {
    j: (dispatch) => dispatch({ type: 'SCROLL_LOG_DOWN' }),
    k: (dispatch) => dispatch({ type: 'SCROLL_LOG_UP' }),
    return: (dispatch) => dispatch({ type: 'SET_MODE', mode: 'normal' }),
    escape: (dispatch) => dispatch({ type: 'SET_MODE', mode: 'normal' }),
    g: (dispatch) => dispatch({ type: 'JUMP_LOG_TOP' }),
    G: (dispatch) => dispatch({ type: 'JUMP_LOG_BOTTOM' }),
    '/': (dispatch) => dispatch({ type: 'SET_MODE', mode: 'log-focus' }),
  },
  command: {
    escape: (dispatch) => dispatch({ type: 'SET_MODE', mode: 'normal' }),
  },
  'spawn-wizard': {},
  'kill-confirm': {},
}

// Helper to check if a key combo maps to an action
export function getActionForKey(mode: Mode, key: string): ((dispatch: any) => void) | undefined {
  const handlers = keybindingMap[mode]
  if (!handlers) return undefined
  return handlers[key]
}
