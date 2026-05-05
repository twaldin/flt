import { runCmd } from './exec'
import type { PrAdapter } from './index'

function q(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

export const ghAdapter: PrAdapter = {
  async pushBranch({ worktree, branch }) {
    runCmd(`git push -u origin ${branch}`, { cwd: worktree, timeoutMs: 30_000 })
  },
  async createPr({ worktree, branch, title, body, baseBranch, reviewers, labels }) {
    runCmd(`git push -u origin ${branch}`, { cwd: worktree, timeoutMs: 30_000 })
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

    const reviewerFlag = reviewers && reviewers.length > 0 ? ` --reviewer ${q(reviewers.join(','))}` : ''
    const labelFlag = labels && labels.length > 0 ? ` --label ${q(labels.join(','))}` : ''
    const out = runCmd(
      `gh pr create --title ${q(title)} --body ${q(body)} --head ${q(branch)} --base ${q(baseBranch)}${reviewerFlag}${labelFlag}`,
      { cwd: worktree, timeoutMs: 30_000 },
    )
    return { url: out.trim() }
  },
}
