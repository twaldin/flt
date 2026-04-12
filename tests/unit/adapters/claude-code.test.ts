import { describe, it, expect } from 'bun:test'
import { claudeCodeAdapter } from '../../../src/adapters/claude-code'

describe('claude-code adapter', () => {
  it('generates spawn args with model', () => {
    const args = claudeCodeAdapter.spawnArgs({ model: 'opus-4-6', dir: '/tmp' })
    expect(args).toContain('claude')
    expect(args).toContain('--dangerously-skip-permissions')
    expect(args).toContain('--model')
    expect(args).toContain('opus-4-6')
  })

  it('generates spawn args without model', () => {
    const args = claudeCodeAdapter.spawnArgs({ dir: '/tmp' })
    expect(args).toContain('claude')
    expect(args).toContain('--dangerously-skip-permissions')
    expect(args).not.toContain('--model')
  })

  it('detects bypass permissions dialog', () => {
    const pane = `WARNING: Claude Code running in Bypass Permissions mode.
All tools will be executed without confirmation.
1. No, exit
2. Yes, I accept the risks`
    expect(claudeCodeAdapter.detectReady(pane)).toBe('dialog')
    expect(claudeCodeAdapter.handleDialog(pane)).toEqual(['2', 'Enter'])
  })

  it('detects workspace trust dialog', () => {
    const pane = 'Do you trust the files in this folder?'
    expect(claudeCodeAdapter.detectReady(pane)).toBe('dialog')
    expect(claudeCodeAdapter.handleDialog(pane)).toEqual(['Enter'])
  })

  it('detects ready state', () => {
    const pane = `Claude Code v1.2.3
❯
────────────────────
  bypass permissions on`
    expect(claudeCodeAdapter.detectReady(pane)).toBe('ready')
  })

  it('detects ready with > prompt', () => {
    const pane = `Claude Code v1.2.3
>
────
  bypass permissions`
    expect(claudeCodeAdapter.detectReady(pane)).toBe('ready')
  })

  it('detects loading state', () => {
    const pane = 'Starting Claude Code...'
    expect(claudeCodeAdapter.detectReady(pane)).toBe('loading')
  })

  it('detects idle status', () => {
    const pane = 'some output\n> \nstatus bar'
    expect(claudeCodeAdapter.detectStatus(pane)).toBe('idle')
  })

  it('detects running status', () => {
    const pane = '✶ Thinking about the problem...'
    expect(claudeCodeAdapter.detectStatus(pane)).toBe('running')
  })

  it('detects rate-limited status', () => {
    const pane = "You've hit your rate limit. Try again later."
    expect(claudeCodeAdapter.detectStatus(pane)).toBe('rate-limited')
  })

  it('has correct instruction file', () => {
    expect(claudeCodeAdapter.instructionFile).toBe('CLAUDE.md')
  })

  it('has correct submit keys', () => {
    expect(claudeCodeAdapter.submitKeys).toEqual(['Enter'])
  })
})
