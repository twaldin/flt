import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  statSync,
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'
import {
  installHooks,
  uninstallHooks,
  writeFltManifest,
  readFltManifest,
  type FltManifest,
} from '../../src/hooks/git-hooks'

function initGitRepo(dir: string): void {
  execSync('git init -q', { cwd: dir })
  execSync('git config user.email "test@test.com"', { cwd: dir })
  execSync('git config user.name "Test"', { cwd: dir })
}

function stageFile(dir: string, relPath: string, content: string): void {
  const full = join(dir, relPath)
  const parentDir = join(full, '..')
  mkdirSync(parentDir, { recursive: true })
  writeFileSync(full, content)
  execSync(`git add -f -- "${relPath}"`, { cwd: dir })
}

function stagedContent(dir: string, relPath: string): string {
  return execSync(`git show :${relPath}`, { cwd: dir }).toString()
}

function isStagedFile(dir: string, relPath: string): boolean {
  try {
    execSync(`git ls-files --error-unmatch --cached -- "${relPath}"`, { cwd: dir })
    return true
  } catch {
    return false
  }
}

describe('FltManifest read/write', () => {
  let workDir: string

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'flt-hooks-test-'))
    mkdirSync(join(workDir, '.flt'), { recursive: true })
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it('round-trips a manifest', () => {
    const manifest: FltManifest = {
      fltOnlyFiles: ['.flt/bootstrap.md', '.claude/skills/foo/SKILL.md'],
      fltModifiedFiles: ['CLAUDE.md'],
    }
    writeFltManifest(workDir, manifest)
    const read = readFltManifest(workDir)
    expect(read).toEqual(manifest)
  })

  it('readFltManifest returns empty arrays when file does not exist', () => {
    const manifest = readFltManifest(workDir)
    expect(manifest.fltOnlyFiles).toEqual([])
    expect(manifest.fltModifiedFiles).toEqual([])
  })

  it('writeFltManifest creates .flt dir if missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flt-hooks-nodir-'))
    try {
      writeFltManifest(dir, { fltOnlyFiles: [], fltModifiedFiles: ['CLAUDE.md'] })
      expect(existsSync(join(dir, '.flt', 'manifest.json'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('installHooks', () => {
  let workDir: string

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'flt-hooks-test-'))
    initGitRepo(workDir)
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it('writes executable pre-commit hook', () => {
    installHooks(workDir)
    const hookPath = join(workDir, '.git', 'hooks', 'pre-commit')
    expect(existsSync(hookPath)).toBe(true)
    const mode = statSync(hookPath).mode
    expect(mode & 0o111).toBeGreaterThan(0)
  })

  it('writes executable pre-push hook', () => {
    installHooks(workDir)
    const hookPath = join(workDir, '.git', 'hooks', 'pre-push')
    expect(existsSync(hookPath)).toBe(true)
    const mode = statSync(hookPath).mode
    expect(mode & 0o111).toBeGreaterThan(0)
  })

  it('is idempotent — calling twice does not double-install', () => {
    installHooks(workDir)
    const firstContent = readFileSync(join(workDir, '.git', 'hooks', 'pre-commit'), 'utf-8')
    installHooks(workDir)
    const secondContent = readFileSync(join(workDir, '.git', 'hooks', 'pre-commit'), 'utf-8')
    expect(firstContent).toBe(secondContent)
    // user chain hook must not exist (no original hook to chain)
    expect(existsSync(join(workDir, '.git', 'hooks', 'pre-commit.user'))).toBe(false)
  })

  it('chains existing user hook — renames to pre-commit.user', () => {
    const userHookPath = join(workDir, '.git', 'hooks', 'pre-commit')
    writeFileSync(userHookPath, '#!/bin/bash\necho "user hook"\n')
    execSync(`chmod +x "${userHookPath}"`)

    installHooks(workDir)

    expect(existsSync(join(workDir, '.git', 'hooks', 'pre-commit.user'))).toBe(true)
    const userContent = readFileSync(join(workDir, '.git', 'hooks', 'pre-commit.user'), 'utf-8')
    expect(userContent).toContain('user hook')

    const fltContent = readFileSync(join(workDir, '.git', 'hooks', 'pre-commit'), 'utf-8')
    expect(fltContent).toContain('flt-managed-hook')
  })

  it('does not rename existing hook a second time (idempotent with user hook)', () => {
    const userHookPath = join(workDir, '.git', 'hooks', 'pre-commit')
    writeFileSync(userHookPath, '#!/bin/bash\necho "user hook"\n')
    execSync(`chmod +x "${userHookPath}"`)

    installHooks(workDir)
    installHooks(workDir)

    // Only one .user file — not renamed again
    expect(existsSync(join(workDir, '.git', 'hooks', 'pre-commit.user'))).toBe(true)
    expect(existsSync(join(workDir, '.git', 'hooks', 'pre-commit.user.user'))).toBe(false)
  })
})

describe('uninstallHooks', () => {
  let workDir: string

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'flt-hooks-test-'))
    initGitRepo(workDir)
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it('removes flt hooks', () => {
    installHooks(workDir)
    uninstallHooks(workDir)
    expect(existsSync(join(workDir, '.git', 'hooks', 'pre-commit'))).toBe(false)
    expect(existsSync(join(workDir, '.git', 'hooks', 'pre-push'))).toBe(false)
  })

  it('restores user hook after uninstall', () => {
    const userHookPath = join(workDir, '.git', 'hooks', 'pre-commit')
    writeFileSync(userHookPath, '#!/bin/bash\necho "user hook"\n')
    execSync(`chmod +x "${userHookPath}"`)

    installHooks(workDir)
    uninstallHooks(workDir)

    expect(existsSync(join(workDir, '.git', 'hooks', 'pre-commit'))).toBe(true)
    const restored = readFileSync(join(workDir, '.git', 'hooks', 'pre-commit'), 'utf-8')
    expect(restored).toContain('user hook')
    expect(existsSync(join(workDir, '.git', 'hooks', 'pre-commit.user'))).toBe(false)
  })

  it('is a no-op when hooks were never installed', () => {
    expect(() => uninstallHooks(workDir)).not.toThrow()
  })
})

