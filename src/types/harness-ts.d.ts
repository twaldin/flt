declare module '@twaldin/harness-ts' {
  export interface InstructionProjection {
    originalPath: string
    projectedPath: string
    backupPath?: string
    usedMarkers?: {
      start: string
      end: string
    }
  }

  export interface ProjectInstructionsOptions {
    mode?: 'prepend' | 'append' | 'replace'
    backup?: boolean
    replaceBetweenMarkers?: {
      start: string
      end: string
    }
  }

  export function projectInstructions(
    workDir: string,
    instructionFile: string,
    block: string,
    options?: ProjectInstructionsOptions,
  ): InstructionProjection

  export function restoreProjectedInstructions(projection: InstructionProjection): void

  export type HarnessReadyState = 'loading' | 'ready'
  export type HarnessAgentStatus = 'idle' | 'running' | 'waiting' | 'done' | 'unknown'

  export interface HarnessAdapter {
    instructionsFilename: string
    submitKeys?: string[]
    flattenOnPaste?: boolean
    detectReady?: (pane: string) => HarnessReadyState
    handleDialog?: (pane: string) => string[] | null
    detectStatus?: (pane: string) => HarnessAgentStatus
    sessionLogPath?: (workdir: string) => string | null
    parseSessionLog?: (path: string) => {
      tokensIn: number | null
      tokensOut: number | null
      costUsd: number | null
      model: string | null
    }
  }

  export function getAdapter(name: string): HarnessAdapter
}
