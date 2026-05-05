import { beforeEach, describe, expect, it, mock } from 'bun:test'

const runCmd = mock((_: string, __: { cwd: string; timeoutMs?: number; allowFail?: boolean }) => '')

mock.module('../../src/pr-adapters/exec', () => ({ runCmd }))

import { _setPrAdapterForTest, getPrAdapter } from '../../src/pr-adapters'
import type { PrAdapter, PrAdapterName } from '../../src/pr-adapters'

describe('pr adapter factory', () => {
  beforeEach(() => {
    runCmd.mockReset()
    _setPrAdapterForTest('gh', null)
    _setPrAdapterForTest('gt', null)
    _setPrAdapterForTest('manual', null)
  })

  it('returns gh adapter functions', () => {
    const adapter = getPrAdapter('gh')
    expect(typeof adapter.createPr).toBe('function')
    expect(typeof adapter.pushBranch).toBe('function')
  })

  it('returns manual adapter functions', () => {
    const adapter = getPrAdapter('manual')
    expect(typeof adapter.createPr).toBe('function')
    expect(typeof adapter.pushBranch).toBe('function')
  })

  it('returns gt adapter when which gt succeeds', () => {
    runCmd.mockReturnValue('/usr/local/bin/gt')
    const adapter = getPrAdapter('gt')
    expect(typeof adapter.createPr).toBe('function')
    expect(typeof adapter.pushBranch).toBe('function')
    expect(runCmd).toHaveBeenCalledWith('which gt', { cwd: process.cwd(), timeoutMs: 5_000 })
  })

  it('throws exact message when gt cli missing', () => {
    runCmd.mockImplementation(() => {
      throw new Error('no gt')
    })
    expect(() => getPrAdapter('gt')).toThrow('pr_adapter "gt" requested but `gt` CLI is not installed. Install Graphite (https://graphite.dev) or pick a different pr_adapter.')
  })

  it('throws on unknown adapter names', () => {
    expect(() => getPrAdapter('bogus' as PrAdapterName)).toThrow('Unknown pr_adapter: bogus')
  })

  it('returns override without probing which gt, and null restores default behavior', () => {
    const recordingAdapter: PrAdapter = {
      async createPr() {
        return { url: 'x' }
      },
      async pushBranch() {},
    }

    _setPrAdapterForTest('gt', recordingAdapter)
    const selected = getPrAdapter('gt')
    expect(selected).toBe(recordingAdapter)
    expect(runCmd).toHaveBeenCalledTimes(0)

    _setPrAdapterForTest('gt', null)
    runCmd.mockImplementation(() => {
      throw new Error('no gt')
    })
    expect(() => getPrAdapter('gt')).toThrow('pr_adapter "gt" requested but `gt` CLI is not installed.')
  })
})
