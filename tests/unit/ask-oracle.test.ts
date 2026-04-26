import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let tempHome: string
const originalHome = process.env.HOME

function seedRoutingAndPresets(): void {
  const fltDir = join(tempHome, '.flt')
  mkdirSync(join(fltDir, 'routing'), { recursive: true })
  writeFileSync(join(fltDir, 'routing', 'policy.yaml'), 'oracle: pi-deep\n')
  writeFileSync(join(fltDir, 'presets.json'), JSON.stringify({ 'pi-deep': { cli: 'pi', model: 'gpt-5.4-high' } }, null, 2) + '\n')
}

describe('askOracle', () => {
  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'flt-test-ask-oracle-'))
    process.env.HOME = tempHome
    seedRoutingAndPresets()
  })

  afterEach(async () => {
    const askMod = await import('../../src/commands/ask')
    askMod._setAskOracleTestHooks({})
    process.env.HOME = originalHome
    if (existsSync(tempHome)) rmSync(tempHome, { recursive: true, force: true })
  })

  it('waits for human reply and returns oracle message text', async () => {
    const askMod = await import('../../src/commands/ask')
    const outSpy = spyOn(console, 'log').mockImplementation(() => {})

    askMod._setAskOracleTestHooks({
      spawnFn: (args: { name: string }) => {
        const inboxPath = join(tempHome, '.flt', 'inbox.log')
        writeFileSync(inboxPath, '')
        setTimeout(() => {
          appendFileSync(inboxPath, `[12:00:00 AM] [${args.name.toUpperCase()}]: the answer is 42\n`)
        }, 50)
      },
      killFn: () => {},
    })

    const answer = await askMod.askOracle('hello?', { timeoutMs: 2000 })

    expect(answer).toContain('the answer is 42')
    expect(outSpy).toHaveBeenCalledWith('the answer is 42')
    outSpy.mockRestore()
  })

  it('for non-human caller, returns immediately and prints spawned message', async () => {
    const askMod = await import('../../src/commands/ask')
    const outSpy = spyOn(console, 'log').mockImplementation(() => {})

    let spawnArgs: Record<string, unknown> | undefined
    askMod._setAskOracleTestHooks({
      spawnFn: (args: Record<string, unknown>) => {
        spawnArgs = args
      },
      killFn: () => {},
    })

    const result = await askMod.askOracle('hello?', { from: 'agent-x' })

    expect(result).toBeNull()
    expect(spawnArgs?.parent).toBe('agent-x')
    expect(String(spawnArgs?.bootstrap)).toContain('flt send agent-x')
    expect(outSpy).toHaveBeenCalledWith(expect.stringContaining('spawned; reply will arrive in your session.'))
    outSpy.mockRestore()
  })

  it('prints timeout warning and returns null when oracle does not reply', async () => {
    const askMod = await import('../../src/commands/ask')
    const errSpy = spyOn(console, 'error').mockImplementation(() => {})

    askMod._setAskOracleTestHooks({
      spawnFn: () => {},
      killFn: () => {},
    })

    const result = await askMod.askOracle('hi', { timeoutMs: 200 })

    expect(result).toBeNull()
    expect(errSpy).toHaveBeenCalledWith('Oracle did not reply within timeout. Killing.')
    errSpy.mockRestore()
  })

  it('throws clear error when routing policy is missing', async () => {
    const askMod = await import('../../src/commands/ask')
    rmSync(join(tempHome, '.flt', 'routing', 'policy.yaml'))

    await expect(askMod.askOracle('hello?')).rejects.toThrow('Routing policy not found')
  })
})
