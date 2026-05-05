import { runCmd } from './exec'
import type { PrAdapter } from './index'

export const gtAdapter: PrAdapter = {
  async pushBranch({ worktree }) {
    runCmd('gt submit --no-edit --publish', { cwd: worktree, timeoutMs: 60_000 })
  },
  async createPr({ worktree, branch }) {
    // gt manages title/body/reviewers via its own conventions; opts ignored.
    const out = runCmd('gt submit --no-edit --publish', { cwd: worktree, timeoutMs: 60_000 })
    const match = out.match(/(https:\/\/github\.com\/[^\s]+\/pull\/\d+)/)
    if (match) return { url: match[1] }

    const existing = runCmd(`gh pr view ${branch} --json url`, {
      cwd: worktree,
      timeoutMs: 15_000,
      allowFail: true,
    })
    if (existing) {
      const parsed: unknown = JSON.parse(existing)
      if (typeof parsed === 'object' && parsed !== null && 'url' in parsed && typeof parsed.url === 'string') {
        return { url: parsed.url }
      }
    }

    throw new Error('gt-adapter: could not determine PR URL from gt submit output')
  },
}
