# flt rewrite — session handoff (2026-04-26 mid)

## Where we are

**Phase 2 DONE.** All three final-verification gates green: `flt route check` 11/0/0, `bun test` 402/0, e2e-harness.sh 12/12 PASS.

**Tasks 22–29 closed.** Phase 2 still owes only Task 30 (P2 polish: tag CC-only skills with `cli-support` frontmatter) — deferred, not blocking.

This session added the autonomy layer: 5 workflow primitives wired (parallel, condition, human_gate, merge_best, collect_artifacts), 4 default workflow templates seeded by `flt init`, `flt workflow approve|reject` + `--n`, `flt ask oracle`, `flt artifact gc`, ArtifactManifest schema, refined system-block guidance.

## Authoritative documents

- **Plan**: `/Users/twaldin/.claude/plans/cozy-wibbling-kahan.md` — phase 1 + phase 2 plan with locked decisions.
- **Task 22 design**: see Tasks list (`TaskGet 1`) for the 16 grilled decisions that locked the primitive shapes.
- **harness-ts source (linked)**: `~/harness/ts/` — flt's `node_modules/@twaldin/harness-ts` is a `bun link` symlink. Edit harness in place; `bun run build` from `~/harness/ts` after changes.
- **e2e probe**: `tests/integration/e2e-harness.sh` — runs full check across all 12.
- **GPT roadmap context**: `docs/conversation-with-gpt.md`.
- **Earlier rewrite plan**: `docs/rewrite-plan-v2.md` (epics A/B/C/D, partly superseded).

## Workflow primitives (resolved design)

| primitive | shape | semantics |
|---|---|---|
| `spawn` (default) | preset+task or run | legacy; backcompat via untyped step → `type: 'spawn'` |
| `parallel` | `{ n, presets?, step }` | spawn N children, treatment_map permutes label→preset (private), >=1 pass = group pass |
| `condition` | `{ if, then, else? }` | `<lhs> == \|!= <rhs>` grammar; forward-only jumps; self-jump permitted (no-op) |
| `human_gate` | `{ notify? }` | writes `<runDir>/.gate-pending`, blocks until `flt workflow approve\|reject` writes `.gate-decision` |
| `merge_best` | `{ candidate_var, target_branch? }` | reads `winner.json` or `.gate-decision`, git merge winner branch into start branch; conflict → fail step |
| `collect_artifacts` | `{ from, files, into }` | copies files via `<step>-<label>-<filename>` shape; `_` for non-parallel |

Run state moved: `~/.flt/runs/<id>/{run.json, manifest.json, results/, handoffs/, logs/}`. Old `~/.flt/workflows/runs/*.json` layout refused at load with clear "upgrade required, cancel and rerun" message.

Verdict path unified: every step writes `<runDir>/results/<step>-<label>.json` (single steps use label `_`). `signalWorkflowResult` derives label from `parallelGroups[step].candidates` lookup. Controller poller calls `aggregateResults` which collapses to pass/fail.

`spawnFn` injection (`_setSpawnFnForTest`) on engine for test mocking without tmux.

## Adapter matrix (unchanged from prior handoff)

| harness | flt adapter | model default | auth path | telemetry |
|---|---|---|---|---|
| claude-code | claude | sonnet | Anthropic Max sub | tokens+cost (jsonl) |
| codex | codex | gpt-5.3-codex | OpenAI codex OAuth | tokens+cost (NDJSON) |
| gemini | gemini | gemini-2.5-pro | GEMINI_API_KEY | convlog only |
| opencode | opencode | gpt-5.4 | OAuth proxy | tokens+cost (sqlite) |
| swe-agent | mini | gpt-5.4 | OAuth proxy | tokens (proxy strips) |
| pi | pi | gpt-5.3-codex | openai-codex provider | tokens+cost (jsonl) |
| continue-cli | cn | gpt-5.4 | OAuth proxy via workdir config.yaml | n/a |
| crush | crush | provider default | OAuth proxy via OPENAI_API_ENDPOINT | n/a |
| droid | droid | custom:gpt-5.4-(codex-oauth-proxy)-0 | OAuth proxy via .flt/droid/settings.json | n/a |
| openclaude | openclaude | sonnet | Anthropic Max sub | n/a |
| qwen | qwen | gemini-2.5-flash | Gemini OpenAI-compat endpoint | n/a |
| kilo | kilo | provider default | OAuth proxy + button-row auto-handler | n/a |

aider was REMOVED in phase 2.

## Phase 2 task queue (final state)

