import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execFileSync } from 'child_process'
import { randomUUID } from 'crypto'
import { projectInstructions } from '../../src/instructions'
import { setAgent, getAgent, loadState, saveState } from '../../src/state'
import { reapOrphanedProjections } from '../../src/controller/reaper'
import { scanProjections, restoreOrphans } from '../../src/commands/audit-projections'
import { createSession, killSession, hasSession } from '../../src/tmux'

function tmuxAvailable(): boolean {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

interface Scenario {
  cli: string
  filename: string
}

// All instruction-file targets the cleanup paths must handle. Each value
// matches the corresponding adapter's instructionsFilename.
const SCENARIOS: Scenario[] = [
  { cli: 'claude-code', filename: 'CLAUDE.md' },
  { cli: 'opencode',    filename: '.opencode/agents/flt.md' },
  { cli: 'gemini',      filename: 'GEMINI.md' },
  { cli: 'generic',     filename: 'AGENTS.md' },
]

const baseOpts = {
  agentName: 'reaper-test',
  parentName: 'orchestrator',
  cli: 'claude-code',
  model: 'opus[1m]',
}

function setupAgentWithProjection(opts: {
  testHome: string
  workDir: string
  filename: string
  agentName: string
  tmuxSession: string
  originalContent?: string
}): ReturnType<typeof projectInstructions> {
  if (opts.originalContent !== undefined) {
    const filePath = join(opts.workDir, opts.filename)
    mkdirSync(join(filePath, '..'), { recursive: true })
    writeFileSync(filePath, opts.originalContent)
  }
  const projection = projectInstructions(opts.workDir, opts.filename, {
    ...baseOpts,
    agentName: opts.agentName,
  })
  setAgent(opts.agentName, {
    cli: 'claude-code',
    model: 'opus[1m]',
    tmuxSession: opts.tmuxSession,
    parentName: 'orchestrator',
    dir: opts.workDir,
    instructionProjection: projection,
    spawnedAt: new Date().toISOString(),
  })
  return projection
}

describe('instructions cleanup paths', () => {
  let testHome: string
  let origHome: string | undefined
  let workDir: string

  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), 'flt-cleanup-home-'))
    origHome = process.env.HOME
    process.env.HOME = testHome
    workDir = mkdtempSync(join(tmpdir(), 'flt-cleanup-wd-'))
  })

  afterEach(() => {
    process.env.HOME = origHome
    rmSync(testHome, { recursive: true, force: true })
    rmSync(workDir, { recursive: true, force: true })
  })

  describe('reaper restores orphaned projections', () => {
    for (const scenario of SCENARIOS) {
      it(`kill-during-spawn: ${scenario.cli} (${scenario.filename})`, () => {
        // Simulate spawn that wrote the projection to state but the
        // tmux session never came up (or was killed before it registered).
        // The reaper sees no live session -> restores.
        const original = '# Original Project Notes\nKeep me.'
        setupAgentWithProjection({
          testHome,
          workDir,
          filename: scenario.filename,
          agentName: 'never-started',
          tmuxSession: 'flt-never-started',
          originalContent: original,
        })

        // File currently contains the flt block
        const projected = readFileSync(join(workDir, scenario.filename), 'utf-8')
        expect(projected).toContain('<!-- flt:start -->')
        expect(projected).toContain('Keep me.')

        const result = reapOrphanedProjections()
        expect(result.reaped).toHaveLength(1)
        expect(result.reaped[0].agent).toBe('never-started')

        // Original is fully restored
        const restored = readFileSync(join(workDir, scenario.filename), 'utf-8')
        expect(restored).toBe(original)
        expect(restored).not.toContain('<!-- flt:start -->')

        // State was cleaned of the projection
        const stateAgent = getAgent('never-started')
        expect(stateAgent?.instructionProjection).toBeUndefined()
      })

      it(`controller-crash: ${scenario.cli} (${scenario.filename})`, () => {
        // Simulate a controller that wrote state and projected instructions
        // but never ran the kill-flow restore (process died, swallowed exception,
        // etc). Reaper on next tick catches it.
        setupAgentWithProjection({
          testHome,
          workDir,
          filename: scenario.filename,
          agentName: 'crashed-controller-agent',
          tmuxSession: 'flt-crashed-controller-agent',
          originalContent: undefined, // file did not exist pre-spawn
        })

        // File currently contains the flt block (file was created by projection)
        expect(existsSync(join(workDir, scenario.filename))).toBe(true)

        const result = reapOrphanedProjections()
        expect(result.reaped).toHaveLength(1)

        // Restore wipes the file because existedBefore=false
        expect(existsSync(join(workDir, scenario.filename))).toBe(false)

        // State cleared
        expect(getAgent('crashed-controller-agent')?.instructionProjection).toBeUndefined()
      })
    }

    it('force-kill of real tmux session: reaper detects + restores', () => {
      if (!tmuxAvailable()) return
      const sessionName = `flt-force-kill-${randomUUID().slice(0, 8)}`
      const agentName = sessionName.slice(4)
      const original = '# Real Conventions\nDo the right thing.'

      setupAgentWithProjection({
        testHome,
        workDir,
        filename: 'CLAUDE.md',
        agentName,
        tmuxSession: sessionName,
        originalContent: original,
      })

      // Create a real tmux session for this fake agent so the reaper sees it as live.
      createSession(sessionName, workDir, 'sh -c "sleep 30"')
      expect(hasSession(sessionName)).toBe(true)

      // Reaper should NOT touch the projection while session is alive.
      const noopResult = reapOrphanedProjections()
      expect(noopResult.reaped).toHaveLength(0)
      expect(getAgent(agentName)?.instructionProjection).toBeDefined()
      expect(readFileSync(join(workDir, 'CLAUDE.md'), 'utf-8')).toContain('<!-- flt:start -->')

      // Force-kill via tmux. The agent record still claims the projection.
      killSession(sessionName)
      expect(hasSession(sessionName)).toBe(false)

      // Reaper should now restore.
      const result = reapOrphanedProjections()
      expect(result.reaped).toHaveLength(1)
      expect(result.reaped[0].agent).toBe(agentName)

      const content = readFileSync(join(workDir, 'CLAUDE.md'), 'utf-8')
      expect(content).toBe(original)
      expect(getAgent(agentName)?.instructionProjection).toBeUndefined()
    })

    it('reaper is idempotent across multiple ticks', () => {
      const original = '# Pre-existing\n'
      setupAgentWithProjection({
        testHome,
        workDir,
        filename: 'CLAUDE.md',
        agentName: 'idempotent-agent',
        tmuxSession: 'flt-idempotent-agent',
        originalContent: original,
      })

      const first = reapOrphanedProjections()
      expect(first.reaped).toHaveLength(1)

      const second = reapOrphanedProjections()
      expect(second.reaped).toHaveLength(0)
      expect(second.failed).toHaveLength(0)

      // File stays restored.
      expect(readFileSync(join(workDir, 'CLAUDE.md'), 'utf-8')).toBe(original)
    })

    it('reaper records an instructions activity event with the file path', () => {
      const original = '# Original\n'
      setupAgentWithProjection({
        testHome,
        workDir,
        filename: 'CLAUDE.md',
        agentName: 'event-agent',
        tmuxSession: 'flt-event-agent',
        originalContent: original,
      })

      reapOrphanedProjections()

      const logPath = join(testHome, '.flt', 'activity.log')
      expect(existsSync(logPath)).toBe(true)
      const lines = readFileSync(logPath, 'utf-8').split('\n').filter(Boolean)
      const events = lines.map(l => JSON.parse(l) as { type: string; agent?: string; detail: string })
      const restored = events.find(e => e.type === 'instructions' && e.agent === 'event-agent')
      expect(restored).toBeDefined()
      expect(restored?.detail).toContain('reaper restored')
      expect(restored?.detail).toContain(join(workDir, 'CLAUDE.md'))
    })
  })

  describe('audit projections command', () => {
    it('scan reports active projections when session is live', () => {
      if (!tmuxAvailable()) return
      const sessionName = `flt-audit-active-${randomUUID().slice(0, 8)}`
      const agentName = sessionName.slice(4)

      setupAgentWithProjection({
        testHome,
        workDir,
        filename: 'CLAUDE.md',
        agentName,
        tmuxSession: sessionName,
        originalContent: '# Real\n',
      })
      createSession(sessionName, workDir, 'sh -c "sleep 30"')

      try {
        const rows = scanProjections()
        const row = rows.find(r => r.agent === agentName)
        expect(row).toBeDefined()
        expect(row?.state).toBe('active')
      } finally {
        killSession(sessionName)
      }
    })

    it('scan reports orphan-session-gone when tmux session is missing', () => {
      setupAgentWithProjection({
        testHome,
        workDir,
        filename: 'CLAUDE.md',
        agentName: 'orphan-gone',
        tmuxSession: 'flt-does-not-exist',
        originalContent: '# Real\n',
      })

      const rows = scanProjections()
      const row = rows.find(r => r.agent === 'orphan-gone')
      expect(row?.state).toBe('orphan-session-gone')
      expect(row?.reason).toContain('flt-does-not-exist')
    })

    it('restore() restores orphans via the audit path and clears state', () => {
      const original = '# Audit me\n'
      setupAgentWithProjection({
        testHome,
        workDir,
        filename: 'AGENTS.md',
        agentName: 'audit-restore',
        tmuxSession: 'flt-not-here',
        originalContent: original,
      })

      const rows = scanProjections()
      const { restored, failures } = restoreOrphans(rows)
      expect(restored).toBe(1)
      expect(failures).toHaveLength(0)

      expect(readFileSync(join(workDir, 'AGENTS.md'), 'utf-8')).toBe(original)
      expect(getAgent('audit-restore')?.instructionProjection).toBeUndefined()
    })

    it('scan is read-only: does not mutate state', () => {
      setupAgentWithProjection({
        testHome,
        workDir,
        filename: 'CLAUDE.md',
        agentName: 'scan-readonly',
        tmuxSession: 'flt-not-here',
        originalContent: '# Real\n',
      })

      const before = JSON.stringify(loadState())
      scanProjections()
      scanProjections()
      const after = JSON.stringify(loadState())
      expect(after).toBe(before)
    })

    it('all instructionsFilename targets restore correctly via audit', () => {
      // Fresh state for this test — populate one agent per scenario.
      const home = process.env.HOME ?? ''
      mkdirSync(join(home, '.flt'), { recursive: true })
      saveState({ agents: {}, config: { maxDepth: 3 } })

      const wds: Record<string, { workDir: string; original: string }> = {}
      for (const sc of SCENARIOS) {
        const wd = mkdtempSync(join(tmpdir(), `flt-multi-${sc.cli}-`))
        const original = `# ${sc.cli} original\nDo not delete.`
        wds[sc.cli] = { workDir: wd, original }
        setupAgentWithProjection({
          testHome,
          workDir: wd,
          filename: sc.filename,
          agentName: `multi-${sc.cli}`,
          tmuxSession: `flt-multi-${sc.cli}`,
          originalContent: original,
        })
      }

      try {
        const rows = scanProjections()
        expect(rows).toHaveLength(SCENARIOS.length)
        for (const r of rows) expect(r.state).toBe('orphan-session-gone')

        const { restored, failures } = restoreOrphans(rows)
        expect(restored).toBe(SCENARIOS.length)
        expect(failures).toHaveLength(0)

        for (const sc of SCENARIOS) {
          const { workDir: wd, original } = wds[sc.cli]
          const content = readFileSync(join(wd, sc.filename), 'utf-8')
          expect(content).toBe(original)
        }
      } finally {
        for (const { workDir: wd } of Object.values(wds)) {
          rmSync(wd, { recursive: true, force: true })
        }
      }
    })
  })
})
