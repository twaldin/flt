// Ambient shim for symbols @twaldin/harness-ts@0.2.7 does not export types for.
// Re-verify on every version bump.
//
// This file MUST stay a module (it has a top-level export) so TypeScript treats
// the `declare module` block as a module augmentation rather than a global ambient
// replacement.  Removing the export {} would shadow all real package exports.

export {}

declare module '@twaldin/harness-ts' {
  export interface ScrollKeys {
    lineDown: string
    lineUp: string
    pageDown: string
    pageUp: string
  }

  export interface Adapter {
    getCurrentScrollKeys?: () => ScrollKeys | null
  }
}