| # | Task | Status |
|---|---|---|
| 18–21C | (prior session) | done |
| 22 | Workflow primitives (parallel/condition/human_gate/merge_best/collect_artifacts) | **done** |
| 23 | Workflow manifest.ts + gc.ts (artifact lifecycle) | **done** |
| 24 | `flt workflow approve\|reject` + `--n` on run | **done** |
| 25 | `flt ask oracle` wrapper | **done** |
| 26 | 4 default workflows seeded by init | **done** |
| 27 | System block refinement (parent vs oracle guidance) | **done** |
| 28 | Phase 2 tests sweep | **done** (every chunk shipped its own tests) |
| 29 | Final phase 2 verification (route check + bun test + 12/12 e2e) | **done** |
| 30 | P2 polish: tag CC-only skills with `cli-support` frontmatter | deferred |

## Test inventory (added in this session)

```
tests/unit/workflow-treatment.test.ts          7 cases  (permuteTreatmentMap)
tests/unit/workflow-condition.test.ts         10 cases  (evaluateCondition expression parser)
tests/unit/workflow-results.test.ts           13 cases  (writeResult / aggregateResults; +1 hyphen-prefix bug regression)
tests/unit/workflow-parser.test.ts            24 cases  (discriminated union dispatch + per-type validation)
tests/unit/workflow-engine-plumbing.test.ts    8 cases  (run dir migration, refuse old, signal path, parallel collapse)
tests/unit/workflow-parallel.test.ts           4 cases  (treatment + spawn count + extraEnv + verdict collapse)
tests/unit/workflow-merge-best.test.ts         5 cases  (winner.json, gate-decision fallback, conflict, missing winner, non-git dir)
tests/unit/workflow-collect-artifacts.test.ts  4 cases  (parallel + non-parallel, missing files, basename normalization)
tests/unit/workflow-condition-step.test.ts     5 cases  (true→then, false→else, malformed, self-jump)
tests/unit/workflow-human-gate.test.ts         4 cases  (gate-pending write, approve, reject, invalid JSON)
tests/unit/workflow-approve-reject.test.ts     8 cases  (approve, reject, --n, error paths)
tests/unit/ask-oracle.test.ts                  4 cases  (human reply, agent fire-and-forget, timeout, missing routing)
tests/unit/init-workflows.test.ts              2 cases  (templates copy, no-overwrite)
tests/unit/workflow-manifest.test.ts           5 cases  (read/write/add/markConsumed/markExpired)
tests/unit/workflow-gc.test.ts                 6 cases  (classifyTier, hot/warm/cold, olderThan, keep=true)
```

109 new tests; 293 (start) → 402 (end).

## Critical gotchas (carryover + new)

(All prior gotchas from previous handoff still apply: restart controller after code changes, `flt kill` nukes worktree, no two agents per workdir, `.flt/.claude` gitignored, state.json shape, pi+gemini need node 22, no env isolation, opus[1m] always, harness-ts symlink, per-CLI auth differs, kilo button-row, per-CLI yolo flags.)

**New phase 2 gotchas:**

14. **Run-dir migration**: any in-flight workflow run from before this session is REFUSED at load. Cancel/rerun.
15. **claude-code-as-subagent crash (deferred bug)**: `cc-reviewer` and `cc-sonnet` presets crash a few seconds after spawn — produce ~270 tokens then session vanishes (watchdog logs "session gone; cleaning up"). Pi-coder agents are unaffected. Self-review or codex-reviewer for review pattern. Root cause unknown.
16. **`~/.flt/runs/` is shared**: harness archive files (flat `<name>-<timestamp>.json`) live alongside workflow run subdirs. `listWorkflowRuns` filters by `entry.isDirectory()` so they coexist cleanly.
17. **Parallel children agent name**: `<runId>-<stepId>-<label>` (e.g., `mywf-1-coder-a`). `signalWorkflowResult` and `getWorkflowForAgent` both check `parallelGroups[step].candidates` to map agentName → label.
18. **FLT_RUN_DIR / FLT_RUN_LABEL env injection**: `SpawnArgs.extraEnv` (added this session) is plumbed through to tmux session env, after presetEnv but before FLT_AGENT_NAME so system invariants can't be overridden.
19. **Condition self-jump is a no-op**: `then: <self>` resolves to `target === step.id` and just returns. Avoids infinite recursion. Workflow stalls until cancelled.
20. **merge_best target defaults to startBranch**: captured at `startWorkflow` from `git rev-parse --abbrev-ref HEAD` in `opts.dir`. Falls back to throw if both step.target_branch and run.startBranch are unset.

## CLI surface added this session

```
flt workflow approve <run> [--candidate <label>]
flt workflow reject <run> --reason <text>
flt workflow run <name> [--n <count>]                     # workflow-level parallel
flt ask oracle '<question>' [--from <agent>] [--timeout <ms>]
flt artifact gc [--run <id>] [--older-than <duration>]
```

## Default workflows (seeded by `flt init`)

