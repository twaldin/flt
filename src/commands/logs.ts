import { getAgent } from '../state'
import * as tmux from '../tmux'

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

  if (!tmux.hasSession(agent.tmuxSession)) {
    throw new Error(`Agent "${name}" is not running (session dead).`)
  }

  const output = tmux.capturePane(agent.tmuxSession, lines)
  console.log(output)
}
