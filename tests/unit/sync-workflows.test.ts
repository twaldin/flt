import { createHash } from 'crypto'
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { detectStaleWorkflows, syncWorkflows } from '../../src/commands/sync-workflows'

function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function sha256Hex(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function writeSyncState(installDir: string, files: Record<string, string>): void {
  writeFileSync(join(installDir, '.sync-state.json'), JSON.stringify({ version: 1, files }, null, 2))
}

function readSyncState(installDir: string): { version: number; files: Record<string, string> } {
  return JSON.parse(readFileSync(join(installDir, '.sync-state.json'), 'utf-8')) as {
    version: number
    files: Record<string, string>
  }
}

describe('detectStaleWorkflows', () => {
  let tplDir: string
  let installDir: string

  beforeEach(() => {
    tplDir = makeTmpDir('flt-tpl-')
    installDir = makeTmpDir('flt-install-')
  })

  afterEach(() => {
    rmSync(tplDir, { recursive: true, force: true })
    rmSync(installDir, { recursive: true, force: true })
  })

  it('returns empty when installDir does not exist', () => {
    rmSync(installDir, { recursive: true, force: true })
    expect(detectStaleWorkflows({ tplDir, installDir })).toEqual([])
  })

  it('returns empty when tplDir does not exist', () => {
    rmSync(tplDir, { recursive: true, force: true })
    expect(detectStaleWorkflows({ tplDir, installDir })).toEqual([])
  })

  it('is silent when bundled, installed, and state hashes are identical', () => {
    const content = 'name: same\n'
    writeFileSync(join(tplDir, 'same.yaml'), content)
    writeFileSync(join(installDir, 'same.yaml'), content)
    writeSyncState(installDir, { 'same.yaml': sha256Hex(content) })

    expect(detectStaleWorkflows({ tplDir, installDir })).toEqual([])
  })

  it('is silent when user edited locally and bundled stayed stable', () => {
    const bundledContent = 'name: workflow\nversion: 1\n'
    writeFileSync(join(tplDir, 'workflow.yaml'), bundledContent)
    writeFileSync(join(installDir, 'workflow.yaml'), 'name: workflow\nversion: local\n')
    writeSyncState(installDir, { 'workflow.yaml': sha256Hex(bundledContent) })

    expect(detectStaleWorkflows({ tplDir, installDir })).toEqual([])
  })

  it('returns clean-update when only bundled content changed', () => {
    const lastSyncedContent = 'name: workflow\nversion: 1\n'
    const bundledContent = 'name: workflow\nversion: 2\n'
    const lastSyncHash = sha256Hex(lastSyncedContent)
    const bundledHash = sha256Hex(bundledContent)

    writeFileSync(join(tplDir, 'workflow.yaml'), bundledContent)
    writeFileSync(join(installDir, 'workflow.yaml'), lastSyncedContent)
    writeSyncState(installDir, { 'workflow.yaml': lastSyncHash })

    expect(detectStaleWorkflows({ tplDir, installDir })).toEqual([
      {
        file: 'workflow.yaml',
        kind: 'clean-update',
        bundledHash,
        installedHash: lastSyncHash,
        lastSyncHash,
      },
    ])
  })

  it('returns three-way-conflict when both installed and bundled changed since last sync', () => {
    const lastSyncedContent = 'name: workflow\nversion: 1\n'
    const bundledContent = 'name: workflow\nversion: 2\n'
    const installedContent = 'name: workflow\nversion: local\n'
    const lastSyncHash = sha256Hex(lastSyncedContent)
    const bundledHash = sha256Hex(bundledContent)
    const installedHash = sha256Hex(installedContent)

    writeFileSync(join(tplDir, 'workflow.yaml'), bundledContent)
    writeFileSync(join(installDir, 'workflow.yaml'), installedContent)
    writeSyncState(installDir, { 'workflow.yaml': lastSyncHash })

    expect(detectStaleWorkflows({ tplDir, installDir })).toEqual([
      {
        file: 'workflow.yaml',
        kind: 'three-way-conflict',
        bundledHash,
        installedHash,
        lastSyncHash,
      },
    ])
  })

  it('returns first-sync-needed when state is missing and installed differs from bundled', () => {
    const bundledContent = 'name: workflow\nversion: 2\n'
    const installedContent = 'name: workflow\nversion: local\n'

    writeFileSync(join(tplDir, 'workflow.yaml'), bundledContent)
    writeFileSync(join(installDir, 'workflow.yaml'), installedContent)

    expect(detectStaleWorkflows({ tplDir, installDir })).toEqual([
      {
        file: 'workflow.yaml',
        kind: 'first-sync-needed',
        bundledHash: sha256Hex(bundledContent),
        installedHash: sha256Hex(installedContent),
      },
    ])
  })

  it('is silent when state is missing and installed matches bundled', () => {
    const content = 'name: workflow\n'
    writeFileSync(join(tplDir, 'workflow.yaml'), content)
    writeFileSync(join(installDir, 'workflow.yaml'), content)

    expect(detectStaleWorkflows({ tplDir, installDir })).toEqual([])
  })

  it('skips template files not present in installDir', () => {
    writeFileSync(join(tplDir, 'new.yaml'), 'name: new\n')

    expect(detectStaleWorkflows({ tplDir, installDir })).toEqual([])
  })

  it('ignores non-yaml files in tplDir', () => {
    writeFileSync(join(tplDir, 'README.md'), 'docs\n')
    writeFileSync(join(installDir, 'README.md'), 'docs edited\n')

    expect(detectStaleWorkflows({ tplDir, installDir })).toEqual([])
  })
})

describe('syncWorkflows', () => {
  let tplDir: string
  let fltDir: string

  beforeEach(() => {
    tplDir = makeTmpDir('flt-sync-tpl-')
    fltDir = makeTmpDir('flt-sync-home-')
    mkdirSync(join(fltDir, 'workflows'), { recursive: true })
  })

  afterEach(() => {
    rmSync(tplDir, { recursive: true, force: true })
    rmSync(fltDir, { recursive: true, force: true })
  })

  it('copies a new template that is not yet installed', async () => {
    writeFileSync(join(tplDir, 'new.yaml'), 'name: new\n')

    await syncWorkflows({ force: true, tplDir, fltDir })

    expect(existsSync(join(fltDir, 'workflows', 'new.yaml'))).toBe(true)
    expect(readFileSync(join(fltDir, 'workflows', 'new.yaml'), 'utf-8')).toBe('name: new\n')
  })

  it('skips identical files without overwriting', async () => {
    writeFileSync(join(tplDir, 'same.yaml'), 'name: same\n')
    writeFileSync(join(fltDir, 'workflows', 'same.yaml'), 'name: same\n')

    await syncWorkflows({ force: true, tplDir, fltDir })

    expect(readFileSync(join(fltDir, 'workflows', 'same.yaml'), 'utf-8')).toBe('name: same\n')
  })

  it('overwrites changed file when --force is set', async () => {
    writeFileSync(join(tplDir, 'changed.yaml'), 'name: changed\nversion: 2\n')
    writeFileSync(join(fltDir, 'workflows', 'changed.yaml'), 'name: changed\nversion: 1\n')

    await syncWorkflows({ force: true, tplDir, fltDir })

    expect(readFileSync(join(fltDir, 'workflows', 'changed.yaml'), 'utf-8')).toBe('name: changed\nversion: 2\n')
  })

  it('creates the workflows dir if it does not exist', async () => {
    rmSync(join(fltDir, 'workflows'), { recursive: true, force: true })
    writeFileSync(join(tplDir, 'new.yaml'), 'name: new\n')

    await syncWorkflows({ force: true, tplDir, fltDir })

    expect(existsSync(join(fltDir, 'workflows', 'new.yaml'))).toBe(true)
  })

  it('only processes .yaml and .yml files', async () => {
    writeFileSync(join(tplDir, 'template.yaml'), 'name: template\n')
    writeFileSync(join(tplDir, 'README.md'), 'docs\n')

    await syncWorkflows({ force: true, tplDir, fltDir })

    expect(existsSync(join(fltDir, 'workflows', 'template.yaml'))).toBe(true)
    expect(existsSync(join(fltDir, 'workflows', 'README.md'))).toBe(false)
  })

  it('updates sync state after force-sync', async () => {
    const bundledContent = 'name: changed\nversion: 2\n'
    writeFileSync(join(tplDir, 'changed.yaml'), bundledContent)
    writeFileSync(join(fltDir, 'workflows', 'changed.yaml'), 'name: changed\nversion: 1\n')

    await syncWorkflows({ force: true, tplDir, fltDir })

    expect(readSyncState(join(fltDir, 'workflows')).files['changed.yaml']).toBe(sha256Hex(bundledContent))
  })

  it('does not update sync state when overwrite is declined', async () => {
    const previousHash = sha256Hex('name: changed\nversion: 1\n')
    writeFileSync(join(tplDir, 'changed.yaml'), 'name: changed\nversion: 2\n')
    writeFileSync(join(fltDir, 'workflows', 'changed.yaml'), 'name: changed\nversion: local\n')
    writeSyncState(join(fltDir, 'workflows'), { 'changed.yaml': previousHash })

    await syncWorkflows({ tplDir, fltDir, ask: async () => 'n' })

    expect(readSyncState(join(fltDir, 'workflows')).files['changed.yaml']).toBe(previousHash)
  })
})
