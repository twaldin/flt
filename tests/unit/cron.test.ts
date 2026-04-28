import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  intervalToCron,
  cronToHuman,
  parseTimeout,
  parseCrontabLines,
  generateScript,
  cronPeriodMs,
  cronAddWorkflow,
} from '../../src/commands/cron'

// ── intervalToCron ───────────────────────────────────────────────────────────

describe('intervalToCron', () => {
  it('converts minute intervals', () => {
    expect(intervalToCron('30m')).toBe('*/30 * * * *')
    expect(intervalToCron('15m')).toBe('*/15 * * * *')
    expect(intervalToCron('5m')).toBe('*/5 * * * *')
    expect(intervalToCron('1m')).toBe('*/1 * * * *')
  })

  it('converts hour intervals', () => {
    expect(intervalToCron('1h')).toBe('0 */1 * * *')
    expect(intervalToCron('2h')).toBe('0 */2 * * *')
    expect(intervalToCron('6h')).toBe('0 */6 * * *')
    expect(intervalToCron('12h')).toBe('0 */12 * * *')
    expect(intervalToCron('24h')).toBe('0 0 * * *')
  })

  it('converts day interval', () => {
    expect(intervalToCron('1d')).toBe('0 0 * * *')
  })

  it('throws on invalid format', () => {
    expect(() => intervalToCron('30')).toThrow('Invalid interval')
    expect(() => intervalToCron('30s')).toThrow('Invalid interval')
    expect(() => intervalToCron('abc')).toThrow('Invalid interval')
    expect(() => intervalToCron('')).toThrow('Invalid interval')
  })

  it('throws on non-divisible minute intervals', () => {
    expect(() => intervalToCron('7m')).toThrow('divide evenly')
    expect(() => intervalToCron('11m')).toThrow('divide evenly')
  })

  it('throws on non-divisible hour intervals', () => {
    expect(() => intervalToCron('5h')).toThrow('divide evenly')
    expect(() => intervalToCron('7h')).toThrow('divide evenly')
  })

  it('throws on multi-day interval', () => {
    expect(() => intervalToCron('2d')).toThrow('only supports 1d')
  })
})

// ── cronToHuman ──────────────────────────────────────────────────────────────

describe('cronToHuman', () => {
  it('formats every-N-minutes schedules', () => {
    expect(cronToHuman('*/30 * * * *')).toBe('every 30m')
    expect(cronToHuman('*/15 * * * *')).toBe('every 15m')
    expect(cronToHuman('*/5 * * * *')).toBe('every 5m')
  })

  it('formats every-1-hour schedule', () => {
    expect(cronToHuman('0 * * * *')).toBe('every 1h')
  })

  it('formats every-N-hour schedules', () => {
    expect(cronToHuman('0 */2 * * *')).toBe('every 2h')
    expect(cronToHuman('0 */6 * * *')).toBe('every 6h')
  })

  it('formats midnight daily schedule', () => {
    expect(cronToHuman('0 0 * * *')).toBe('daily 0:00')
  })

  it('formats specific-time daily schedules', () => {
    expect(cronToHuman('30 7 * * *')).toBe('daily 7:30')
    expect(cronToHuman('0 5 * * *')).toBe('daily 5:00')
  })

  it('returns raw expression for offset-hourly schedules', () => {
    // "17 * * * *" = every hour at minute 17 — not a simple "every 1h"
    expect(cronToHuman('17 * * * *')).toBe('17 * * * *')
  })

  it('returns expression unchanged for complex schedules', () => {
    expect(cronToHuman('*/30 14-21 * * 1-5')).toBe('*/30 14-21 * * 1-5')
  })

  it('returns unchanged for non-5-part expressions', () => {
    expect(cronToHuman('* * * *')).toBe('* * * *')
  })
})

// ── parseTimeout ─────────────────────────────────────────────────────────────

describe('parseTimeout', () => {
  it('parses minute timeouts', () => {
    expect(parseTimeout('5m')).toBe(300)
    expect(parseTimeout('10m')).toBe(600)
    expect(parseTimeout('1m')).toBe(60)
  })

  it('parses second timeouts', () => {
    expect(parseTimeout('30s')).toBe(30)
    expect(parseTimeout('120s')).toBe(120)
  })

  it('throws on invalid format', () => {
    expect(() => parseTimeout('5')).toThrow('Invalid timeout')
    expect(() => parseTimeout('5h')).toThrow('Invalid timeout')
    expect(() => parseTimeout('')).toThrow('Invalid timeout')
  })
})

// ── parseCrontabLines ────────────────────────────────────────────────────────

