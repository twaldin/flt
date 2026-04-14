import { describe, it, expect } from 'bun:test'
import { parseCommand, isValidCommand } from '../../../src/tui/command-parser'

describe('command-parser', () => {
  it('parses send command', () => {
    const result = parseCommand(':send agent hello world')
    expect(result).toEqual({
      cmd: 'send',
      args: ['agent', 'hello', 'world'],
      raw: ':send agent hello world',
    })
  })

  it('parses logs command', () => {
    const result = parseCommand(':logs agent-1')
    expect(result).toEqual({
      cmd: 'logs',
      args: ['agent-1'],
      raw: ':logs agent-1',
    })
  })

  it('returns null for non-command input', () => {
    expect(parseCommand('hello')).toBeNull()
    expect(parseCommand('')).toBeNull()
    expect(parseCommand(' ')).toBeNull()
  })

  it('returns null for command with no args', () => {
    const result = parseCommand(':')
    expect(result).toBeNull()
  })

  it('handles leading/trailing whitespace', () => {
    const result = parseCommand('  :send agent msg  ')
    expect(result?.cmd).toBe('send')
    expect(result?.args).toContain('agent')
  })

  it('validates command names', () => {
    expect(isValidCommand('send')).toBe(true)
    expect(isValidCommand('logs')).toBe(true)
    expect(isValidCommand('spawn')).toBe(true)
    expect(isValidCommand('presets')).toBe(true)
    expect(isValidCommand('kill')).toBe(true)
    expect(isValidCommand('theme')).toBe(true)
    expect(isValidCommand('keybinds')).toBe(true)
    expect(isValidCommand('invalid')).toBe(false)
  })
})
