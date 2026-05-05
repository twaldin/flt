import type { PrAdapter } from './index'

export const manualAdapter: PrAdapter = {
  async pushBranch({ branch, worktree }) {
    console.log(`[manual pr_adapter] branch ${branch} ready in ${worktree}; push manually when ready.`)
  },
  async createPr({ branch, worktree }) {
    console.log(`[manual pr_adapter] branch ${branch} ready in ${worktree}; push manually when ready.`)
    return { url: '' }
  },
}
