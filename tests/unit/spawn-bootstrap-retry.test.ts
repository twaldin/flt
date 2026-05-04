import { describe, expect, it } from 'bun:test'
import { verifyBootstrapDelivered } from '../../src/commands/spawn'

describe('verifyBootstrapDelivered', () => {
  it('returns true when payload prefix appears in pane content', () => {
    const payload = 'Read .flt/bootstrap.md and follow instructions'
    const pane = `\n> ${payload}\nSome other content\n`
    expect(verifyBootstrapDelivered(pane, payload)).toBe(true)
  })

  it('returns true when only the first 40 chars appear', () => {
    const payload = 'Read .flt/bootstrap.md and follow instructions there carefully'
    const prefix = payload.slice(0, 40)
    const pane = `> ${prefix}\n`
    expect(verifyBootstrapDelivered(pane, payload)).toBe(true)
  })

  it('returns false when pane does not contain payload or prefix', () => {
    const payload = 'Read .flt/bootstrap.md and follow instructions'
    const pane = 'Claude Code\n> \nTry how do I log an error?\n'
    expect(verifyBootstrapDelivered(pane, payload)).toBe(false)
  })

  it('returns true for single-line payload that appears verbatim', () => {
    const payload = 'do the thing now'
    const pane = `> do the thing now\n`
    expect(verifyBootstrapDelivered(pane, payload)).toBe(true)
  })

  it('returns false for empty pane', () => {
    expect(verifyBootstrapDelivered('', 'anything')).toBe(false)
  })

  it('ignores ANSI escape sequences when matching', () => {
    const payload = 'Read .flt/bootstrap.md'
    const pane = `\x1b[32m> Read .flt/bootstrap.md\x1b[0m\n`
    expect(verifyBootstrapDelivered(pane, payload)).toBe(true)
  })
})
