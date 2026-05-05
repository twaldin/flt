import { beforeEach, describe, expect, it, mock } from 'bun:test'

const runCmd = mock((_: string, __: { cwd: string; timeoutMs?: number; allowFail?: boolean }) => '')

mock.module('../../src/pr-adapters/exec', () => ({ runCmd }))

import { ghAdapter } from '../../src/pr-adapters/gh-adapter'

describe('ghAdapter', () => {
  beforeEach(() => {
    runCmd.mockReset()
  })

  it('pushBranch issues git push in the given cwd', async () => {
    await ghAdapter.pushBranch({ worktree: '/tmp/w', branch: 'feat/x' })
    expect(runCmd).toHaveBeenCalledWith('git push -u origin feat/x', { cwd: '/tmp/w', timeoutMs: 30_000 })
  })

  it('createPr creates when no existing PR', async () => {
    runCmd.mockImplementation((cmd) => {
      if (cmd.startsWith('gh pr view')) return ''
      if (cmd.startsWith('gh pr create')) return 'https://x/pr/1'
      return ''
    })

    const result = await ghAdapter.createPr({
      worktree: '/tmp/w',
      branch: 'feat/x',
      title: 'My title',
      body: 'B',
      baseBranch: 'main',
    })

    expect(runCmd).toHaveBeenCalledWith('gh pr view feat/x --json url', {
      cwd: '/tmp/w',
      timeoutMs: 15_000,
      allowFail: true,
    })
    expect(runCmd).toHaveBeenCalledWith("gh pr create --title 'My title' --body 'B' --head 'feat/x' --base 'main'", {
      cwd: '/tmp/w',
      timeoutMs: 30_000,
    })
    expect(result).toEqual({ url: 'https://x/pr/1' })
  })

  it('createPr returns existing PR and skips create', async () => {
    runCmd.mockImplementation((cmd) => {
      if (cmd.startsWith('gh pr view')) return '{"url":"https://x/pr/9"}'
      return ''
    })

    const result = await ghAdapter.createPr({
      worktree: '/tmp/w',
      branch: 'feat/x',
      title: 'My title',
      body: 'B',
      baseBranch: 'main',
    })

    const createCalls = runCmd.mock.calls.filter(([cmd]) => (cmd as string).startsWith('gh pr create'))
    expect(createCalls.length).toBe(0)
    expect(result).toEqual({ url: 'https://x/pr/9' })
  })

  it('adds reviewer/label flags only when non-empty', async () => {
    runCmd.mockImplementation((cmd) => {
      if (cmd.startsWith('gh pr view')) return ''
      if (cmd.startsWith('gh pr create')) return 'https://x/pr/2'
      return ''
    })

    await ghAdapter.createPr({
      worktree: '/tmp/w',
      branch: 'feat/x',
      title: 'T',
      body: 'B',
      baseBranch: 'main',
      reviewers: ['a', 'b'],
      labels: ['x'],
    })
    expect(runCmd).toHaveBeenCalledWith("gh pr create --title 'T' --body 'B' --head 'feat/x' --base 'main' --reviewer 'a,b' --label 'x'", {
      cwd: '/tmp/w',
      timeoutMs: 30_000,
    })

    runCmd.mockReset()
    runCmd.mockImplementation((cmd) => {
      if (cmd.startsWith('gh pr view')) return ''
      if (cmd.startsWith('gh pr create')) return 'https://x/pr/3'
      return ''
    })

    await ghAdapter.createPr({
      worktree: '/tmp/w',
      branch: 'feat/x',
      title: 'T',
      body: 'B',
      baseBranch: 'main',
      reviewers: [],
      labels: [],
    })

    const createCmd = runCmd.mock.calls.find(([cmd]) => (cmd as string).startsWith('gh pr create'))?.[0] as string
    expect(createCmd.includes('--reviewer')).toBe(false)
    expect(createCmd.includes('--label')).toBe(false)
  })

  it('escapes single quotes in title', async () => {
    runCmd.mockImplementation((cmd) => {
      if (cmd.startsWith('gh pr view')) return ''
      if (cmd.startsWith('gh pr create')) return 'https://x/pr/4'
      return ''
    })

    await ghAdapter.createPr({
      worktree: '/tmp/w',
      branch: 'feat/x',
      title: "Bob's title",
      body: 'B',
      baseBranch: 'main',
    })

    const createCmd = runCmd.mock.calls.find(([cmd]) => (cmd as string).startsWith('gh pr create'))?.[0] as string
    expect(createCmd.includes("'Bob'\\''s title'")).toBe(true)
  })
})
