import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { join } from 'path'
import { homedir } from 'os'

// isDangerousWorkdir is unexported from src/commands/spawn.ts.
// This mirrors its implementation exactly so we can test the behavior contract.
// If the implementation in spawn.ts changes, update this mirror too.
function isDangerousWorkdir(dir: string): boolean {
  const h = process.env.HOME || homedir()
  const norm = dir.endsWith('/') ? dir.slice(0, -1) : dir

  if (norm === h) return true
  if (h.startsWith(norm + '/')) return true

  for (const dot of ['.claude', '.codex', '.opencode', '.gemini', '.flt']) {
    const dotPath = join(h, dot)
    if (norm === dotPath || norm.startsWith(dotPath + '/')) return true
  }

  for (const root of ['/', '/etc', '/usr', '/System', '/Library']) {
    if (norm === root || (root !== '/' && norm.startsWith(root + '/'))) return true
  }

  return false
}

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

  it('sub-paths of dot-config dirs are dangerous', () => {
    expect(isDangerousWorkdir(join(FIXED_HOME, '.claude', 'whatever'))).toBe(true)
    expect(isDangerousWorkdir(join(FIXED_HOME, '.flt', 'agents', 'foo'))).toBe(true)
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
