import { getAgent } from '../state'
import * as tmux from '../tmux'
import { resolveRemote } from '../remotes'
import { shellEscapeSingle, sshExec } from '../ssh'

interface LogsArgs {
  name: string
  lines?: number
}

export function logs(args: LogsArgs): void {
  const { name, lines = 100 } = args
  const agent = getAgent(name)

  if (!agent) {
    throw new Error(`Agent "${name}" not found.`)
  }

  if (agent.location?.type === 'ssh') {
    const remote = resolveRemote(agent.location.host)
    const session = shellEscapeSingle(`${agent.tmuxSession}:^`)
    const result = sshExec(remote, `tmux capture-pane -t ${session} -p -e -N -S -${lines}`)
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || `Failed to capture logs for "${name}" over SSH.`)
    }
    console.log(result.stdout)
    return
  }

  if (!tmux.hasSession(agent.tmuxSession)) {
    throw new Error(`Agent "${name}" is not running (session dead).`)
  }

  const output = tmux.capturePane(agent.tmuxSession, lines)
  console.log(output)
}
