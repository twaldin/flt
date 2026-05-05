import type { AgentState } from './state'
import { resolveRemote } from './remotes'
import { shellEscapeSingle, sshExec } from './ssh'
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
    case 'ssh': {
      const remote = resolveRemote(loc.host)
      const target = `${shellEscapeSingle(agent.tmuxSession)}:^`
      if (text.length > 200) {
        const rand = Math.random().toString(36).slice(2, 10)
        const bufferName = `flt-paste-${rand}`
        const tmpPath = `/tmp/flt-paste-${rand}`
        const command = [
          `cat > ${tmpPath}`,
          `tmux load-buffer -b ${bufferName} ${tmpPath}`,
          `tmux paste-buffer -b ${bufferName} -t ${target} -d`,
          `rm ${tmpPath}`,
        ].join(' && ')
        sshExec(remote, command, { input: text })
      } else {
        sshExec(remote, `tmux send-keys -t ${target} -l ${shellEscapeSingle(text)}`)
      }
      return
    }
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
    case 'ssh': {
      const remote = resolveRemote(loc.host)
      const target = `${shellEscapeSingle(agent.tmuxSession)}:^`
      for (const key of keys) {
        sshExec(remote, `tmux send-keys -t ${target} ${shellEscapeSingle(key)}`)
      }
      return
    }
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
