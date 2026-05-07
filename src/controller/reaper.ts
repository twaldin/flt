import { loadState, saveState } from '../state'
import { listSessions } from '../tmux'
import { restoreInstructions } from '../instructions'
import { appendEvent } from '../activity'

// Defense-in-depth for instruction-projection cleanup. The kill flow restores
// projections on graceful kill, and the poller's death detector runs killDirect
// when an agent's tmux session disappears — both already restore. The reaper
// closes the residual gap: state.json carrying an `instructionProjection` for
// an agent whose tmux session is gone, after the controller crashed/restarted
// past the poller's death-grace, or after killDirect's restore step threw and
// got swallowed. Periodic scan, idempotent.

export interface ReapResult {
  reaped: Array<{ agent: string; filePath: string }>
  failed: Array<{ agent: string; filePath: string; error: string }>
}

export function reapOrphanedProjections(): ReapResult {
  const state = loadState()
  const live = new Set(listSessions())
  const result: ReapResult = { reaped: [], failed: [] }
  let dirty = false

  for (const [name, agent] of Object.entries(state.agents)) {
    const projection = agent.instructionProjection
    if (!projection) continue

    // Liveness signal: tmux session presence. Same source of truth as the
    // poller's death detector — keeps the two reapers in agreement on what
    // counts as "gone".
    if (live.has(agent.tmuxSession)) continue

    const filePath = projection.filePath
    try {
      restoreInstructions(projection)
      appendEvent({
        type: 'instructions',
        agent: name,
        detail: `reaper restored ${filePath}`,
        at: new Date().toISOString(),
      })
      result.reaped.push({ agent: name, filePath })
    } catch (e) {
      const error = (e as Error).message
      appendEvent({
        type: 'error',
        agent: name,
        detail: `reaper restore failed: ${error}`,
        at: new Date().toISOString(),
      })
      result.failed.push({ agent: name, filePath, error })
    }

    // Clear field whether restore succeeded or threw — repeated retries on a
    // broken backup just spam the activity log. Operator can re-project by
    // respawning if needed.
    delete state.agents[name].instructionProjection
    dirty = true
  }

  if (dirty) saveState(state)
  return result
}

let reaperTimer: ReturnType<typeof setInterval> | null = null

export function startReaper(intervalMs = 30_000): void {
  if (reaperTimer) return
  reaperTimer = setInterval(() => {
    try {
      reapOrphanedProjections()
    } catch (e) {
      appendEvent({
        type: 'error',
        detail: `reaper tick failed: ${(e as Error).message}`,
        at: new Date().toISOString(),
      })
    }
  }, intervalMs)
}

export function stopReaper(): void {
  if (reaperTimer) {
    clearInterval(reaperTimer)
    reaperTimer = null
  }
}
