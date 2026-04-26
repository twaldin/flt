import { describe, expect, it } from 'bun:test'
import {
  dedupe,
  ghSlug,
  localSlug,
  matchesTaskShape,
  redact,
  renderAcceptance,
  renderSummary,
  stripTodos,
  type MdFile,
  type SummaryStats,
} from '../../scripts/harvest-gold-mine'

describe('matchesTaskShape', () => {
  it('matches task-shaped markdown files', () => {
    expect(matchesTaskShape('spec.md')).toBe(true)
    expect(matchesTaskShape('plan.md')).toBe(true)
    expect(matchesTaskShape('docs/design.md')).toBe(true)
    expect(matchesTaskShape('TODO.md')).toBe(true)
    expect(matchesTaskShape('TASKS.md')).toBe(true)
  })

  it('rejects non-task markdown files', () => {
    expect(matchesTaskShape('README.md')).toBe(false)
    expect(matchesTaskShape('CHANGELOG.md')).toBe(false)
    expect(matchesTaskShape('random-spec-notes.md')).toBe(false)
  })
})

describe('stripTodos', () => {
  it('strips only checkbox lines', () => {
    const input = [
      '# Plan',
      '- [ ] first todo',
      'narrative line',
      '  - [x] done todo',
      '- [X] upper todo',
      'inline [x] should remain',
      '',
    ].join('\n')

    const output = stripTodos(input)

    expect(output).toContain('# Plan')
    expect(output).toContain('narrative line')
    expect(output).toContain('inline [x] should remain')
    expect(output).not.toContain('first todo')
    expect(output).not.toContain('done todo')
    expect(output).not.toContain('upper todo')
  })
})

describe('redact', () => {
  it('redacts the required secret patterns and emails', () => {
    const input = [
      'ghp_abcdabcdabcdabcdabcdabcd',
      'github_pat_abcd_abcd_abcd_abcd_abcd_abcd',
      'AKIAABCDEFGHIJKLMNOP',
      'sk-abcdefghijklmnopqrstuvwx',
      'pk-abcdefghijklmnopqrstuvwx',
      'Bearer abcdefghijklmnopqrstuvwx',
      'API_KEY=supersecret',
      'AUTH_TOKEN: supersecret2',
      '/key/abcdefghijklmnop/',
      'other@example.com',
      'abcdefghijklmnopqrstuvwxabcdefghijklmnopqrstuvwx',
    ].join('\n')

    const result = redact(input, { allowEmails: new Set(['me@example.com']) })

    expect(result.redacted).toContain('<REDACTED:GITHUB_PAT>')
    expect(result.redacted).toContain('<REDACTED:AWS_KEY>')
    expect(result.redacted).toContain('<REDACTED:SK_KEY>')
    expect(result.redacted).toContain('<REDACTED:PK_KEY>')
    expect(result.redacted).toContain('Bearer <REDACTED>')
    expect(result.redacted).toContain('API_KEY=<REDACTED>')
    expect(result.redacted).toContain('AUTH_TOKEN=<REDACTED>')
    expect(result.redacted).toContain('/key/<REDACTED>/')
    expect(result.redacted).toContain('<REDACTED:EMAIL>')
    expect(result.redacted).toContain('<REDACTED:TOKEN>')
  })

  it('does not replace a 40-char hex SHA', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567'
    const result = redact(sha, { allowEmails: new Set() })
    expect(result.redacted).toBe(sha)
    expect(result.flags.some((flag) => flag.pattern === 'long-token(sha-guard)' && !flag.replaced)).toBe(true)
  })

  it('keeps allow-listed email and redacts others', () => {
    const input = 'me@example.com\nother@example.com\n'
    const result = redact(input, { allowEmails: new Set(['me@example.com']) })
    expect(result.redacted).toContain('me@example.com')
    expect(result.redacted).toContain('<REDACTED:EMAIL>')
  })

  it('flags matches with line numbers and excerpts', () => {
    const input = 'line1\nAPI_KEY=abc\nline3\n'
    const result = redact(input, { allowEmails: new Set() })
    expect(result.flags.length).toBeGreaterThan(0)
    expect(result.flags[0].line).toBe(2)
    expect(result.flags[0].excerpt).toContain('<REDACTED>')
  })
})

describe('slug helpers', () => {
  it('builds github slugs', () => {
    expect(ghSlug('flt', 'docs/v1-spec.md')).toBe('flt--docs-v1-spec')
  })

  it('builds local slugs', () => {
    expect(localSlug('/Users/twaldin/code/foo/spec.md', '/Users/twaldin')).toBe('code-foo-spec')
  })
})

describe('dedupe', () => {
  it('keeps highest depth; tie breaks by latest date', () => {
    const mk = (depth: number, date: string, repo: string): MdFile => ({
      source: 'github',
      repo,
      originalPath: 'spec.md',
      content: '# same',
      inHead: true,
      lastCommit: { sha: `${repo}-sha`, date, authorName: 'a', authorEmail: 'a@a.com', message: 'm' },
      commitDepth: depth,
      status: 'active',
      linkedPr: null,
    })

    const older = mk(3, '2024-01-01T00:00:00Z', 'older')
    const newer = mk(3, '2024-03-01T00:00:00Z', 'newer')
    const deeper = mk(5, '2023-01-01T00:00:00Z', 'deeper')
    const { kept, mergedCount } = dedupe([older, newer, deeper])

    expect(kept).toHaveLength(1)
    expect(kept[0]?.repo).toBe('deeper')
    expect(mergedCount).toBe(2)
  })
})

describe('renderAcceptance', () => {
  it('falls through to commit list with null pr', () => {
    const out = renderAcceptance(null, [
      {
        sha: '1234567890abcdef',
        date: '2024-01-01T00:00:00Z',
        authorName: 'Tim',
        authorEmail: 'tim@example.com',
        message: 'feat: add tests\n\nbody',
      },
    ])

    expect(out).toContain('Final commits')
    expect(out).toContain('1234567')
    expect(out).toContain('feat: add tests')
  })
})

describe('renderSummary', () => {
  it('renders stable markdown for fixed input', () => {
    const stats: SummaryStats = {
      reposScanned: 2,
      reposSkippedFork: 1,
      filesMatched: 7,
      fixturesWritten: 5,
      duplicatesMerged: 2,
      localFilesScanned: 3,
      localFixturesWritten: 2,
      topByLength: [{ slug: 'a', bytes: 99 }],
      topByDepth: [{ slug: 'a', commits: 10 }],
      suspectedLeaks: [],
    }

    const out = renderSummary(stats)

    expect(out).toContain('Repos scanned: 2')
    expect(out).toContain('GitHub files matched: 7')
    expect(out).toContain('- a: 99 bytes')
    expect(out).toContain('- a: 10 commits')
    expect(out).toContain('- none')
  })
})
