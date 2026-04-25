import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { createInterface } from 'readline'
import { homedir } from 'os'

interface PluginEntry {
  scope: string
  installPath: string
  version: string
  installedAt: string
  lastUpdated: string
  gitCommitSha?: string
}

interface InstalledPlugins {
  version: number
  plugins: Record<string, PluginEntry[]>
}

interface PluginInfo {
  name: string
  skillCount: number
  recommendation: 'keep' | 'remove' | 'review'
  rationale: string
}

const KEEP_SET = new Set(['skill-creator', 'claude-md-management'])
const REMOVE_SET = new Set(['gsd', 'hookify', 'ralph-loop', 'tmux-orchestrator', 'autoresearch', 'superpowers', 'code-review', 'feature-dev'])

const KEEP_RATIONALE: Record<string, string> = {
  'skill-creator': 'flagged: needed for authoring new skills',
  'claude-md-management': 'flagged: needed for CLAUDE.md authoring',
}

const REMOVE_RATIONALE: Record<string, string> = {
  'gsd': 'flagged: GSD productivity bundle, replaced by flt workflows',
  'hookify': 'flagged: hook authoring bundle, evaluate if still needed',
  'ralph-loop': 'flagged: Ralph Loop plugin, evaluate if still needed',
  'tmux-orchestrator': 'flagged: tmux orchestration bundle, replaced by flt',
  'autoresearch': 'flagged: autonomous research bundle, evaluate if still needed',
  'superpowers': 'flagged: superpowers skill bundle, evaluate if still needed',
  'code-review': 'flagged: code review bundle, evaluate if still needed',
  'feature-dev': 'flagged: feature development bundle, evaluate if still needed',
}

function countSkills(installPath: string): number {
  const skillsDir = join(installPath, 'skills')
  if (!existsSync(skillsDir)) return 0
  try {
    const result = execSync(`find "${skillsDir}" -name SKILL.md 2>/dev/null`, { encoding: 'utf-8' })
    return result.trim().split('\n').filter(Boolean).length
  } catch {
    return 0
  }
}

function loadPlugins(): PluginInfo[] | null {
  const jsonPath = join(homedir(), '.claude', 'plugins', 'installed_plugins.json')
  if (!existsSync(jsonPath)) return null

  const data = JSON.parse(readFileSync(jsonPath, 'utf-8')) as InstalledPlugins

  return Object.entries(data.plugins).map(([key, entries]) => {
    const name = key.split('@')[0]
    const installPath = entries[0]?.installPath ?? ''
    const skillCount = installPath ? countSkills(installPath) : 0

    let recommendation: 'keep' | 'remove' | 'review'
    let rationale: string

    if (KEEP_SET.has(name)) {
      recommendation = 'keep'
      rationale = KEEP_RATIONALE[name] ?? 'flagged: keep'
    } else if (REMOVE_SET.has(name)) {
      recommendation = 'remove'
      rationale = REMOVE_RATIONALE[name] ?? 'flagged: remove'
    } else {
      recommendation = 'review'
      rationale = 'not on either list — your call'
    }

    return { name, skillCount, recommendation, rationale }
  })
}

export function pluginAudit(_args: {}): void {
  const jsonPath = join(homedir(), '.claude', 'plugins', 'installed_plugins.json')
  if (!existsSync(jsonPath)) {
    console.log('No installed_plugins.json found — skipping audit.')
    return
  }

  const plugins = loadPlugins()!
  const today = new Date().toISOString().slice(0, 10)

  const rows = plugins.map(p =>
    `| ${p.name} | ${p.skillCount} | ${p.recommendation} | ${p.rationale} |`
  )

  const md = `# Plugin audit (${today})

| name | skills | recommendation | rationale |
|---|---|---|---|
${rows.join('\n')}

## Next step
Run \`flt plugin uninstall --confirm\` to interactively remove flagged plugins.
`

  writeFileSync(join(process.cwd(), 'plugin-audit.md'), md, 'utf-8')
  console.log(`Wrote plugin-audit.md (${plugins.length} plugins audited).`)
}

export async function pluginUninstall(args: { confirm: boolean }): Promise<void> {
  const jsonPath = join(homedir(), '.claude', 'plugins', 'installed_plugins.json')
  if (!existsSync(jsonPath)) {
    console.log('No installed_plugins.json found — nothing to uninstall.')
    return
  }

  const plugins = loadPlugins()!
  const toRemove = plugins.filter(p => p.recommendation === 'remove')

  if (toRemove.length === 0) {
    console.log('No plugins flagged for removal.')
    return
  }

  if (!args.confirm) {
    console.log('Run with --confirm to actually uninstall.')
    console.log('Would remove:')
    for (const p of toRemove) {
      console.log(`  - ${p.name}`)
    }
    return
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q: string): Promise<string> => new Promise(resolve => rl.question(q, resolve))

  let uninstalled = 0
  for (const p of toRemove) {
    const answer = await ask(`Uninstall ${p.name}? (y/N): `)
    if (answer.trim().toLowerCase() === 'y') {
      try {
        execSync(`claude plugin remove ${p.name}`, { stdio: 'inherit' })
        uninstalled++
      } catch (e) {
        console.error(`Error uninstalling ${p.name}: ${(e as Error).message}`)
      }
    }
  }

  rl.close()
  console.log(`Uninstalled ${uninstalled} plugins.`)
}
