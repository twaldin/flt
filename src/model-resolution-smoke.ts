// Empirical smoke check for (cli, model) pairs.
// Spawns `<cli> --model <translated> --version` (or --help) and asserts the
// CLI accepts the model arg. Result is cached at ~/.flt/model-smoke-cache.json
// so repeated checks (route check, future spawn gating) are cheap.

import { spawn as nodeSpawn } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { homedir } from 'os'
import { resolveAdapter, listAdapters } from './adapters/registry'

export interface SmokeResult {
  ok: boolean
  exitCode: number
  durationMs: number
  stderr?: string
  reason?: string
}

interface CacheEntry extends SmokeResult {
  cli: string
  model: string
  checkedAt: number
}

interface SmokeCache {
  entries: Record<string, CacheEntry>
}

const TTL_MS = 24 * 60 * 60 * 1000  // 24h
const SMOKE_TIMEOUT_MS = 5000

// Per-CLI smoke recipe: (program, argv) to spawn for "is this model accepted?".
// Most CLIs validate --model at --help / --version. CLIs that need a wrapper
// (e.g. pi needs nvm use 22 because it uses Unicode /v regex on node ≥22)
// override the program field. null = CLI cannot be smoked safely; return inconclusive.
type SmokeRecipe = { program: string; args: string[] }
type SmokeRecipeBuilder = (model: string, binary: string) => SmokeRecipe | null

function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

function piSmoke(model: string): SmokeRecipe {
  // Mirror src/adapters/pi.ts: nvm use 22 then pi --model X --help.
  const script = [
    'if [ -s "$HOME/.nvm/nvm.sh" ]; then',
    'source "$HOME/.nvm/nvm.sh" && nvm use 22 >/dev/null;',
    'fi;',
    `pi --model ${shSingleQuote(model)} --help`,
  ].join(' ')
  return { program: 'bash', args: ['-lc', script] }
}

const SMOKE_RECIPES: Record<string, SmokeRecipeBuilder> = {
  'claude-code': (m, bin) => ({ program: bin, args: ['--model', m, '--version'] }),
  'codex': (m, bin) => ({ program: bin, args: ['--model', m, '--help'] }),
  'gemini': (m, bin) => ({ program: bin, args: ['--model', m, '--help'] }),
  'aider': (m, bin) => ({ program: bin, args: ['--model', m, '--help'] }),
  'opencode': (m, bin) => ({ program: bin, args: ['--model', m, '--help'] }),
  'swe-agent': (m, bin) => ({ program: bin, args: ['--model', m, '--help'] }),
  'pi': (m) => piSmoke(m),
  'continue-cli': (m, bin) => ({ program: bin, args: ['--model', m, '--help'] }),
  'crush': (m, bin) => ({ program: bin, args: ['--model', m, '--help'] }),
  'droid': (m, bin) => ({ program: bin, args: ['--model', m, '--help'] }),
  'openclaude': (m, bin) => ({ program: bin, args: ['--model', m, '--help'] }),
  'qwen': (m, bin) => ({ program: bin, args: ['--model', m, '--help'] }),
  'kilo': (m, bin) => ({ program: bin, args: ['--model', m, '--help'] }),
}

// Strings in stderr that mean "model rejected" (definitive fail vs. inconclusive).
const REJECTION_PATTERNS = [
  /unknown model/i,
  /invalid model/i,
  /model not found/i,
  /unsupported model/i,
  /no such model/i,
  /unrecognized model/i,
]

function fltHome(): string {
  return join(process.env.HOME || homedir(), '.flt')
}

function cachePath(): string {
  return join(fltHome(), 'model-smoke-cache.json')
}

function cacheKey(cli: string, model: string): string {
  return `${cli}::${model}`
}

function loadCache(): SmokeCache {
  const path = cachePath()
  if (!existsSync(path)) return { entries: {} }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as SmokeCache
    if (!parsed.entries) return { entries: {} }
    return parsed
  } catch {
    return { entries: {} }
  }
}

function saveCache(cache: SmokeCache): void {
  const path = cachePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(cache, null, 2))
}

function binaryName(cli: string): string {
  try {
    const adapter = resolveAdapter(cli)
    if (adapter.cliCommand) return adapter.cliCommand
  } catch {
    // Unknown adapter — caller shouldn't reach this, but fall through.
  }
  return cli
}

export interface SmokeOptions {
  cli: string
  model: string
  timeoutMs?: number
}

export async function smokeModel(opts: SmokeOptions): Promise<SmokeResult> {
  const { cli, model, timeoutMs = SMOKE_TIMEOUT_MS } = opts
  const recipeBuilder = SMOKE_RECIPES[cli]
  if (!recipeBuilder) {
    return {
      ok: false,
      exitCode: -1,
      durationMs: 0,
      reason: `no smoke recipe for cli "${cli}"`,
    }
  }
  const bin = binaryName(cli)
  const recipe = recipeBuilder(model, bin)
  if (recipe === null) {
    return {
      ok: false,
      exitCode: -1,
      durationMs: 0,
      reason: `cli "${cli}" cannot be smoked safely`,
    }
  }

  const start = Date.now()

  return new Promise<SmokeResult>((resolve) => {
    let stderr = ''
    let stdout = ''
    let settled = false
    const child = nodeSpawn(recipe.program, recipe.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill('SIGKILL') } catch { /* already dead */ }
      resolve({
        ok: false,
        exitCode: -1,
        durationMs: Date.now() - start,
        stderr: stderr.slice(-500),
        reason: `timeout after ${timeoutMs}ms`,
      })
    }, timeoutMs)

    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString() })

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const msg = (err as NodeJS.ErrnoException).code === 'ENOENT'
        ? `binary "${recipe.program}" not found on PATH`
        : err.message
      resolve({
        ok: false,
        exitCode: -1,
        durationMs: Date.now() - start,
        reason: msg,
      })
    })

    child.on('exit', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const exitCode = code ?? -1
      const durationMs = Date.now() - start
      const combined = stderr + stdout
      const rejected = REJECTION_PATTERNS.some((re) => re.test(combined))
      if (exitCode === 0 && !rejected) {
        resolve({ ok: true, exitCode, durationMs })
      } else if (rejected) {
        resolve({
          ok: false,
          exitCode,
          durationMs,
          stderr: stderr.slice(-500),
          reason: 'model rejected by cli',
        })
      } else {
        resolve({
          ok: false,
          exitCode,
          durationMs,
          stderr: stderr.slice(-500),
          reason: `non-zero exit (${exitCode})`,
        })
      }
    })
  })
}

export interface CachedSmokeOptions extends SmokeOptions {
  force?: boolean
}

export async function smokeModelCached(opts: CachedSmokeOptions): Promise<SmokeResult> {
  const { cli, model, force = false } = opts
  const cache = loadCache()
  const key = cacheKey(cli, model)
  const hit = cache.entries[key]
  if (!force && hit && Date.now() - hit.checkedAt < TTL_MS) {
    return {
      ok: hit.ok,
      exitCode: hit.exitCode,
      durationMs: hit.durationMs,
      stderr: hit.stderr,
      reason: hit.reason ? `${hit.reason} (cached)` : 'cached',
    }
  }
  const result = await smokeModel(opts)
  cache.entries[key] = {
    cli,
    model,
    checkedAt: Date.now(),
    ...result,
  }
  saveCache(cache)
  return result
}

export function clearSmokeCache(): void {
  saveCache({ entries: {} })
}

export function knownSmokeAdapters(): string[] {
  return listAdapters().filter((a) => a in SMOKE_RECIPES)
}
