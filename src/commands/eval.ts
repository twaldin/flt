import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'fs'
import { execFileSync } from 'child_process'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { startWorkflow } from '../workflow/engine'

export interface EvalFixture {
  name: string
  path: string
  taskType: string
  repoSource: 'snapshot' | 'clone-cmd'
  workflow: string
}

function defaultRoot(): string {
  try {
    const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim()
    return join(repoRoot, 'tests', 'eval')
  } catch {
    return join(process.cwd(), 'tests', 'eval')
  }
}

function readFixtureWorkflow(fixturePath: string): string {
  const configPath = join(fixturePath, 'config.json')
  if (!existsSync(configPath)) return 'idea-to-pr'
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as { workflow?: unknown }
    return typeof parsed.workflow === 'string' && parsed.workflow.trim().length > 0
      ? parsed.workflow
      : 'idea-to-pr'
  } catch {
    return 'idea-to-pr'
  }
}

function taskTypeFromName(name: string): string {
  const parts = name.split('-')
  if (parts.length >= 2) return `${parts[0]}-${parts[1]}`
  return parts[0] ?? 'unknown'
}

function copyDirContents(sourceDir: string, targetDir: string): void {
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    cpSync(join(sourceDir, entry.name), join(targetDir, entry.name), { recursive: true })
  }
}

export function listEvalFixtures(opts?: { root?: string }): EvalFixture[] {
  const root = resolve(opts?.root ?? defaultRoot())
  if (!existsSync(root)) return []

  const fixtures: EvalFixture[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const fixturePath = join(root, entry.name)
    const taskPath = join(fixturePath, 'task.md')
    const acceptancePath = join(fixturePath, 'acceptance.md')
    if (!existsSync(taskPath) || !existsSync(acceptancePath)) continue

    const cloneCmdPath = join(fixturePath, 'repo-clone-cmd.sh')
    const snapshotPath = join(fixturePath, 'repo-snapshot')

    const hasCloneCmd = existsSync(cloneCmdPath) && statSync(cloneCmdPath).isFile()
    const hasSnapshot = existsSync(snapshotPath) && statSync(snapshotPath).isDirectory()

    if (!hasCloneCmd && !hasSnapshot) continue

    fixtures.push({
      name: entry.name,
      path: fixturePath,
      taskType: taskTypeFromName(entry.name),
      repoSource: hasCloneCmd ? 'clone-cmd' : 'snapshot',
      workflow: readFixtureWorkflow(fixturePath),
    })
  }

  fixtures.sort((a, b) => a.name.localeCompare(b.name))
  return fixtures
}

export function evalSuiteList(opts?: { root?: string }): void {
  const fixtures = listEvalFixtures(opts)
  if (fixtures.length === 0) {
    console.log('No eval fixtures found.')
    return
  }

  const headers = ['NAME', 'TYPE', 'SOURCE']
  const rows = fixtures.map(f => [f.name, f.taskType, f.repoSource])
  const widths = headers.map((header, i) => Math.max(header.length, ...rows.map(row => row[i].length)))
  const formatRow = (row: string[]) => row.map((cell, i) => cell.padEnd(widths[i])).join('  ')

  console.log(formatRow(headers))
  console.log(widths.map(w => '-'.repeat(w)).join('  '))
  for (const row of rows) {
    console.log(formatRow(row))
  }
}

export async function evalSuiteRun(
  name: string,
  opts?: { root?: string; parent?: string; workflow?: string },
): Promise<void> {
  const fixtures = listEvalFixtures({ root: opts?.root })
  const fixture = fixtures.find(f => f.name === name)
  if (!fixture) throw new Error(`Unknown eval fixture: ${name}`)

  const tempDir = mkdtempSync(join(tmpdir(), `flt-eval-${name}-`))

  if (fixture.repoSource === 'clone-cmd') {
    execFileSync(join(fixture.path, 'repo-clone-cmd.sh'), {
      cwd: tempDir,
      stdio: 'inherit',
      timeout: 120_000,
    })
  } else {
    copyDirContents(join(fixture.path, 'repo-snapshot'), tempDir)
  }

  const task = readFileSync(join(fixture.path, 'task.md'), 'utf-8')
  const workflow = opts?.workflow ?? fixture.workflow

  const run = await startWorkflow(workflow, {
    task,
    dir: tempDir,
    parent: opts?.parent ?? 'human',
    slug: name,
  })

  console.log(run.id)
}
