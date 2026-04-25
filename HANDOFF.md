# flt rewrite — session handoff (2026-04-25 evening)

## Where we are

**Phase 1: complete and committed.** ~/.flt was nuked, rebuilt clean from new code. 24 skills migrated out of ~/.claude into ~/.flt/skills. All Claude Code plugins uninstalled + caches purged + commands/agents/get-shit-done dirs cleared (`~/.claude` now has zero SKILL.md). 11 role SOULs authored (`~/.flt/roles/{coder,reviewer,architect,...}.md`, `~/.flt/agents/orchestrator/SOUL.md`). Repo cleanup done. **268 unit tests pass / 0 fail.**

**Phase 2: in progress.** Task 19 (model resolution dialect map + routing resolver + seed yamls) committed. Cross-CLI smoke validated (claude-code + codex) — skill delivery + cleanup work. Task 20 (model resolution smoke + `flt route check`) is next.

## Authoritative documents

- **Plan**: `/Users/twaldin/.claude/plans/cozy-wibbling-kahan.md` — full phase 1 + phase 2 plan with locked decisions, file lists, and order of execution. Read this first on resume.
- **Backup of old ~/.flt**: `~/.flt-backups/flt-2026-04-25.tar.gz` (11 MB, 599 files).
- **GPT roadmap context**: `docs/conversation-with-gpt.md` (the design conversation that drove the plan).
- **Earlier rewrite plan**: `docs/rewrite-plan-v2.md` (epics A/B/C/D — partially superseded by the new plan).

## Recent commits (since wip baseline 7515cd3)

```
c0838a1 spawn: refuse two agents into the same workdir
9f59ba5 plugin: audit + uninstall subcommands
3382d79 skills: subcommand group with import + move-from-claude
9b597d8 init: seed full ~/.flt skeleton with 20 default presets
ab12e19 spawn: workdir safety + per-cli skill injection + env isolation
57f6700 tests: phase 1 coverage
0456e84 templates: drop legacy system-block.md
751a151 fix: skill move-from-claude handles symlinks + tui null-state guard
8cd4673 init: seed state.json with proper {agents:{}} shape
baa9553 spawn: drop CLAUDE_CONFIG_DIR + XDG_CONFIG_HOME env overrides
f2beac0 docs: drop stale specs
P2:    model dialect resolver + routing resolver + seed routing yamls
```

## Phase 2 task queue (resume point)

| # | Task | Status |
|---|---|---|
| 18 | Idle/ready detection per new adapter | pending |
| 19 | Model resolution dialect map + routing resolver | done (committed) |
| 20 | Model resolution smoke + `flt route check` | **next** |
| 21 | 6 new adapters in parallel (continue-cli, crush, droid, openclaude, qwen, kilo) | pending |
| 22 | Workflow primitives (parallel/condition/human_gate/merge_best/collect_artifacts) | pending |
| 23 | Workflow manifest.ts + gc.ts (artifact lifecycle) | pending |
| 24 | workflow command (approve/reject + --n) | pending |
| 25 | `flt ask oracle` wrapper | pending |
| 26 | 4 default workflows seeded by init (idea-to-pr, code-and-review, new-project, fix-bug) | pending |
| 27 | System block refinement (parent vs oracle guidance) | pending |
| 28 | Phase 2 tests | pending |
| 29 | Final phase 2 verification (`flt route check` + full bun test green) | pending |
| 30 | P2 polish: tag CC-only skills with `cli-support` frontmatter | pending |

## Working pattern (sequential helper-driven)

For each task:
1. Write a complete brief to `/tmp/taskN-helper-brief.md` covering goal, constraints, files to read, expected output, "send parent task N done" sign-off.
2. `flt spawn taskN-helper -c claude-code -m sonnet -d /Users/twaldin/flt -W "$(cat /tmp/taskN-helper-brief.md)"`.
3. Background-poll `~/.flt/inbox.log` for `taskN-helper.*task N done` or `blocked`.
4. Review: `git diff HEAD --stat`, inspect critical files, run `bun test tests/unit`.
5. `flt kill taskN-helper`. Commit. Repeat.

Pi reviewer pattern (was tried, rough at edges): pi accumulates messages as "Steering" without auto-dispatch. Skipped for now; revisit when phase 2 hardens pi adapter.

## Critical gotchas (don't relearn)

