import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promote } from '../../src/commands/promote'

function writeEvidence(home: string, runId: string, scores: Record<string, number>): void {
  const runDir = join(home, '.flt', 'runs', runId)
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(runDir, 'metrics.json'), JSON.stringify({ scores }, null, 2) + '\n')
}

describe('promote', () => {
  let home = ''
  let root = ''
  let prevHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'flt-promote-home-'))
    root = mkdtempSync(join(tmpdir(), 'flt-promote-root-'))
    prevHome = process.env.HOME
    process.env.HOME = home
    mkdirSync(join(home, '.flt', 'runs'), { recursive: true })
    mkdirSync(join(root, 'experiments'), { recursive: true })
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    rmSync(home, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  })

  it('promotes candidate, writes archive/changelog/sidecar', () => {
    const stablePath = join(root, 'artifact.md')
    const candidatePath = join(root, 'experiments', 'artifact.vNext.md')

    writeFileSync(stablePath, 'old stable body\n')
    writeFileSync(`${stablePath}.metrics.json`, JSON.stringify({ scores: { tests: 0.8, lint: 0.5 } }, null, 2) + '\n')
    writeFileSync(
      candidatePath,
      [
        '---',
        `stable_path: ${stablePath}`,
        'mutation_type: prompt_edit',
        '---',
        'new stable body SENTINEL',
        '',
      ].join('\n'),
    )

    writeEvidence(home, 'run-a', { tests: 0.85, lint: 0.52 })
    writeEvidence(home, 'run-b', { tests: 0.9, lint: 0.51 })

    const result = promote({
      candidate: candidatePath,
      evidenceRunIds: ['run-a', 'run-b'],
    })

    expect(result.firstPromotion).toBe(false)
    expect(readFileSync(stablePath, 'utf-8')).toContain('SENTINEL')

    const archivePath = join(root, 'archive', 'artifact.v1.md')
    expect(result.archivePath).toBe(archivePath)
    expect(existsSync(archivePath)).toBe(true)
    expect(readFileSync(archivePath, 'utf-8')).toBe('old stable body\n')

    const changelog = readFileSync(`${stablePath}.changelog.md`, 'utf-8')
    expect(changelog).toContain('run-ids: run-a,run-b')
    expect(changelog).toContain('tests: 0.8 → 0.9')

    const sidecar = JSON.parse(readFileSync(`${stablePath}.metrics.json`, 'utf-8')) as { scores: Record<string, number> }
    expect(sidecar.scores.tests).toBe(0.9)
    expect(sidecar.scores.lint).toBe(0.52)
  })

  it('throws when candidate front-matter is missing stable_path', () => {
    const candidatePath = join(root, 'experiments', 'artifact.vNext.md')
    writeFileSync(candidatePath, 'no front matter\n')
    writeEvidence(home, 'run-a', { tests: 0.9 })

    expect(() => promote({ candidate: candidatePath, evidenceRunIds: ['run-a'] })).toThrow(/stable_path required/)
  })

  it('throws when evidence metrics.json is missing', () => {
    const stablePath = join(root, 'artifact.md')
    const candidatePath = join(root, 'experiments', 'artifact.vNext.md')

    writeFileSync(stablePath, 'old\n')
    writeFileSync(`${stablePath}.metrics.json`, JSON.stringify({ scores: { tests: 0.5 } }, null, 2) + '\n')
    writeFileSync(candidatePath, `---\nstable_path: ${stablePath}\nmutation_type: prompt_edit\n---\nnew\n`)

    expect(() => promote({ candidate: candidatePath, evidenceRunIds: ['missing-run'] })).toThrow(/metrics.json not found/)
  })

  it('throws when evidence shows no score improvement', () => {
    const stablePath = join(root, 'artifact.md')
    const candidatePath = join(root, 'experiments', 'artifact.vNext.md')

    writeFileSync(stablePath, 'old\n')
    writeFileSync(`${stablePath}.metrics.json`, JSON.stringify({ scores: { tests: 0.95 } }, null, 2) + '\n')
    writeFileSync(candidatePath, `---\nstable_path: ${stablePath}\nmutation_type: prompt_edit\n---\nnew\n`)
    writeEvidence(home, 'run-a', { tests: 0.8 })

    expect(() => promote({ candidate: candidatePath, evidenceRunIds: ['run-a'] })).toThrow(/no score improvement/)
    expect(readFileSync(stablePath, 'utf-8')).toBe('old\n')
  })

  it('first promotion warns and succeeds without stable sidecar', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})

    const stablePath = join(root, 'artifact.md')
    const candidatePath = join(root, 'experiments', 'artifact.vNext.md')

    writeFileSync(stablePath, 'old\n')
    writeFileSync(candidatePath, `---\nstable_path: ${stablePath}\nmutation_type: skill_acquisition\n---\nnew\n`)
    writeEvidence(home, 'run-a', { tests: 0.6, e2e: 0.7 })

    const result = promote({ candidate: candidatePath, evidenceRunIds: ['run-a'] })
    expect(result.firstPromotion).toBe(true)
    expect(warn).toHaveBeenCalled()
    expect(readFileSync(stablePath, 'utf-8')).toBe('new\n')
    const sidecar = JSON.parse(readFileSync(`${stablePath}.metrics.json`, 'utf-8')) as { scores: Record<string, number> }
    expect(sidecar.scores).toEqual({ tests: 0.6, e2e: 0.7 })
  })
})
