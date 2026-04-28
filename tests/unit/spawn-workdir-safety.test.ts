import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { join } from 'path'
import { confirmDangerousWorkdir, isDangerousWorkdir } from '../../src/commands/spawn'

const FIXED_HOME = '/tmp/test-home-spawn'

describe('isDangerousWorkdir', () => {
  let origHome: string | undefined

  beforeEach(() => {
    origHome = process.env.HOME
    process.env.HOME = FIXED_HOME
  })

  afterEach(() => {
    process.env.HOME = origHome
  })

  it('HOME itself is dangerous', () => {
    expect(isDangerousWorkdir(FIXED_HOME)).toBe(true)
  })

  it('parent of HOME is dangerous', () => {
    expect(isDangerousWorkdir('/tmp')).toBe(true)
  })

  it('dot-config dirs under HOME are dangerous', () => {
    expect(isDangerousWorkdir(join(FIXED_HOME, '.claude'))).toBe(true)
    expect(isDangerousWorkdir(join(FIXED_HOME, '.codex'))).toBe(true)
    expect(isDangerousWorkdir(join(FIXED_HOME, '.opencode'))).toBe(true)
    expect(isDangerousWorkdir(join(FIXED_HOME, '.gemini'))).toBe(true)
    expect(isDangerousWorkdir(join(FIXED_HOME, '.flt'))).toBe(true)
  })

  it('sub-paths of dot-config dirs are dangerous except per-agent ~/.flt homes', () => {
    expect(isDangerousWorkdir(join(FIXED_HOME, '.claude', 'whatever'))).toBe(true)
    expect(isDangerousWorkdir(join(FIXED_HOME, '.flt', 'agents', 'foo'))).toBe(false)
    expect(isDangerousWorkdir(join(FIXED_HOME, '.flt', 'agents', 'foo', 'sub'))).toBe(false)
    expect(isDangerousWorkdir(join(FIXED_HOME, '.flt', 'agents'))).toBe(true)
    expect(isDangerousWorkdir(join(FIXED_HOME, '.flt'))).toBe(true)
    expect(isDangerousWorkdir(join(FIXED_HOME, '.flt', 'skills'))).toBe(true)
    expect(isDangerousWorkdir(FIXED_HOME)).toBe(true)
  })

  it('system root paths are dangerous', () => {
    expect(isDangerousWorkdir('/')).toBe(true)
    expect(isDangerousWorkdir('/etc')).toBe(true)
    expect(isDangerousWorkdir('/usr')).toBe(true)
    expect(isDangerousWorkdir('/System')).toBe(true)
    expect(isDangerousWorkdir('/Library')).toBe(true)
  })

  it('a normal project directory under HOME is safe', () => {
    expect(isDangerousWorkdir(join(FIXED_HOME, 'some-project'))).toBe(false)
  })

  it('an unrelated tmp directory is safe', () => {
    expect(isDangerousWorkdir('/tmp/foo')).toBe(false)
  })
})

describe('confirmDangerousWorkdir under FLT_TUI_ACTIVE', () => {
  let origTui: string | undefined

  beforeEach(() => {
    origTui = process.env.FLT_TUI_ACTIVE
    process.env.FLT_TUI_ACTIVE = '1'
  })

  afterEach(() => {
    process.env.FLT_TUI_ACTIVE = origTui
  })

  it('returns false and writes one stderr line without stdin prompt', async () => {
    const dir = '/tmp/dangerous'
    const stderrSpy = spyOn(process.stderr, 'write').mockImplementation(() => true)

    const allowed = await confirmDangerousWorkdir(dir)

    expect(allowed).toBe(false)
    expect(stderrSpy).toHaveBeenCalledTimes(1)
    expect(String(stderrSpy.mock.calls[0]?.[0])).toContain(dir)

    stderrSpy.mockRestore()
  })
})