`templates/workflows/{idea-to-pr,code-and-review,new-project,fix-bug}.yaml` copied to `~/.flt/workflows/` on init (skipped if user already has a same-named file). Each is single-agent with comments showing how to upgrade a step to `type: parallel` for tournaments.

## Architectural wins this session

**Pure-function primitives.** `permuteTreatmentMap`, `evaluateCondition`, `writeResult`/`aggregateResults` are pure modules — testable without tmux/state. Engine is a thin orchestrator on top.

**Unified verdict path.** Single + parallel both write per-candidate result files (`<runDir>/results/<step>-<label>.json`). No in-memory `run.stepResult` race; controller poller aggregates files.

**Discriminated union types.** `WorkflowStepDef` narrows by `type` field. Parser dispatches per-type with field-specific validation. Backcompat: untyped legacy steps treated as `type: 'spawn'`.

**Anonymized parallel evaluation.** Treatment map (label→preset) lives only in `manifest.json`. Evaluator agents see label-only handoffs (a/b/c.md), no preset hints.

**Subagent delegation pattern.** Per-chunk delegation to pi-coder workers in worktrees, with cherry-pick to main + self-review. Saved root context tokens. See `feedback_delegate_to_subagents.md`.

## Resume checklist on next session

```bash
# Sanity
flt controller status                           # should show running
flt list                                        # current agents
git log --oneline d7ffb68..HEAD | wc -l         # 29 commits this session
cat HANDOFF.md                                  # this file
bun test 2>&1 | tail -3                         # 402 / 0 fail expected

# Verify clean global skill state
find ~/.claude -name SKILL.md 2>/dev/null | wc -l   # 0
ls ~/.flt/skills/ | wc -l                            # 24

# Verify routing seeds present + flt route check green
cat ~/.flt/routing/policy.yaml
flt route show coder                            # {"preset":"pi-coder",...}
flt route check                                 # 11 OK · 0 WARN · 0 FAIL

# Verify default workflows present
ls ~/.flt/workflows/                            # idea-to-pr.yaml + 3 others

# Run e2e probe
tests/integration/e2e-harness.sh                # 12/12 PASS expected

# Phase 3 entry points (deferred)
# - Task 30: tag CC-only skills with cli-support frontmatter
# - claude-code-as-subagent crash investigation
# - manifest.json integration (engine doesn't yet write artifact entries; users do it manually)
# - SQLite/trace_classifier/nightly mutator (phase 3 per plan)
```

## Bug list — captured but deferred

(All prior bugs from previous handoff still tracked; new ones added.)

- **claude-code-as-subagent crash**: cc-reviewer + cc-sonnet die ~6s after spawn. Tokens emitted, session vanishes, watchdog reaps. Pi unaffected. Root cause unknown — possibly a claude-code `--print` / one-turn mode interaction with our bootstrap, or auth state. Workaround: use codex-reviewer or self-review.
- **Engine doesn't auto-populate ArtifactManifest**: `manifest.ts` provides read/write helpers but the engine doesn't yet emit `addArtifact` calls during executeStep / advanceWorkflow. GC works on whatever artifacts the workflow author registers manually. Wire when needed.
- **Concurrent `advanceWorkflow` race**: predates this session. If two callers load run.json simultaneously and both see allDone, both advance — could double-spawn next step. Bounded by poll interval; rare in practice.
- **Forced-fail prod path doesn't handle parallel groups**: `executeParallelStep` doesn't auto-prod children that go idle without verdict. The 3-prod logic only fires for the singular agent named `<runId>-<stepId>` which doesn't exist for parallel. Workaround: human cancels stuck parallel runs.
- (carryover) continue-cli/droid/qwen/kilo session-log parsing not wired in harness; convlog-only is fine for mutator.
- (carryover) swe-agent OAuth proxy strips token counts.
- (carryover) codex-proxy doesn't emit `finish_reason: "stop"`.
- (carryover) `tmux-orchestrator@tmux-orchestrator` JSON entry survives plugin remove.
- (carryover) `flt plugin audit` writes to cwd; needs `--out`.
- (carryover) Probe assert_status race for very-fast adapters.

## Memories worth knowing about

In `/Users/twaldin/.claude/projects/-Users-twaldin-flt/memory/`:
- `feedback_opus_1m.md` — opus[1m] always; never plain opus
- `feedback_completion.md` — fix to completion, not "approve with nit"
- `feedback_flt_kill.md` — capture diffs from helper worktree before kill
- `feedback_agent_patterns.md` — merge workflow, multi-agent conflict resolution
- `feedback_delegate_to_subagents.md` — pi-coder for impl + cc-sonnet/codex-reviewer for review pattern (added this session)
- `project_flt_status.md` — project status (will need refresh)
- `project_harness_ts_usage.md` — harness usage audit
