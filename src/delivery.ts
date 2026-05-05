import type { AgentState } from './state'
import { resolveRemote } from './remotes'
import { shellEscapeSingle, sshExec } from './ssh'
import { getLocation } from './state'
import { pasteBuffer, sendKeys, sendLiteral } from './tmux'

function assertSafeSshHost(host: string): void {
  if (host.startsWith('-')) {
    throw new Error(`Refusing unsafe ssh host target: ${host}`)
  }
}

function ensureSshSuccess(status: number, stderr: string): void {
  if (status !== 0) {
    throw new Error(`SSH delivery failed: ${stderr || `exit ${status}`}`)
  }
}

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
      assertSafeSshHost(remote.host)
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
        const result = sshExec(remote, command, { input: text })
        ensureSshSuccess(result.status, result.stderr)
      } else {
        const result = sshExec(remote, `tmux send-keys -t ${target} -l ${shellEscapeSingle(text)}`)
        ensureSshSuccess(result.status, result.stderr)
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
      assertSafeSshHost(remote.host)
      const target = `${shellEscapeSingle(agent.tmuxSession)}:^`
      for (const key of keys) {
        const result = sshExec(remote, `tmux send-keys -t ${target} ${shellEscapeSingle(key)}`)
        ensureSshSuccess(result.status, result.stderr)
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
