# flt rewrite — session handoff (2026-04-28 ~10:50 ET)

## Where we are

**v0.2.14 shipped.** Two PRs landed today: `#33 gates modal + flt ask human` and `#34 dogfood followups + CLI mix + 3 bug fixes`. Plus an in-place `metrics-modal` polish chain. Main is at `5227ad9`. All 564 tests pass, typecheck clean.

**Fleet:** orchestrator only. No active workflows. Controller restarted on the new code (gates-store array format active).

## What landed today (since v0.2.13)

### Gates modal + flt ask human (PR #33)
- `flt gates` + `flt blockers` CLI commands; TUI gates modal bound to `g`
- `flt ask human '<json>'` blocking primitive — agents emit Claude-Aug-shape Question objects, CLI polls answer-file path, returns answer JSON on stdout
- `~/.flt/qna/<run-id>/<q-id>.{question,answer}.json` persistence; mutator/GEPA training feed via `flt qna list/show/export`
- Gates-modal extended to show pending questions as `kind: 'question'` rows
- Picker overlay: word-wraps prompt + descriptions, sizes to content (cap most-of-screen), centered, auto-scrolls, `[t] type your own answer` mode
- Asking agent gets `flt send` notification on answer (FLT_AGENT_NAME → tmux feed)
- Grill skill (templates/skills/grill/SKILL.md) routes through `flt ask human` when in flt project
- TUI polish: bg-only selection (vert lines stay crisp), 1-cell padding around │, theme palette unified (sidebarBorder for rules + verticals, sidebarTitle for headers), per-kind row coloring, status-tinted workflow rows
- Workflows modal: two distinct tables (RUNNING + PAST) with shared widths + ┼ horizontal rules
- Metrics tree: orchestrator-rooted, _smoke* filter, longest-prefix archive matching, dynamic-dag agents nested under their workflow, connected-rail continuation (ancestor `│` doesn't break on last-child rows), `<workflow> · <slug>` disambiguated labels
- Stdout debug rig: `bun run scripts/print-runs-tree.ts [--no-smoke]`

### Dogfood followups (PR #34)
- **CLI mix**: idea-to-pr reviewer = codex-reviewer (gpt-5.4, ≠ coder family); dynamic-feature architect picks per-node preset from menu (cc/pi/codex/gemini/opencode), default policy ≥50% non-claude-code coders
- **Concurrent .gate-pending overwrite fix**: new `src/workflow/gates-store.ts`, JSON-array format, decisions are node-scoped via `removePendingGate(predicate)`. Backward-compat reads legacy single-object format.
- **coder.md anti-fabrication**: hard precondition before pass — paste `git log/status/diff` literal output. Empty log → must fail.
- **coder.md worktree discipline**: `pwd` at start, strip out-of-worktree absolute paths from task descriptions
- **dynamic-feature.yaml architect prompt**: forbids `Project root: {dir}` in per-node tasks (root cause of worktree escape — coders interpolated user's project root and wrote there)

### Companion stuff
- coder.md vNext promoted from daily-mutator dogfood (`Signal completion (required, terminal)` section)
- daily-mutator cron installed (system crontab — see Gotchas #17)
- GH MQ regression audit: 19 repos scanned twice (quick + deep), all CLEAN. `handoffs/gh-mq-audit-2026-04-28.md`.

## Carry-over for next session

### High priority

1. **Per-domain mutator fan-out** (user said "yes, fire it tomorrow night" via the modal). Edit `templates/workflows/daily-mutator.yaml` so the `mutate` step is `type: parallel` with one child per role-category (coder.md, reviewer.md, architect.md, oracle.md, mutator.md, evaluator.md, …). Each writes its own vNext + own gate. Lets the mutator improve multiple artifacts per night without burning one big-context agent on the whole library.

2. **Auto-PR-on-completion shape gating** (followup #4 from earlier list). The daily-mutator opens meaningless PRs because the mutator writes to `$FLT_RUN_DIR/artifacts/`, not project source — its worktree branch has 0 commits, so the auto-PR is empty or stale. Fix shape: per-workflow `auto_pr: false` flag in the yaml schema, default-on. Set false for daily-mutator + gepa-prep + similar artifact-only workflows. Codex/idea-to-pr/fix-bug keep auto_pr=true. ~30 min PR.

3. **`flt cron` workflow support**. Today `flt cron add` only schedules AGENTS (not workflows) and requires `--every` (interval, not crontab format). I had to fall back to `crontab -e` directly for daily-mutator. Add `flt cron add <workflow-name> '<cron-spec>'` that runs `flt workflow run <name>` on schedule. ~20 min PR.

### Medium priority (wait-for-real-task)

4. **Dogfood the new dynamic-feature workflow** with the per-node preset menu. Architect should pick e.g. pi-coder for one node + cc-coder for another. Verify variety happens. Probably wait for a real feature task; synthetic tasks aren't worth the $$ + hours.

### Open design questions

- The mutator → promote → manual git commit + push chain is 3-step. Worth folding promote+commit+push into a workflow extension? OR: have mutator's gate option set include "approve-and-promote" that fires `flt promote` automatically? Discussed with user 2026-04-28; deferred.

## Authoritative docs

- This file (HANDOFF.md)
- `docs/conversation-with-gpt.md` — GEPA/swarm design conversation (still relevant)
- `templates/workflows/*.yaml` — current workflow shapes
- `~/.flt/runs/<id>/` — per-run state (see `metrics.json`, `transcript.jsonl`, `artifacts/`)

## Gotchas (current)

1. **Restart controller after engine code changes**: `flt controller stop && rm -f ~/.flt/controller.{pid,sock} && flt controller start`. Required for any change to `src/workflow/engine.ts` / `src/controller/server.ts` / `src/commands/spawn.ts` / `src/harness.ts` / `src/workflow/gates-store.ts` (NEW).
2. **TUI process snapshots imports at launch**. After ANY change to `src/tui/*.ts`, you must close + relaunch `flt tui` to see the new render. Controller restart is NOT required for TUI-only changes.
3. **`opus[1m]` always**: never plain `opus`. `force1mOpus` in `src/model-resolution.ts` coerces.
4. **harness-ts is a `bun link` symlink** at `node_modules/@twaldin/harness-ts → ~/harness/ts`. Edit `~/harness/ts` directly; `bun run build` to regen `dist/index.js`. Restart flt controller after.
5. **state.json shape**: `{"agents":{}, "config":{"maxDepth":3}, "orchestrator": {...}}`. Empty `{}` causes runtime null-deref. Init seed handles this.
6. **No env isolation on spawn**: dropped `CLAUDE_CONFIG_DIR` + `XDG_CONFIG_HOME` (hid OAuth/provider config).
7. **`.flt/` and `handoffs/` are gitignored** at repo root via `ensureFltGitignore()` on createWorktree.
8. **`.gate-pending` is a JSON ARRAY now** (since v0.2.14). New code always writes arrays; readers detect legacy single-object and wrap as `[obj]`. Use `src/workflow/gates-store.ts` helpers — don't read/write the file directly.
9. **The orchestrator agent name is literally `orchestrator`** when type=human. The metrics tree's root detection uses `hasAgent('orchestrator')` first, falling back to `'human'`. Don't break this — the entire workflow-tree depends on it.
10. **pi + gemini need node 22**: bundles use Unicode regex /v flag.
11. **slug-only runId**: `generateRunId` uses just slug (no workflow prefix). `idea-to-pr-X` style is legacy; new runs e.g. `dynamic-dag-primitive` directly.
12. **TUI metrics modal**: `t` opens it, `m` cycles group (model/workflow/agent), `t` cycles period (today/week/month/all), `j/k` scroll runs list. "today" = rolling last 24h.
13. **TUI workflow modal**: `w` opens. RUNNING + PAST as two distinct tables; column widths shared; ┼ rules.
14. **TUI gates modal**: `g` opens. Inline kind-aware actions: `[a]pprove [x]reject` on human_gate; `[r]etry [s]kip [a]bort` on node-fail; `[r]etry [a]bort` on reconcile-fail; Enter→sub-picker on node-candidate; `[v]iew [c]ancel [d]ismiss` on blocker; Enter or `[t]` on question opens picker overlay.
15. **`flt ask human` blocks** until answer file appears or 1h timeout. Run with `&` if you want to keep using the shell. Default timeout: 3600s; override with `--timeout <ms>`.
16. **`flt promote` writes to project source** (`templates/roles/<artifact>.md`), creates `archive/` audit + `.changelog.md` + `.metrics.json`. After promote, you still need to `git commit + push` manually.
17. **daily-mutator cron is installed in system crontab** (NOT `flt cron`). `crontab -l` to inspect; entry runs at `0 3 * * *` Indianapolis time. Logs to `/tmp/flt-cron.log`. flt cron's workflow support is a TODO (carry-over #3).

## Quick commands

```bash
# Fleet
flt list
flt controller status
flt workflow list

# Workflow ops
flt workflow run <name> --slug <slug> --task "..."
flt workflow approve <run> | reject <run> --reason "..."
flt workflow advance <run>          # manual unstick
flt workflow cancel <run>           # captures diff, removes worktrees
flt workflow node retry|skip|abort <run> [<node-id>]
flt workflow reconcile retry-reconcile|abort <run>

# Trace + GEPA
flt trace export <run-id>
flt trace recent --since 24h --status failed
flt eval suite list / run <name>
flt promote <artifact> --evidence <run-ids>

# Q&A (NEW)
flt qna list [--pending] [--run-id <id>]
flt qna show <q-id>
flt qna export --format jsonl
flt ask human '<json>' [--from <name>] [--run-id <id>] [--timeout <ms>]
flt gates [--json] [--watch]
flt blockers [--json] [--watch]

# TUI
flt tui                  # press t (metrics) w (workflows) g (gates) m (inbox)
                         #       s (spawn) : (command)

# Cron
crontab -l               # daily-mutator entry installed here
flt cron list            # NOTE: only agent-crons today, not workflow (carry-over #3)

# Debug rigs
bun run scripts/print-runs-tree.ts [--no-smoke]   # what the metrics tree renders
```

## Resume checklist for next session

```bash
# Sanity
flt controller status                      # should show running
flt list                                   # likely just orchestrator
git log --oneline -10                      # see today's ship log
bun test 2>&1 | tail -3                    # 564 pass, 0 fail
crontab -l | grep daily-mutator            # cron entry should exist

# Daily-mutator output (if it fired overnight)
flt workflow list | grep daily-mutator     # any gates pending?
ls ~/.flt/runs/find-one-role-skill*/artifacts/ 2>/dev/null  # candidate vNext
flt qna list --pending                     # any questions waiting

# Top followup priorities (in order)
# 1. Per-domain mutator fan-out (carry-over high-priority #1)
# 2. Auto-PR shape gating (carry-over high-priority #2)
# 3. flt cron workflow support (carry-over high-priority #3)
```
