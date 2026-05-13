import { getOrchestrator, setOrchestrator } from '../state'

interface SetArgs {
  name: string
  external: boolean
  sink?: string
}

export function orchestratorSetDirect(args: SetArgs): void {
  const { name, external, sink } = args
  if (!external) {
    throw new Error('Only --external is supported. Use: flt orchestrator set <name> --external [--sink inbox]')
  }
  const resolvedSink = sink ?? 'inbox'
  setOrchestrator({
    tmuxSession: '',
    tmuxWindow: '',
    type: 'external',
    name,
    sink: resolvedSink,
    initAt: new Date().toISOString(),
  })
  console.log(`Registered "${name}" as external orchestrator (sink: ${resolvedSink}).`)
}

export function orchestratorStatus(): void {
  const orch = getOrchestrator()
  if (!orch) {
    console.log('No orchestrator registered.')
    return
  }
  console.log(JSON.stringify(orch, null, 2))
}
