import { getAgent } from '../state'
import * as tmux from '../tmux'
import { resolveRemote } from '../remotes'
import { shellEscapeSingle, sshExec } from '../ssh'

export const _depsForTest = {
  getAgent,
  tmux,
  resolveRemote,
  shellEscapeSingle,
  sshExec,
}

interface LogsArgs {
  name: string
  lines?: number
}

export function logs(args: LogsArgs): void {
  const { name, lines = 100 } = args
  const agent = _depsForTest.getAgent(name)

  if (!agent) {
    throw new Error(`Agent "${name}" not found.`)
  }

  if (agent.location?.type === 'ssh') {
    const remote = _depsForTest.resolveRemote(agent.location.host)
    const session = _depsForTest.shellEscapeSingle(`${agent.tmuxSession}:^`)
    const result = _depsForTest.sshExec(remote, `tmux capture-pane -t ${session} -p -e -N -S -${lines}`)
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || `Failed to capture logs for "${name}" over SSH.`)
    }
    console.log(result.stdout)
    return
  }

  if (!_depsForTest.tmux.hasSession(agent.tmuxSession)) {
    throw new Error(`Agent "${name}" is not running (session dead).`)
  }

  const output = _depsForTest.tmux.capturePane(agent.tmuxSession, lines)
  console.log(output)
}
