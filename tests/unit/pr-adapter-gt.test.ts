import { beforeEach, describe, expect, it, mock } from 'bun:test'

const runCmd = mock((_: string, __: { cwd: string; timeoutMs?: number; allowFail?: boolean }) => '')

mock.module('../../src/pr-adapters/exec', () => ({ runCmd }))

import { gtAdapter } from '../../src/pr-adapters/gt-adapter'

describe('gtAdapter', () => {
  beforeEach(() => {
    runCmd.mockReset()
  })

  it('pushBranch runs gt submit in worktree', async () => {
    await gtAdapter.pushBranch({ worktree: '/tmp/w', branch: 'feat/x' })
    expect(runCmd).toHaveBeenCalledWith('gt submit --no-edit --publish', { cwd: '/tmp/w', timeoutMs: 60_000 })
  })

  it('createPr parses URL from gt stdout', async () => {
    runCmd.mockReturnValue('Pushed to remote.\nhttps://github.com/o/r/pull/42')

    const result = await gtAdapter.createPr({
      worktree: '/tmp/w',
      branch: 'feat/x',
      title: 'T',
      body: 'B',
      baseBranch: 'main',
    })

    expect(result).toEqual({ url: 'https://github.com/o/r/pull/42' })
  })

  it('falls back to gh pr view when gt has no URL', async () => {
    runCmd.mockImplementation((cmd) => {
      if (cmd.startsWith('gt submit')) return 'done'
      if (cmd.startsWith('gh pr view')) return '{"url":"https://github.com/o/r/pull/43"}'
      return ''
    })

    const result = await gtAdapter.createPr({
      worktree: '/tmp/w',
      branch: 'feat/x',
      title: 'T',
      body: 'B',
      baseBranch: 'main',
    })

    expect(result).toEqual({ url: 'https://github.com/o/r/pull/43' })
  })

  it('throws when gt and gh fallback are empty', async () => {
    runCmd.mockImplementation((cmd) => {
      if (cmd.startsWith('gt submit')) return 'done'
      if (cmd.startsWith('gh pr view')) return ''
      return ''
    })

    await expect(
      gtAdapter.createPr({
        worktree: '/tmp/w',
        branch: 'feat/x',
        title: 'T',
        body: 'B',
        baseBranch: 'main',
      }),
    ).rejects.toThrow('gt-adapter: could not determine PR URL from gt submit output')
  })
})
