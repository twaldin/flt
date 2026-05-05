import { runCmd } from './exec'
import { ghAdapter } from './gh-adapter'
import { gtAdapter } from './gt-adapter'
import { manualAdapter } from './manual-adapter'

export type PrAdapterName = 'gh' | 'gt' | 'manual'

export interface CreatePrOpts {
  worktree: string
  branch: string
  title: string
  body: string
  baseBranch: string
  reviewers?: string[]
  labels?: string[]
}

export interface PushBranchOpts {
  worktree: string
  branch: string
}

export interface PrAdapter {
  createPr(opts: CreatePrOpts): Promise<{ url: string }>
  pushBranch(opts: PushBranchOpts): Promise<void>
}

const testOverrides: Partial<Record<PrAdapterName, PrAdapter>> = {}

export function _setPrAdapterForTest(name: PrAdapterName, adapter: PrAdapter | null): void {
  if (adapter === null) {
    delete testOverrides[name]
    return
  }
  testOverrides[name] = adapter
}

export function getPrAdapter(name: PrAdapterName): PrAdapter {
  const override = testOverrides[name]
  if (override) return override

  if (name === 'gh') return ghAdapter
  if (name === 'manual') return manualAdapter
  if (name === 'gt') {
    try {
      runCmd('which gt', { cwd: process.cwd(), timeoutMs: 5_000 })
    } catch {
      throw new Error('pr_adapter "gt" requested but `gt` CLI is not installed. Install Graphite (https://graphite.dev) or pick a different pr_adapter.')
    }
    return gtAdapter
  }

  throw new Error(`Unknown pr_adapter: ${name}`)
}
