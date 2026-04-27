import { describe, expect, it } from 'bun:test'
import { sidebarEntryRows, shouldRenderWorkflowRow } from '../../../src/tui/sidebar-utils'

describe('sidebar wf row gating', () => {
  it('hides wf row for undefined/empty workflow', () => {
    expect(shouldRenderWorkflowRow(undefined)).toBe(false)
    expect(shouldRenderWorkflowRow('')).toBe(false)
    expect(sidebarEntryRows(undefined)).toBe(5)
    expect(sidebarEntryRows('')).toBe(5)
  })

  it('shows wf row for truthy workflow', () => {
    expect(shouldRenderWorkflowRow('idea-to-pr')).toBe(true)
    expect(sidebarEntryRows('idea-to-pr')).toBe(6)
  })
})
