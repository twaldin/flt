import type { AgentState } from './state'
import { resolveRemote } from './remotes'
import { shellEscapeSingle, sshExec } from './ssh'
import { getLocation } from './state'
import { pasteBuffer, sendKeys, sendLiteral } from './tmux'

export const _depsForTest = {
  resolveRemote,
  shellEscapeSingle,
  sshExec,
  getLocation,
  pasteBuffer,
  sendKeys,
  sendLiteral,
}

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
  const loc = _depsForTest.getLocation(agent)
  switch (loc.type) {
    case 'local':
      if (text.length > 200) {
        _depsForTest.pasteBuffer(agent.tmuxSession, text)
      } else {
        _depsForTest.sendLiteral(agent.tmuxSession, text)
      }
      return
    case 'ssh': {
      const remote = _depsForTest.resolveRemote(loc.host)
      assertSafeSshHost(remote.host)
      const target = `${_depsForTest.shellEscapeSingle(agent.tmuxSession)}:^`
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
        const result = _depsForTest.sshExec(remote, command, { input: text })
        ensureSshSuccess(result.status, result.stderr)
      } else {
        const result = _depsForTest.sshExec(remote, `tmux send-keys -t ${target} -l ${_depsForTest.shellEscapeSingle(text)}`)
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
  const loc = _depsForTest.getLocation(agent)
  switch (loc.type) {
    case 'local':
      _depsForTest.sendKeys(agent.tmuxSession, keys)
      return
    case 'ssh': {
      const remote = _depsForTest.resolveRemote(loc.host)
      assertSafeSshHost(remote.host)
      const target = `${_depsForTest.shellEscapeSingle(agent.tmuxSession)}:^`
      for (const key of keys) {
        const result = _depsForTest.sshExec(remote, `tmux send-keys -t ${target} ${_depsForTest.shellEscapeSingle(key)}`)
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
