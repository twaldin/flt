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
