export interface SpawnOpts {
  model?: string
  dir: string
}

export type ReadyState = 'loading' | 'dialog' | 'ready'
export type AgentStatus = 'running' | 'idle' | 'error' | 'rate-limited' | 'unknown' | 'exited'

export interface CliAdapter {
  /** Adapter identifier, e.g. "claude-code" */
  name: string
  /** Actual CLI binary name, e.g. "claude" */
  cliCommand: string
  /** Where instructions go in the workspace, e.g. "CLAUDE.md" */
  instructionFile: string
  /** Key sequences to submit input, e.g. ["Enter"] or ["Escape", "Enter"] */
  submitKeys: string[]

  /** Build CLI args for the spawn command */
  spawnArgs(opts: SpawnOpts): string[]
  /** Detect if the CLI is ready by examining pane content */
  detectReady(pane: string): ReadyState
  /** Return key sequences to handle a dialog, or null if no dialog detected */
  handleDialog(pane: string): string[] | null
  /** Detect agent activity status from pane content */
  detectStatus(pane: string): AgentStatus
  /** Extra env vars needed by this CLI (API keys, base URLs, etc.) */
  env?(): Record<string, string>
}