describe('parseCrontabLines', () => {
  const fixture = `
# flt fleet crons
*/30 * * * * /Users/twaldin/.flt/bin/cron-monitor >> /Users/twaldin/.flt/logs/cron-monitor.log 2>&1
0 * * * * /Users/twaldin/.flt/bin/cron-trader >> /Users/twaldin/.flt/logs/cron-trader.log 2>&1
17 * * * * /Users/twaldin/.flt/bin/cron-heartbeat >> /Users/twaldin/.flt/logs/cron-heartbeat.log 2>&1
30 4 * * * /Users/twaldin/.flt/bin/cron-dream-cycle >> /Users/twaldin/.flt/logs/cron-dream.log 2>&1
# unrelated entry (no flt)
0 0 * * * /usr/bin/some-other-script
*/30 14-21 * * 1-5 /Users/twaldin/.flt/bin/cron-stock-monitor >> /Users/twaldin/.flt/logs/cron-stock-monitor.log 2>&1
`.trim()

  it('parses all flt cron entries', () => {
    const entries = parseCrontabLines(fixture)
    expect(entries).toHaveLength(5)
  })

  it('extracts correct names', () => {
    const entries = parseCrontabLines(fixture)
    const names = entries.map(e => e.name)
    expect(names).toContain('monitor')
    expect(names).toContain('trader')
    expect(names).toContain('heartbeat')
    expect(names).toContain('dream-cycle')
    expect(names).toContain('stock-monitor')
  })

  it('extracts correct schedules', () => {
    const entries = parseCrontabLines(fixture)
    const monitor = entries.find(e => e.name === 'monitor')!
    expect(monitor.schedule).toBe('*/30 * * * *')
    const dream = entries.find(e => e.name === 'dream-cycle')!
    expect(dream.schedule).toBe('30 4 * * *')
  })

  it('extracts log paths', () => {
    const entries = parseCrontabLines(fixture)
    const trader = entries.find(e => e.name === 'trader')!
    expect(trader.logPath).toBe('/Users/twaldin/.flt/logs/cron-trader.log')
  })

  it('ignores non-flt lines and comments', () => {
    const entries = parseCrontabLines(fixture)
    const names = entries.map(e => e.name)
    expect(names).not.toContain('some-other-script')
  })

  it('handles empty input', () => {
    expect(parseCrontabLines('')).toEqual([])
    expect(parseCrontabLines('# just a comment\n')).toEqual([])
  })
})

// ── generateScript ────────────────────────────────────────────────────────────

// ── cronPeriodMs ─────────────────────────────────────────────────────────────

describe('cronPeriodMs', () => {
  const MIN = 60 * 1000
  const HOUR = 60 * MIN
  const DAY = 24 * HOUR

  it('computes period for every-N-minutes schedules', () => {
    expect(cronPeriodMs('*/30 * * * *')).toBe(30 * MIN)
    expect(cronPeriodMs('*/5 * * * *')).toBe(5 * MIN)
    expect(cronPeriodMs('*/15 * * * *')).toBe(15 * MIN)
  })

  it('computes 1-hour period for fixed-minute-every-hour schedules', () => {
    expect(cronPeriodMs('17 * * * *')).toBe(HOUR)
    expect(cronPeriodMs('0 * * * *')).toBe(HOUR)
    expect(cronPeriodMs('30 * * * *')).toBe(HOUR)
  })

  it('computes period for every-N-hours schedules', () => {
    expect(cronPeriodMs('0 */2 * * *')).toBe(2 * HOUR)
    expect(cronPeriodMs('0 */6 * * *')).toBe(6 * HOUR)
    expect(cronPeriodMs('0 */12 * * *')).toBe(12 * HOUR)
  })

  it('computes 1-day period for fixed daily schedules', () => {
    expect(cronPeriodMs('0 0 * * *')).toBe(DAY)
    expect(cronPeriodMs('30 4 * * *')).toBe(DAY)
    expect(cronPeriodMs('0 5 * * *')).toBe(DAY)
  })

  it('defaults to 1 day for complex/unknown schedules', () => {
    expect(cronPeriodMs('*/30 14-21 * * 1-5')).toBe(DAY)
    expect(cronPeriodMs('invalid')).toBe(DAY)
  })
})

// ── generateScript ────────────────────────────────────────────────────────────