1. **Restart controller after any spawn/skill/state code change**: the controller is a long-running bun process. Code edits to `src/commands/{spawn,skills,kill}.ts`, `src/skills.ts`, `src/state.ts` etc. don't take effect until:
   ```bash
   flt controller stop && rm -f ~/.flt/controller.{pid,sock} && flt controller start
   ```
2. **No env isolation on spawn**: dropped CLAUDE_CONFIG_DIR + XDG_CONFIG_HOME overrides — they hid OAuth and triggered "new user" onboarding. Per-CLI workdir skill copy is sufficient now that `~/.claude` is clean. See commit baa9553.
3. **Hard ban on two agents per workdir**: spawn refuses with clear error pointing at kill-or-worktree. Manifest collision guard, see commit c0838a1.
4. **`.flt/` in repo root is gitignored**: spawn artifacts + `.managed-skills.json` write into `<workdir>/.flt/`. If you spawn into the flt repo (which you do — `-d /Users/twaldin/flt`), `.flt/` accumulates locally. Don't commit it.
5. **`.claude/` in repo root is gitignored**: same reason — spawn writes `<workdir>/.claude/skills/<name>/`.
6. **State.json shape**: must be `{"agents":{}, "config":{"maxDepth":3}}`. Empty `{}` causes runtime null-deref. Init seed handles this.
7. **Pi adapter needs node 22**: pi 0.68 uses Unicode regex /v flag. `src/adapters/pi.ts` does `nvm use 22` before launching `pi`. If you bump pi version, recheck.
8. **Anthropic-skills bundle**: source path is `~/.claude/anthropic-skills/skills/` (not the parent dir). `flt skill move-from-claude` handles this.
9. **Plugin uninstall has stdin issues**: `claude plugin remove` inherits stdin and eats piped y/n responses. The `flt plugin uninstall --confirm` interactive flow works but iterates one at a time. For bulk: shell `for p in ...; do claude plugin remove "$p"; done`.

## Bug list — captured but deferred

- **`tmux-orchestrator@tmux-orchestrator` JSON entry**: `claude plugin remove tmux-orchestrator` succeeded but the JSON entry survives (because the plugin name is also a marketplace name). Functionally gone, audit just shows stale data. Phase 2 polish.
- **TUI poll() null guards**: added `?? {}` for `Object.entries(agents)` (commit 751a151) and similar in `commands/list.ts` (commit 8cd4673). Any other `Object.entries(state.x)` site needs review if state.x can be undefined.
- **`flt plugin audit` writes to `cwd`**: the markdown report lands in your current directory. Acceptable but worth a `--out <path>` flag eventually.
- **No `flt skill audit` reminder pre-spawn**: future plugin re-installs would put SKILL.md back into ~/.claude. A warning before spawn if `find ~/.claude -name SKILL.md | wc -l > 0` would catch regressions early.

## Resume checklist on next session

```bash
# Sanity
flt controller status                 # should show running
flt list                              # current agents
git log --oneline -10                 # recent commits
cat HANDOFF.md                        # this file
cat /Users/twaldin/.claude/plans/cozy-wibbling-kahan.md | head -60   # plan context
bun test tests/unit 2>&1 | tail -3   # 268 / 0 fail expected

# Verify clean global skill state
find ~/.claude -name SKILL.md 2>/dev/null | wc -l   # should be 0
ls ~/.flt/skills/ | wc -l                            # should be 24

# Verify routing seeds present
cat ~/.flt/routing/policy.yaml
flt route show coder                  # should print {"preset":"pi-coder",...}

# Pick up where left off
# → Task 20: model resolution smoke + flt route check
# → Brief template in this session was at /tmp/task19-helper-brief.md (similar pattern)
```

## Phase 2 next steps (concrete)

Task 20 (next):
- Add `src/model-resolution-smoke.ts` — for each registered adapter, given a target alias, run `<cli> --model <translated> --help` (or a deterministic no-op) and assert exit code 0 means model accepted.
- Add `flt route check` command in `src/cli.ts` — iterates `routing/policy.yaml`, runs the smoke per (role → preset → cli, model). Reports pass/fail per row.
- Cache results so we don't re-smoke every spawn.
- Tests: `tests/integration/route-check.test.ts` against the seeded matrix.

After task 20: spawn 6 helpers in parallel for task 21 (one adapter each). Then sequential workflow primitive + manifest/gc + ask oracle + system block refinement. Phase 2 finale = `flt route check` green for all rows.
