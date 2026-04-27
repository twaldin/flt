# flt rewrite — session handoff (2026-04-27 ~03:30)

## Where we are

**Phase 3 LANDED. Today's work merged everything we set out to.** Worktree retry preservation, per-project worktree-setup hook, harness telemetry verified across all 12 adapters, TUI modal polish (vertical separators / hierarchical tree / greedy column widths / single tokens col), the dynamic_dag primitive with first production dogfood, and all 4 GEPA prerequisite blockers resolved.

**Fleet now:** orchestrator only. No active workflows. Last cancelled: `blockers-and-harvest` (gepa-prep dogfood) — surfaced 2 dag bugs, work recovered manually onto main.

## Immediate next step

**Fire GEPA tonight (or wire cron):**

```sh
# Option A — fire now manually, completes by ~5am, gate awaits Tim in morning:
flt workflow run daily-mutator --task "Find one role/skill .md whose failures dominate today's traces and propose a vNext that fixes them."

# Option B — schedule for tomorrow night (and every night):
flt cron add daily-mutator '0 3 * * *'
```

Both are go — all 4 prerequisites are on main:
- `src/redact.ts` + wired into `flt trace export`
- `templates/roles/mutator.md` (real role, oracle-aware)
- `flt trace recent --since 24h --status failed`
- `tests/eval/gold-mine/` populated with 11 fixtures from github.com/twaldin/*

## Today's commit history (ship log)

```
09788f5 harvest gold-mine fixtures from GitHub/local sources
ae7fea5 trace-recent: capture uncommitted work
7877544 mutator-role: capture uncommitted work
cfb6b2d redact: capture uncommitted work
61f689c dag: kill coder/reviewer (preserve worktree) before transitioning + auto-commit
5aff49a metrics: 'today' = rolling last-24h, not calendar day
4991569 templates/workflows: gepa-prep.yaml — first production dynamic_dag dogfood
3dc10f6 workflow: dynamic_dag primitive — runtime-decomposed DAG with reconciler
8f9e506 tui: vertical separators + hierarchical runs tree + greedy column widths + sidebar polish
01c2bff tests/adapters: telemetry parser tests for all 12 harness adapters + fixtures (paired w/ harness 5b09ed7)
1e1a39c worktree: per-project setup hook + gitignored-symlink fallback
e09ebc4 worktree: preserve branch + commits across workflow retries
1737f86 metrics: canonicalize models, drop <synthetic>, j/k scroll, ellipsis cols, period-aware sparkline + backfill
e20024f tui/metrics-modal: 3-section layout, share %, j/k always scrolls runs
a385ae7 tui: fix metrics-modal pane bleed + per-step cost + delegate non-claude harness extract
0f4a8f9 tui/input: refuse to consume stdin when it isn't a TTY
13fb1d5 spawn: refuse names shorter than 3 chars
70d5fc0 tui/workflow-modal: column headers + split slug/workflow + tokens column
6b4392c tui: rename projectRoot + sidebar backfill + Track A metrics modal
04e0a0f GEPA B5: daily-mutator workflow YAML + B6: flt promote command
f8bec8c GEPA B1: artifact treatment hashing + B2: flt trace export
228bd7c tui: workflow-aware sidebar + cost columns in workflow modal
d5eb903 gold-mine harvester: github.com/twaldin md-file fixtures + local *.md
cbdba36 GEPA B3: metrics.json writer per workflow run + B4: held-out eval suite
```

Companion harness commits: `5b09ed7` (parser fixes for crush/gemini/kilo/opencode/qwen/swe-agent), `e101371` (claude-code skip `<synthetic>`).

## Real bugs found today, NOT yet fixed (followups)

### Critical (block reliable workflow operation)

1. **`createWorktree` resets a branch with prior commits when main advances.**
   `branchHasWork` is computed via `git rev-list --count <branch> --not HEAD`. If main moves forward such that the branch is now BEHIND main (no commits ahead of HEAD), `branchHasWork=false` → branch gets force-deleted + recreated from HEAD, killing the auto-commit work. Hit live in the gepa-prep dogfood: 3 of 4 nodes' coder commits were lost; only harvest survived because main hadn't moved between its commit and the next createWorktree call.
   **Fix:** also check `git rev-list --count <branch>..HEAD` (commits in HEAD not in branch) — if branch is ANCESTOR of HEAD AND has uncommitted work in working tree, preserve. Or simpler: if local <branch> exists at all AND origin/<branch> exists, fetch+ff to origin tip first, then preserve.

2. **`advanceDynamicDag` missing prod-on-idle for per-node coders.**
   `advanceWorkflow` (single-step) prods 2× then force-fails (engine.ts:290-318). The new dag advance path doesn't. harvest-coder went idle for 1h after printing its summary because pi forgot to call `flt workflow pass` — no prod fired.
   **Fix:** port the prod-on-idle block to advanceDynamicDag for each candidate that's idle with no result file.

3. **`advanceDynamicDag` missing reconcile-fail handling.**
   When the final reconciler signals fail, the workflow stays in execute step indefinitely. Should open a reconcile-fail human gate (kind: `reconcile-fail`, options: retry-reconcile / abort) per the original design grill. Currently has to be manually cancelled.

4. **`tests/integration/dag-execute.test.ts` cross-suite test pollution.**
   `tests/unit/eval-suite.test.ts:20` calls `mock.module('../../src/workflow/engine')` to stub `startWorkflow`. `mock.restore()` in afterAll doesn't restore module mocks (only function mocks). When dag-execute runs after eval-suite in the same `bun test` invocation, it gets the stub → `loadWorkflowRun` returns null → 7 dag-execute tests fail. **Pass when run in isolation:** `bun test tests/integration/dag-execute.test.ts → 7/7 green`. Same problem in `tests/unit/spawn.test.ts:15` mocking `../../src/state`.
   **Fix:** rewrite eval-suite to use dependency injection instead of module mock. Or use a different test runner config that isolates module mocks.

### Medium

5. **Controller poller misses `advance` when result-file appears without status change.**
   Documented in HANDOFF gotcha #21 (still). Plan agent signals pass via `flt workflow pass` → result file written → poller is supposed to fire advanceWorkflow on idle, but sometimes misses it. Workaround: `flt workflow advance <run>` manual unstick. Real fix: poller watches results-dir mtime as a separate trigger from agent status.

6. **pi/codex sometimes finishes work without calling `flt workflow pass`.**
   harvest-coder: ran the harvester, printed full summary, went idle. Never signaled. The prod-on-idle (followup #2) fixes this for the dag path.

### Low

7. **Spawn modal accepts agent names that look like paste garbage.**
   Already partially fixed (`13fb1d5` refuses names <3 chars). Still spawnable via `:spawn xy = ...` if user pastes 3+ chars before the `=`. Defer.

8. **AskUserQuestion blocks other parent messages while waiting.**
   Tim hit this at least twice — sent messages while a grill was open, they got swallowed. Future improvement: out-of-band Q&A channel that doesn't block parent inbox.

## Authoritative documents

- **Plan:** `/Users/twaldin/.claude/plans/cozy-wibbling-kahan.md` (phase 1+2)
- **DAG design:** `/Users/twaldin/.claude/plans/magical-strolling-snail.md`
- **GEPA design target:** `docs/conversation-with-gpt.md`
- **harness-ts source:** `~/harness/ts` (linked via bun-link → flt's `node_modules/@twaldin/harness-ts`)
- **gepa-prep workflow:** `templates/workflows/gepa-prep.yaml`
- **daily-mutator workflow:** `templates/workflows/daily-mutator.yaml`

## Key gotchas (carryover, current)

1. **Restart controller after engine code changes**: `flt controller stop && rm -f ~/.flt/controller.{pid,sock} && flt controller start`. Required for any change to `src/workflow/engine.ts` / `src/controller/server.ts` / `src/commands/spawn.ts` / `src/harness.ts`.
2. **Multi-line bootstrap auto-redirect**: spawn writes to `<workdir>/.flt/bootstrap.md`, sends a one-line redirect.
3. **`flt kill` removes worktree** unless `--preserve-worktree` (added today). Workflow auto-commit-then-kill uses preserve internally.
4. **Hard ban on two agents per workdir**: spawn refuses with clear error.
5. **`.flt/` and `handoffs/` in repo root are gitignored**: `ensureFltGitignore()` adds them on createWorktree.
6. **`.flt/worktree-setup.sh`** (new today): per-project hook runs after createWorktree. If absent, default = symlink each top-level gitignored entry from project root.
7. **state.json shape**: `{"agents":{}, "config":{"maxDepth":3}}`. Empty `{}` causes runtime null-deref. Init seed handles this.
8. **pi + gemini need node 22**: bundles use Unicode regex /v flag.
9. **No env isolation on spawn**: dropped `CLAUDE_CONFIG_DIR` + `XDG_CONFIG_HOME` (hid OAuth/provider config).
10. **`opus[1m]` always**: never plain `opus`. `force1mOpus` in `src/model-resolution.ts` coerces.
11. **harness-ts is a `bun link` symlink**: edit `~/harness/ts` directly, then `bun run build` to regen `dist/index.js`. Restart flt controller after.
12. **slug-only runId**: today `generateRunId` uses just slug (no workflow prefix). `idea-to-pr-X` style is legacy; new runs are e.g. `dynamic-dag-primitive` directly.
13. **TUI input refuses non-TTY stdin**: prevents subprocess'd TUIs (e.g. python smoke tests) from synthesizing keystrokes from inherited heredoc content.
14. **TUI metrics modal**: `t` opens it, `m` cycles group (model/workflow/agent), `t` cycles period (today/week/month/all), `j/k` scroll runs list. "today" = rolling last 24h (not calendar day, fixed today).
15. **TUI workflow modal**: `w` opens. Vertical separators between every column, hierarchical tree in runs, greedy-grow widest column.
16. **Backfill cost script**: `bun run scripts/backfill-cost.ts` re-extracts cost from session logs for archives with cost_usd:null. Already ran today — 18 archives recovered, 182 unrecoverable (worktrees long-cleaned).

## Quick commands

```bash
# Fleet
flt list
flt controller status
flt workflow list

# Workflow ops
flt workflow run <name> --slug <slug> --task "..."
flt workflow approve <run> | reject <run> --reason "..."
flt workflow advance <run>          # manual unstick (gotcha 5)
flt workflow cancel <run>           # captures diff via cleanup, removes worktrees
flt workflow node retry|skip|abort <run> [<node-id>]   # dag-specific gate UX

# Trace + GEPA
flt trace export <run-id>           # unified transcript.jsonl
flt trace recent --since 24h --status failed
flt eval suite list / run <name>
flt promote <artifact> --evidence <run-ids>

# TUI
bun src/cli.ts tui                  # press t (metrics), w (workflows), s (spawn), m (inbox)

# Cron
flt cron list / add <workflow> '<cron>' / remove <name>
```

## Resume checklist for next session

```bash
# Sanity
flt controller status                      # should show running
flt list                                   # likely just orchestrator
git log --oneline -20                      # see today's ship log
bun test 2>&1 | tail -3                    # ~511 pass, 7 fail (all dag-execute pollution flake)

# If GEPA was fired tonight:
flt workflow list                          # daily-mutator at gate?
cat ~/.flt/runs/<daily-mutator-run>/artifacts/comparison.md   # the report

# To kick off GEPA (if not already fired):
flt workflow run daily-mutator --task "Find one role/skill .md whose failures dominate today's traces and propose a vNext that fixes them."
# OR cron:
flt cron add daily-mutator '0 3 * * *'

# Top followup priorities (from today's bug list):
# 1. Fix createWorktree branch-reset when main advances (loses workflow auto-commits)
# 2. Port prod-on-idle from advanceWorkflow to advanceDynamicDag
# 3. Implement reconcile-fail human gate
# 4. Fix eval-suite mock pollution (the cross-suite 7-fail flake)
```