describe('generateScript (send pattern)', () => {
  const script = generateScript('myagent', {
    send: 'check status',
    preset: 'monitor',
    dir: '/home/user/project',
    parent: 'cairn',
    bootstrap: 'You are the monitor. Stay alive.',
    binPath: '/usr/local/bin:/usr/bin:/bin',
  })

  it('sets FLT_AGENT_NAME=cron', () => {
    expect(script).toContain('export FLT_AGENT_NAME=cron')
  })

  it('sets PATH', () => {
    expect(script).toContain('export PATH="/usr/local/bin:/usr/bin:/bin"')
  })

  it('includes agent name in grep check', () => {
    expect(script).toContain('myagent')
  })

  it('includes flt send command', () => {
    expect(script).toContain("flt send myagent 'check status'")
  })

  it('includes flt spawn command', () => {
    expect(script).toContain('flt spawn myagent')
    expect(script).toContain('--preset monitor')
    expect(script).toContain('--dir /home/user/project')
    expect(script).toContain('--parent cairn')
    expect(script).toContain('--no-worktree')
  })

  it('includes bootstrap message in spawn', () => {
    expect(script).toContain("'You are the monitor. Stay alive.'")
  })

  it('is a bash script', () => {
    expect(script.startsWith('#!/bin/bash')).toBe(true)
  })
})

describe('generateScript (spawn pattern)', () => {
  const script = generateScript('ephemeral', {
    spawn: true,
    preset: 'mypreset',
    dir: '/tmp/work',
    timeoutSecs: 180,
    parent: 'human',
    binPath: '/usr/bin:/bin',
  })

  it('includes running check', () => {
    expect(script).toContain('ephemeral.*running')
  })

  it('includes spawn command', () => {
    expect(script).toContain('flt spawn ephemeral')
    expect(script).toContain('--preset mypreset')
  })

  it('uses correct timeout intervals', () => {
    // 180s / 10 = 18 intervals
    expect(script).toContain('seq 1 18')
  })

  it('includes kill on timeout', () => {
    expect(script).toContain('flt kill ephemeral')
  })

  it('includes INBOX_BEFORE tracking', () => {
    expect(script).toContain('INBOX_BEFORE')
  })
})

describe('generateScript (shell quoting)', () => {
  it('handles single quotes in messages', () => {
    const script = generateScript('agent', {
      send: "it's alive",
      binPath: '/usr/bin:/bin',
    })
    expect(script).toContain("'it'\\''s alive'")
  })

  it('omits --parent when default human', () => {
    const script = generateScript('agent', {
      send: 'ping',
      parent: 'human',
      binPath: '/usr/bin:/bin',
    })
    expect(script).not.toContain('--parent')
  })

  it('includes --parent when non-human', () => {
    const script = generateScript('agent', {
      send: 'ping',
      parent: 'cairn',
      binPath: '/usr/bin:/bin',
    })
    expect(script).toContain('--parent cairn')
  })
})

describe('cronAddWorkflow', () => {
  it('writes a workflow script that runs the workflow', () => {
    const home = mkdtempSync(join(tmpdir(), 'flt-cron-'))
    const previousHome = process.env.HOME
    process.env.HOME = home

    try {
      mkdirSync(join(home, '.flt', 'bin'), { recursive: true })
      mkdirSync(join(home, '.flt', 'logs'), { recursive: true })

      let nextCrontab = ''
      cronAddWorkflow('daily-mutator', '0 3 * * *', {}, {
        readCrontab: () => '',
        writeCrontab: (content) => {
          nextCrontab = content
        },
      })

      const scriptPath = join(home, '.flt', 'bin', 'cron-daily-mutator')
      const script = readFileSync(scriptPath, 'utf-8')
      expect(script).toContain('flt workflow run daily-mutator')
      expect(nextCrontab).toContain('0 3 * * *')
      expect(nextCrontab).toContain(scriptPath)
    } finally {
      process.env.HOME = previousHome
    }
  })

  it('throws on invalid cron spec', () => {
    expect(() => cronAddWorkflow('daily-mutator', 'every 5 minutes', {}, {
      readCrontab: () => '',
      writeCrontab: () => {},
    })).toThrow('Invalid cron spec')
  })
})

describe('parseCrontabLines (workflow entry)', () => {
  it('extracts workflow entry fields', () => {
    const line = '0 3 * * * /Users/x/.flt/bin/cron-daily-mutator >> /Users/x/.flt/logs/cron-daily-mutator.log 2>&1'
    const entries = parseCrontabLines(line)
    expect(entries).toHaveLength(1)
    expect(entries[0].schedule).toBe('0 3 * * *')
    expect(entries[0].name).toBe('daily-mutator')
    expect(entries[0].logPath).toBe('/Users/x/.flt/logs/cron-daily-mutator.log')
  })
})
