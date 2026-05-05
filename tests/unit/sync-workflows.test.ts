import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync, utimesSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { detectStaleWorkflows, syncWorkflows } from '../../src/commands/sync-workflows'

function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
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

  it('returns empty when all installed files are newer than templates', () => {
    const old = new Date(Date.now() - 10_000)
    const now = new Date()

    writeFileSync(join(tplDir, 'foo.yaml'), 'name: foo\n')
    utimesSync(join(tplDir, 'foo.yaml'), old, old)

    writeFileSync(join(installDir, 'foo.yaml'), 'name: foo\n')
    utimesSync(join(installDir, 'foo.yaml'), now, now)

    expect(detectStaleWorkflows({ tplDir, installDir })).toEqual([])
  })

  it('returns stale entry when template is newer than installed file', () => {
    const old = new Date(Date.now() - 10_000)
    const now = new Date()

    writeFileSync(join(tplDir, 'bar.yaml'), 'name: bar\n')
    utimesSync(join(tplDir, 'bar.yaml'), now, now)

    writeFileSync(join(installDir, 'bar.yaml'), 'name: bar\n')
    utimesSync(join(installDir, 'bar.yaml'), old, old)

    const stale = detectStaleWorkflows({ tplDir, installDir })
    expect(stale).toHaveLength(1)
    expect(stale[0].file).toBe('bar.yaml')
    expect(stale[0].templateMtimeMs).toBeGreaterThan(stale[0].installedMtimeMs)
  })

  it('skips template files not present in installDir', () => {
    writeFileSync(join(tplDir, 'new.yaml'), 'name: new\n')
    // installDir has no new.yaml

    expect(detectStaleWorkflows({ tplDir, installDir })).toEqual([])
  })

  it('ignores non-yaml files in tplDir', () => {
    const old = new Date(Date.now() - 10_000)
    const now = new Date()

    writeFileSync(join(tplDir, 'README.md'), 'docs\n')
    utimesSync(join(tplDir, 'README.md'), now, now)

    writeFileSync(join(installDir, 'README.md'), 'docs\n')
    utimesSync(join(installDir, 'README.md'), old, old)

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

    // Content unchanged — still the identical file
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
})