describe('pre-commit hook execution', () => {
  let workDir: string

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'flt-hooks-exec-'))
    initGitRepo(workDir)
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it('strips flt block from staged instruction file', () => {
    const claudeMd = `# My Project\n\n<!-- flt:start -->\n# Fleet Agent\nSome flt content\n<!-- flt:end -->\n\n## User section\nUser content here.\n`
    stageFile(workDir, 'CLAUDE.md', claudeMd)

    writeFltManifest(workDir, {
      fltOnlyFiles: [],
      fltModifiedFiles: ['CLAUDE.md'],
    })
    installHooks(workDir)

    execSync('bash .git/hooks/pre-commit', { cwd: workDir })

    const staged = stagedContent(workDir, 'CLAUDE.md')
    expect(staged).not.toContain('<!-- flt:start -->')
    expect(staged).not.toContain('<!-- flt:end -->')
    expect(staged).not.toContain('Fleet Agent')
    expect(staged).toContain('# My Project')
    expect(staged).toContain('User content here.')
  })

  it('removes flt-only files from the index', () => {
    stageFile(workDir, '.flt/bootstrap.md', 'Read this file.')
    stageFile(workDir, 'README.md', '# project')

    writeFltManifest(workDir, {
      fltOnlyFiles: ['.flt/bootstrap.md'],
      fltModifiedFiles: [],
    })
    installHooks(workDir)

    execSync('bash .git/hooks/pre-commit', { cwd: workDir })

    expect(isStagedFile(workDir, '.flt/bootstrap.md')).toBe(false)
    expect(isStagedFile(workDir, 'README.md')).toBe(true)
  })

  it('chains to user hook when present', () => {
    const userHookPath = join(workDir, '.git', 'hooks', 'pre-commit')
    const sentinel = join(workDir, '.flt', 'user-hook-ran')
    mkdirSync(join(workDir, '.flt'), { recursive: true })
    writeFileSync(userHookPath, `#!/bin/bash\ntouch "${sentinel}"\n`)
    execSync(`chmod +x "${userHookPath}"`)

    writeFltManifest(workDir, { fltOnlyFiles: [], fltModifiedFiles: [] })
    installHooks(workDir)

    execSync('bash .git/hooks/pre-commit', { cwd: workDir })

    expect(existsSync(sentinel)).toBe(true)
  })
})
