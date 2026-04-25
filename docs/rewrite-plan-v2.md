# flt v2 rewrite plan (post context/skills pass)

Date: 2026-04-23

## completed first (context + skills)

- Default flt system block shortened.
- Skill dump injection removed from prompts.
- Skills now opt-in on spawn (`--skill`, `--all-skills`).
- Canonical skill layout now used: `./.flt/skills/<name>/SKILL.md` and `~/.flt/skills/<name>/SKILL.md`.

---

## remaining milestones

### M1 — liveness/death correctness
Dead agents should be cleaned up exactly like manual `:kill`.

### M2 — parent/subagent semantics cleanup
Root vs subagent instruction behavior should be clearly separated.

### M3 — model resolution via harness mapping
`--cli <cli> --model <alias>` should resolve using harness source-of-truth.

### M4 — TUI stabilization
Fix critical UX blockers before any full redesign.

### M5 — optional TUI redesign RFC
Spec only after stabilization.

---

## ticket board (remaining)

## EPIC A: liveness/death parity with kill

### A1. Runtime identity tracking
- `src/state.ts`
- `src/commands/spawn.ts`
- `src/tmux.ts`

### A2. Process/pane verification helpers
- `src/tmux.ts`

### A3. Poller dead->cleanup path (kill-equivalent)
- `src/controller/poller.ts`
- `src/commands/kill.ts`

### A4. Grace window + race-safe removal
- `src/controller/poller.ts`

### A5. Integration tests
- `tests/liveness/*.test.ts` (new)

---

## EPIC B: parent/subagent semantics

### B1. Split root vs subagent system wording fully
- `templates/system-block.md`
- `src/instructions.ts`

### B2. Routing behavior polish
- `src/commands/send.ts`

### B3. Docs update
- `README.md`
- `docs/*`

---

## EPIC C: model resolution

### C1. Use harness alias resolver in spawn path
- `src/commands/spawn.ts`
- `src/harness.ts` (or `src/model-resolution.ts` new)
- adapter spawn arg sites as needed

### C2. Add debug command
- `src/cli.ts`
- `src/commands/models.ts` (new)

### C3. Expand adapter capability parity with harness
- `src/adapters/registry.ts`
- `src/adapters/*`

### C4. Harness TS parity follow-up (external repo)
- `~/harness`

---

## EPIC D: TUI stabilization

### D1. ANSI scrollback style continuation fix
- `src/tui/ansi-parser.ts`
- `src/tui/panels.ts`

### D2. Completion popup behavior
- `src/tui/input.ts`
- `src/tui/panels.ts`
- `src/tui/types.ts`

### D3. Modal manager reliability
- `src/tui/app.ts`
- `src/tui/input.ts`
- `src/tui/panels.ts`

### D4. Sidebar/inbox MVP upgrades
- `src/tui/panels.ts`
- `src/tui/app.ts`

### D5. Theme contrast fixes
- `src/tui/theme.ts`
- `src/tui/panels.ts`

---

## parallel execution (max 3 coders)

## wave 1
1. `agent-liveness` → EPIC A
2. `agent-models` → EPIC C
3. `agent-prompts` → EPIC B

## wave 2
1. `agent-tui-core` → D1/D2/D3
2. `agent-tui-ux` → D4/D5
3. `agent-eval` (evaluator) → regression + acceptance checks
