import { describe, it, expect } from 'bun:test'
import { execFileSync, spawnSync } from 'child_process'
import { join, resolve } from 'path'

const REPO_ROOT = resolve(join(import.meta.dir, '../..'))
const SCRIPT = join(REPO_ROOT, 'scripts', 'tui-pilot.sh')

function tuistoryAvailable(): boolean {
  try {
    execFileSync('tuistory', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function tctlAvailable(): boolean {
  const tctlPath = `${process.env.HOME}/.factory/plugins/marketplaces/factory-plugins/plugins/droid-control/bin/tctl`
  try {
    execFileSync('test', ['-x', tctlPath], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const toolsAvailable = tuistoryAvailable() && tctlAvailable()
const SKIP_REASON = 'tuistory or tctl not available — install with: bun add -g tuistory (and ensure droid-control plugin is present)'

describe('tui-pilot smoke test', () => {
  it.skipIf(!toolsAvailable)(
    'scripts/tui-pilot.sh smoke exits 0 and prints expected TUI chrome',
    () => {
      const result = spawnSync('bash', [SCRIPT, 'smoke'], {
        timeout: 60_000,
        encoding: 'utf-8',
      })

      // Combined stderr output contains the snapshot and PASS/FAIL verdict.
      const output = (result.stdout ?? '') + (result.stderr ?? '')

      expect(result.status).toBe(0)
      expect(output).toContain('tui-pilot smoke: PASS')
      expect(output).toContain('No agents running.')
    }
  )
})
