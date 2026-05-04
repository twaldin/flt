import type { AgentState } from './state'
import { getLocation } from './state'
import { pasteBuffer, sendKeys, sendLiteral } from './tmux'

export function deliver(agent: AgentState, text: string): void {
  const loc = getLocation(agent)
  switch (loc.type) {
    case 'local':
      if (text.length > 200) {
        pasteBuffer(agent.tmuxSession, text)
      } else {
        sendLiteral(agent.tmuxSession, text)
      }
      return
    case 'ssh':
      throw new Error('ssh delivery not yet implemented in this phase — see docs/ssh-sandbox-design.md')
    case 'sandbox':
      throw new Error('sandbox delivery not yet implemented in this phase — see docs/ssh-sandbox-design.md')
    case 'ssh+sandbox':
      throw new Error('ssh+sandbox delivery not yet implemented in this phase — see docs/ssh-sandbox-design.md')
    default: {
      const _exhaustive: never = loc
      return _exhaustive
    }
  }
}

export function deliverKeys(agent: AgentState, keys: string[]): void {
  const loc = getLocation(agent)
  switch (loc.type) {
    case 'local':
      sendKeys(agent.tmuxSession, keys)
      return
    case 'ssh':
      throw new Error('ssh delivery not yet implemented in this phase — see docs/ssh-sandbox-design.md')
    case 'sandbox':
      throw new Error('sandbox delivery not yet implemented in this phase — see docs/ssh-sandbox-design.md')
    case 'ssh+sandbox':
      throw new Error('ssh+sandbox delivery not yet implemented in this phase — see docs/ssh-sandbox-design.md')
    default: {
      const _exhaustive: never = loc
      return _exhaustive
    }
  }
}
