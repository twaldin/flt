import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { manualAdapter } from '../../src/pr-adapters/manual-adapter'

describe('manualAdapter', () => {
  const logSpy = mock(() => {})

  beforeEach(() => {
    logSpy.mockReset()
    console.log = logSpy
  })

  it('pushBranch logs expected message and resolves', async () => {
    await manualAdapter.pushBranch({ worktree: '/tmp/w', branch: 'feat/x' })
    expect(logSpy).toHaveBeenCalledWith('[manual pr_adapter] branch feat/x ready in /tmp/w; push manually when ready.')
  })

  it('createPr logs and returns empty URL sentinel', async () => {
    const result = await manualAdapter.createPr({
      worktree: '/tmp/w',
      branch: 'feat/x',
      title: 'T',
      body: 'B',
      baseBranch: 'main',
    })
    expect(logSpy).toHaveBeenCalledWith('[manual pr_adapter] branch feat/x ready in /tmp/w; push manually when ready.')
    expect(result).toEqual({ url: '' })
  })
})
