import { setOrchestrator, getOrchestrator, loadState } from '../state'

interface InitArgs {
  orchestrator?: boolean
  cli?: string
  model?: string
}

export async function init(args: InitArgs): Promise<void> {
  const existing = getOrchestrator()

  if (args.orchestrator) {
    // Spawn an agent orchestrator — delegate to spawn command
    // For now, just import and call spawn
    const { spawn } = await import('./spawn')
    await spawn({
      name: 'orchestrator',
      cli: args.cli || 'claude-code',
      model: args.model,
      worktree: false,
    })
    console.log('Agent orchestrator spawned. Use "flt list" to check status.')
    return
  }

  // Human orchestrator — mark current session
  const currentSession = process.env.TMUX?.split(',')[0]?.split('/').pop() || 'unknown'

  if (existing) {
    if (existing.tmuxSession === currentSession) {
      console.log(`Fleet already initialized (${existing.type} orchestrator, started ${existing.initAt}).`)
      console.log('Use "flt spawn" to add agents, or "flt list" to see fleet status.')
    } else {
      // Session changed — update the parent session reference
      setOrchestrator({
        ...existing,
        tmuxSession: currentSession,
        tmuxWindow: process.env.TMUX_PANE || '0',
      })
      console.log(`Updated fleet parent session: ${existing.tmuxSession} → ${currentSession}`)
    }
    return
  }

  setOrchestrator({
    tmuxSession: currentSession,
    tmuxWindow: process.env.TMUX_PANE || '0',
    type: 'human',
    initAt: new Date().toISOString(),
  })

  console.log('Fleet initialized. You are the orchestrator.')
  console.log('Use "flt spawn <name> --cli <cli>" to add agents.')
}
