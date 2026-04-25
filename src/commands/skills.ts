import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { createHash } from 'crypto'
import { loadSkills } from '../skills'

interface SkillsListArgs {
  agent?: string
  cli?: string
}

export function skillsList(args: SkillsListArgs): void {
  const { cli = '*' } = args
  const skills = loadSkills(cli)

  if (skills.length === 0) {
    console.log('No skills found.')
    return
  }

  const headers = ['name', 'description', 'source', 'path']
  const rows = skills.map(s => [
    s.name,
    s.description,
    s.source,
    s.path,
  ])

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => r[i].length))
  )

  const formatRow = (cols: string[]) =>
    cols.map((c, i) => c.padEnd(widths[i])).join('  ')

  console.log(formatRow(headers))
  console.log(widths.map(w => '-'.repeat(w)).join('  '))
  for (const row of rows) {
    console.log(formatRow(row))
  }
}

function home(): string {
  return process.env.HOME || require('os').homedir()
}

function parseFm(raw: string): { name?: string; description?: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n/)
  if (!match) return {}
  const frontmatter = match[1]
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m)
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m)
  return {
    name: nameMatch ? nameMatch[1].trim() : undefined,
    description: descMatch ? descMatch[1].trim() : undefined,
  }
}

function writeProvenance(dstDir: string, srcAbs: string, skillMdContent: string): void {
  const sha256 = createHash('sha256').update(skillMdContent).digest('hex')
  writeFileSync(
    join(dstDir, '.flt-source.json'),
    JSON.stringify({ source: srcAbs, copied_at: new Date().toISOString(), sha256 }, null, 2) + '\n',
    'utf-8',
  )
}

export function skillImport(args: { src: string }): void {
  const { src } = args
  const srcAbs = resolve(src)

  if (src.endsWith('.md')) {
    console.error('flt skill import requires a directory containing SKILL.md, not a flat .md file. Convert to canonical layout first.')
    process.exit(1)
  }

  if (!existsSync(srcAbs)) {
    console.error(`Error: "${src}" does not exist.`)
    process.exit(1)
  }

  if (!lstatSync(srcAbs).isDirectory()) {
    console.error('flt skill import requires a directory containing SKILL.md, not a flat .md file. Convert to canonical layout first.')
    process.exit(1)
  }

  const skillFile = join(srcAbs, 'SKILL.md')
  if (!existsSync(skillFile)) {
    console.error(`Error: No SKILL.md found in "${src}".`)
    process.exit(1)
  }

  const raw = readFileSync(skillFile, 'utf-8')
  const fm = parseFm(raw)

  if (!fm.name) {
    console.error('Error: SKILL.md is missing required frontmatter field: name')
    process.exit(1)
  }
  if (!fm.description) {
    console.error('Error: SKILL.md is missing required frontmatter field: description')
    process.exit(1)
  }

  const name = fm.name
  const skillsRoot = join(home(), '.flt', 'skills')
  mkdirSync(skillsRoot, { recursive: true })
  const dstDir = join(skillsRoot, name)

  if (existsSync(dstDir)) {
    console.log(`Skill "${name}" already imported (skipping).`)
    return
  }

  cpSync(srcAbs, dstDir, { recursive: true })
  writeProvenance(dstDir, srcAbs, raw)
  console.log(`Imported skill "${name}" from ${src}.`)
}

export function skillMoveFromClaude(_args: {}): void {
  const sourceDirs = [
    join(home(), '.claude', 'skills'),
    join(home(), '.claude', 'anthropic-skills', 'skills'),
  ]

  const skillsRoot = join(home(), '.flt', 'skills')
  mkdirSync(skillsRoot, { recursive: true })

  let moved = 0
  let skipped = 0

  for (const sourceDir of sourceDirs) {
    if (!existsSync(sourceDir)) continue

    let entries: string[]
    try {
      entries = readdirSync(sourceDir)
    } catch {
      continue
    }

    for (const entry of entries) {
      const entryPath = join(sourceDir, entry)
      const entryAbs = resolve(entryPath)
      try {
        // statSync follows symlinks; lstatSync did not — plugin-installed
        // skills like ~/.claude/skills/algorithmic-art are symlinks into
        // ~/.claude/anthropic-skills/skills/<name>, and must be treated as dirs.
        if (!statSync(entryPath).isDirectory()) continue
      } catch {
        continue
      }

      const skillFile = join(entryPath, 'SKILL.md')
      if (!existsSync(skillFile)) continue

      let name = entry
      let raw = ''
      try {
        raw = readFileSync(skillFile, 'utf-8')
        const fm = parseFm(raw)
        if (fm.name) name = fm.name
      } catch {
        // use directory name as fallback
      }

      const dstDir = join(skillsRoot, name)

      if (existsSync(dstDir)) {
        console.log(`skip ${name} (already imported)`)
        skipped++
        continue
      }

      // Symlink-aware copy: cpSync with dereference materializes the target
      // contents instead of duplicating the symlink. Then we unlink/rmSync the
      // source. For real directories rename is faster, but renameSync of a
      // symlink would keep the new path pointing back at the old location.
      const isSym = lstatSync(entryPath).isSymbolicLink()
      try {
        if (isSym) {
          cpSync(entryPath, dstDir, { recursive: true, dereference: true })
          rmSync(entryPath, { force: true })
        } else {
          renameSync(entryPath, dstDir)
        }
      } catch {
        cpSync(entryPath, dstDir, { recursive: true, dereference: true })
        rmSync(entryPath, { recursive: true, force: true })
      }

      if (raw) writeProvenance(dstDir, entryAbs, raw)
      moved++
    }
  }

  console.log(`moved ${moved} skills to ~/.flt/skills/, skipped ${skipped} (already imported)`)
}
