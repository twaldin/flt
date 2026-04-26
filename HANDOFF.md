# flt rewrite — session handoff (2026-04-26 evening)

## Where we are

**Phase 3 active. Eight workflows in flight, two at gate awaiting human review.** This session: recovered from a `~/.flt` wipe, fixed a slew of real bugs (pi adapter false-error regression, `flt init` non-idempotency, unresolved `{task}` in human_gate notify, missing `{fail_reason}` flow in default workflows, a phantom-fix problem where pi agents claim work they never committed, trade-up-bot's silent profit-only filter), wrote 5 default skills from skills.sh into the repo, and split a runaway "build all 6 sub-tasks at once" workflow into 3 smaller chunks.

---

## Active fleet (resume here)

```
orchestrator (claude-code/opus[1m]) — me/the next session
├── idea-to-pr-3                Track A — TUI metrics modal (key 'T', NOT 't' which is shell)
├── idea-to-pr-5                Track C — harness 12/12 sessionLogPath + py-ts parity
├── idea-to-pr-workflow-modal   Track D — TUI workflow modal (key 'w')
├── idea-to-pr-tui-display-polish  Track F — column-split + agent-name pruning + dir-row
├── idea-to-pr-gepa-b1-b2       NEW chunk: artifact hashing + transcript export
├── idea-to-pr-gepa-b3-b4       NEW chunk: metrics.json + held-out eval suite
├── idea-to-pr-gepa-b5-b6       NEW chunk: daily mutator workflow + flt promote
└── idea-to-pr-gold-mine-recover NEW recovery: cherry-picks the 1019-LOC canceled E branch
```

**At gate, awaiting Tim's review:**
- `idea-to-pr-5` (Track C harness sync) — branch `flt/idea-to-pr-5-coder`
- `idea-to-pr-workflow-modal` (Track D modal) — branch `flt/idea-to-pr-workflow-modal-coder`. Already cherry-picked to LOCAL main of `~/flt` (so Tim can press `w` and see the modal). Push or revert based on his decision.

**To approve at gate:**
```bash
flt workflow approve <run-id>
flt workflow reject <run-id> --reason "..."
flt workflow approve <run-id> --candidate <label>   # for merge_best gates with parallel candidates
```

**To unstick a workflow if it stalls** (engine poller doesn't always re-fire on stable state):
```bash
flt workflow advance <run-id>   # idempotent escape-hatch added this session
flt workflow cancel <run-id>    # cancels + removes worktrees; capture diffs first
flt workflow rename <run-id> --slug <name>   # backfill-rename a TERMINAL run
```

**Two canceled runs with branches preserved on origin** (in case salvage needed):
- `flt/idea-to-pr-4-coder` — Track B (was 304 LOC across 11 files; 31 ping-pong cycles before cancel)
- `flt/idea-to-pr-gold-mine-harvest-coder` — Track E (1019 LOC; gold-mine-recover workflow cherry-picks from this)

---

## What landed this session

### Engine + workflow fixes (commits on origin/main)

- **slug-based run IDs** (`workflow: add --slug flag + auto-derive run id slug from --task`). `idea-to-pr-modal-tui` instead of `idea-to-pr-3`. Auto-derives from `--task`; explicit override via `--slug`. Existing numeric runs keep their names; backfill via `flt workflow rename <id>`.
- **`flt workflow advance`** escape-hatch for stuck runs. Manually fires `advanceWorkflow(runId)`. Used 4× this session to break stalls where pi went idle without status delta.
- **`flt workflow rename`** for terminal-state slug backfill (renames runDir + run.json id; refuses if status === 'running' to avoid breaking live agent name lookups).
- **engine: resolve template vars in human_gate notify**. `step.notify` was passed raw to inbox/parent; `{task}` / `{steps.X.Y}` / `{pr}` showed up unrendered. Now run through `resolveTemplate`. Smoke-tested with `_smoke-gate.yaml` after controller restart.
- **engine: notify-template fix needs controller restart**. Long-running controller caches engine.ts in memory. Code edits don't apply to running fleet until: `flt controller stop && rm -f ~/.flt/controller.{pid,sock} && flt controller start`. Done once this session.
- **`worktree.ts: ensureFltGitignore()`** — auto-adds `.flt/` and `handoffs/` to project's root `.gitignore` on every `createWorktree` call. Idempotent, no commit. Caught when trade-up-bot's PR #83 leaked `.flt/bootstrap.md` + `handoffs/codex.md` into a merged commit.

### Default workflow YAMLs (rewritten this session)

`templates/workflows/idea-to-pr.yaml` and `templates/workflows/fix-bug.yaml` — both now thread:
- **Original `{task}`** into every agent's bootstrap (so reviewer/verifier know what was supposed to be built)
- **`{steps.spec.worktree}/spec.md` + `{steps.architect.worktree}/design.md`** paths into reviewer + verifier (they read them before judging)
- **`{steps.coder.branch}` + `{steps.coder.worktree}` + `{pr}`** into reviewer/verifier (so they know how to inspect the diff)
- **`{fail_reason}`** into every retry-able step's bootstrap (so the next coder/fix retry sees the previous reviewer/verifier's specific reject message verbatim)
- **fix-bug rerun** specifically tells the agent to compare failures vs `main` to distinguish pre-existing failures from "caused-by-this-fix" failures (was a major source of ping-pong)
- **gate notify** lists original task + worktree + branch + PR url for the reviewer (Tim)

Live workflows pick up these on the NEXT step transition (no controller restart needed for YAML — `loadWorkflowDef` is fresh-read).

### Five default skills vendored from skills.sh

Now in `templates/skills/`, `flt init` seeds them into `~/.flt/skills/` if missing (with `cli-support: [all]` frontmatter):

| skill | source | use |
|---|---|---|
| `find-skills` | `vercel-labs/skills` (1.2M installs) | discovery; ask "is there a skill for X" |
| `skill-creator` | `anthropics/skills` (168.7K) | bootstrap new skills |
| `browser-use` | `browser-use/browser-use` (69.7K) | open-source local browser, no API key |
| `autoresearch` | `github/awesome-copilot` | autonomous experiment loop |
| `pi-autoresearch-loop` | `aradotso/trending-skills` | pi-specific variant |

Skipped (intentional): figma (requires MCP plugin), maya (not on skills.sh), all anthropic file-ops (xlsx/pptx/docx — not used).

### `flt init` is now idempotent + restoring

`seedFlt()` now also seeds:
- 10 role .md files (`templates/roles/*.md` → `~/.flt/roles/*.md`)
- Orchestrator SOUL (`templates/agents/orchestrator/SOUL.md`)
- Default skills (`templates/skills/<name>/` → `~/.flt/skills/<name>/`)
- `mergeMissingPresets()` adds new SEED_PRESETS to existing presets.json instead of skipping if file exists

**Net effect**: `flt init` on an existing dir restores any missing seeds without forcing wipe-and-reset (Tim's complaint that triggered the `~/.flt` wipe earlier). Regression test added at `tests/unit/init.test.ts` (`restores missing role files + orchestrator SOUL on re-seed`).

### Pi adapter regression (~/harness/ts) — fixed

`pi.ts detectStatus` had a false-positive `error` regex from commit `19d007c` (Apr 25 session-aware refactor): `/error|fatal|crash/` matched the word "errors" in `bun run test → 42 failed, 19 errors` output. Pi got stuck at "error" status forever; controller poller never re-fired `advanceWorkflow`; workflows ping-ponged. Reverted to spinner-only detection (the original simple logic). Now: `[⠁-⣿]\s*Working\.\.\.` → running, else → idle. Rate-limit narrowed to require both "rate limit" AND retry/wait/seconds context. Pushed to `~/harness` repo + `bun run build` + flt controller restart.

### trade-up-bot bug fixed

PR #83 merged. Two real bugs:

1. **`mergeTradeUps` missed `collection_names`** in both UPDATE and INSERT branches. Filter dropdown read from `trade_up_inputs` (so counts looked right), filtered table read from `trade_ups.collection_names` (was empty for merge-path writes). Counts correct, results empty. Fixed in `cc27158`. Note: the agent's handoff CLAIMED to fix this but never actually committed it — Tim and I had to do it manually. (See "agent phantom claims" below.)

2. **API silently forced `AND profit_cents > 0`** when collection filter was set without min/max profit. So "Profit any" lied: 23,186 Overpass rows existed; 0 were currently profitable; table showed empty while dropdown showed 23K. Fixed in `69283ef` — removed the silent filter; documented the slow-path tradeoff in the comment.

**Backfill ran on prod**: 146,425 historical rows backfilled. **0 empty `collection_names` remaining** out of 999,973. Daemons restarted. Site shows real rows on Overpass filter now (mostly unprofitable, but real).

### Subagent crash mystery — resolved

cc-reviewer + cc-sonnet were crashing 6s after spawn during phase 2 (claimed in HANDOFF as deferred bug). After rebuild + controller restart, claude-code agents are spawning fine all session. Likely was Anthropic API back-pressure during high-concurrency bursts (we had 3+ workflows + reviewers active when each failure happened). Not reproducing post-restart.

---

## The DAG / dynamic-decomposition vision (next big feature)

Tim's design: **architect produces a dependency graph; engine executes the graph; parallelizable nodes run in parallel worktrees; a reconciler merges them**.

### Why this is needed

Current `parallel { n: 3, step: { ... } }` primitive: `n` is hardcoded at YAML-author time. Every parallel node runs the SAME step template. Reconciliation is `merge_best` (pick one winner) or `collect_artifacts` (copy files). No real DAG — no per-node task content, no dep edges, no "merge all successful".

What Tim wants: architect decides at runtime
- How many sub-tasks
- What each sub-task is
- Which depend on which
- Anything without inter-deps → parallel worktrees
- Some agent reconciles parallel work (merging, conflict resolution) into integration branch

### Proposed primitive: `dynamic_dag`

```yaml
- id: plan
  preset: cc-architect
  task: |
    Decompose: {task}. Output to plan.json:
    {
      "nodes": [
        { "id": "a", "task": "implement X", "depends_on": [] },
        { "id": "b", "task": "implement Y", "depends_on": [] },
        { "id": "c", "task": "wire X and Y together", "depends_on": ["a", "b"] }
      ],
      "default_preset": "pi-coder"
    }

- id: execute
  type: dynamic_dag
  plan_from: '{steps.plan.worktree}/plan.json'
  reconciler:
    preset: cc-evaluator
    task: |
      Merge each parallel branch (per dep order) into integration branch.
      Resolve conflicts by preferring tests-green commits.

- id: reviewer
  preset: cc-sonnet
  ...
```

### Engine semantics for `dynamic_dag`

1. Read plan.json from `plan_from` path.
2. Topological sort the nodes by `depends_on`.
3. For each "wave" (nodes with all deps complete):
   - Spawn each node as a parallel agent in its own worktree (own branch).
   - Wait for all to complete.
   - Optionally invoke `reconciler` agent: cd into a "integration" worktree, `git merge` each just-completed branch in dep order, resolve conflicts.
4. Repeat for next wave.
5. After all waves: emit final integration branch as `step.workflow_modal_tui-coder` style (compatible with existing reviewer/verifier semantics).

### Implementation cost estimate

- New primitive in `parser.ts` (validate plan.json shape) — ~50 LOC
- Engine executor in `engine.ts` — substantial:
  - Topological sort (~30 LOC)
  - Wave execution loop (~80 LOC)
  - Per-node spawn with own worktree (reuse existing parallel logic)
  - Reconciler invocation (re-uses existing spawn, but on a NEW worktree branched from integration)
  - Failure handling: per-node max_retries, wave-level abort if a node fails after retries
- Tests — ~150 LOC (mock plan.json, simulated parallel completes, conflict resolution path)

**~1-2 day chunk.** Worth a Phase 4 task once Phase 3 GEPA plumbing lands.

### Worktree-conflict reconciliation

Tim's specific concern: parallel agents work in separate worktrees on separate branches. When their work merges, conflicts may happen. Two reconciliation strategies:

- **Mechanical merge in dep-order**: `git merge --strategy=recursive` each branch onto integration. Conflicts → fail wave with reason, human resolves.
- **Reconciler-agent-driven merge**: spawn an agent in a new worktree on integration branch. Tell it: "merge branch flt/<a>, then flt/<b>, ..." with task "resolve conflicts by preferring the version that keeps tests green". Higher cost but auto-resolves more.

The default could be mechanical; reconciler is opt-in.

### Where this sits relative to existing primitives

| existing | new |
|---|---|
| `parallel { n, step }` | `dynamic_dag` (parallel where n + tasks come from architect) |
| `merge_best` (pick 1 winner) | `dynamic_dag.reconciler` (merge ALL successful) |
| `condition` | (still useful for dep-light branches) |
| `collect_artifacts` | (still useful for evaluator-input bundling) |

`dynamic_dag` doesn't replace anything; it's a new primitive that subsumes the common "architect plans + parallel execution + merge" pattern.

---

## Critical gotchas (cumulative; numbered for cross-ref)

1. **Restart controller after engine code changes**: long-running daemon caches engine.ts in memory. `loadWorkflowDef` re-reads YAML on every call (no cache), but engine logic itself is in-memory. Restart with: `flt controller stop && rm -f ~/.flt/controller.{pid,sock} && flt controller start`.
2. **Multi-line bootstrap auto-redirect**: `spawn.ts` writes multi-line bootstrap to `<workdir>/.flt/bootstrap.md`, sends a one-line redirect. Don't undo.
3. **`flt kill` nukes the worktree**: capture diff (or push branch to origin) BEFORE killing helper agents.
4. **Hard ban on two agents per workdir**: spawn refuses with clear error.
5. **`.flt/` and `.claude/` in flt repo root are gitignored**: spawn artifacts write there. Don't commit. Other projects: now auto-handled by `ensureFltGitignore()` on `createWorktree`.
6. **state.json shape**: `{"agents":{}, "config":{"maxDepth":3}}`. Empty `{}` causes runtime null-deref. Init seed handles this.
7. **pi + gemini need node 22**: bundles use Unicode regex /v flag. Adapters wrap `bash -lc "source $HOME/.nvm/nvm.sh && nvm use 22 >/dev/null; <cmd>"`.
8. **No env isolation on spawn**: dropped `CLAUDE_CONFIG_DIR` + `XDG_CONFIG_HOME` — they hid OAuth/provider config.
9. **`opus[1m]` always**: never plain `opus`. `force1mOpus` in `src/model-resolution.ts` coerces.
10. **harness-ts is a `bun link` symlink**: `node_modules/@twaldin/harness-ts → ~/harness/ts`. Edit `~/harness/ts` directly, then `bun run build` from there to regen `dist/index.js`. Then restart flt controller for new code to take effect.
11. **Per-CLI auth differs**:
    - claude-code/openclaude → Anthropic Max sub
    - codex/opencode/swe-agent/crush/kilo/droid → OAuth proxy at `127.0.0.1:10531/v1`
    - gemini → `GEMINI_API_KEY`
    - qwen → `GEMINI_API_KEY` via Gemini OpenAI-compat
    - continue-cli → workdir-written config.yaml
    - droid → workdir-written settings.json
    - pi → pi's own provider config
12. **kilo dialog detection uses BUTTON ROW**, not title. Titles linger after dialog closes.
13. **Per-CLI auto-approve flags**: gemini `--yolo`, claude-code `--dangerously-skip-permissions`, codex `--dangerously-bypass-approvals-and-sandbox`.
14. **Run-dir migration**: in-flight pre-2026-04-26 runs are REFUSED at load. Cancel/rerun.
15. **`~/.flt/runs/` is shared**: harness archives (flat `<name>-<ts>.json`) and workflow run subdirs coexist. `listWorkflowRuns` filters by `entry.isDirectory()`.
16. **Parallel children agent name**: `<runId>-<stepId>-<label>`. `signalWorkflowResult` and `getWorkflowForAgent` both check `parallelGroups[step].candidates`.
17. **`SpawnArgs.extraEnv`** plumbed to tmux env after `presetEnv` but before `FLT_AGENT_NAME`. Used for `FLT_RUN_DIR` + `FLT_RUN_LABEL`.
18. **Condition self-jump is a no-op**: `then: <self>` → return. Avoids infinite recursion.
19. **merge_best target_branch defaults to `run.startBranch`** captured at start.
20. **Pi-coder false-error regression**: `error|fatal|crash` substring match in pi `detectStatus` was matching test-output stack traces. Reverted to spinner-only. Don't re-add broad error pattern. (commit `5eb443e` in `~/harness`)
21. **Controller poller fires advance only on status changes**, not on result-file appearance. If pi writes `flt workflow fail` then idles (status stable), advance never fires. Workaround: `flt workflow advance <run>`. Real fix (deferred): make poller also fire on results-dir mtime change.
22. **Agent phantom claims in handoffs**: pi-coder sometimes writes to `handoffs/<role>.md` describing "I fixed X" without the file change actually being committed. The auto-commit pattern (`git add -A && git diff --cached --quiet || git commit`) silently no-ops if there are no staged changes. Reviewer should cross-reference `handoffs/<x>.md` claims vs `git diff main...HEAD`. Defer-fix: enhance reviewer task in YAML to require diff-vs-handoff cross-check.
23. **Default workflow uses sequential coder retries, not parallel**. Switching to parallel is "edit the YAML to use `type: parallel`" (commented-out example exists). Tournament workflow not yet shipped per Tim's call.
24. **handoffs/ files lie**: paired with #22, agents are also writing to `<cwd>/handoffs/<role-or-model>.md` instead of `$FLT_RUN_DIR/handoffs/<label>.md` per the system block guidance. Path discrepancy. Plus collect_artifacts isn't in default workflows so they're not collected. Tim called this out: handoffs are redundant with template vars + git diff. **Action: strip the handoff guidance from system block** (next session cleanup).
25. **`flt init` no longer forces wipe**: roles, SOUL, skills, presets all auto-restored on re-init if missing. Tim previously had to `tar + rm -rf` to add new templates; that's no longer necessary.

## Resume checklist

```bash
# Sanity
flt controller status                           # should show running
flt list                                        # 8 active workflows expected
git log --oneline -10                           # session commits
cat HANDOFF.md                                  # this file
bun test 2>&1 | tail -3                         # 419 pass / 0 fail expected (+5 if Track D cherry-pick still on local main)

# Verify workflows
flt workflow list                               # all 8 active runs
for w in idea-to-pr-3 idea-to-pr-5 idea-to-pr-workflow-modal idea-to-pr-tui-display-polish idea-to-pr-gepa-b1-b2 idea-to-pr-gepa-b3-b4 idea-to-pr-gepa-b5-b6 idea-to-pr-gold-mine-recover; do
  echo "=== $w ==="
  flt workflow status $w | head -5
done

# Things to do
# 1. Approve / reject Track C + Track D gates (idea-to-pr-5 + idea-to-pr-workflow-modal)
# 2. If Track D approved: push the local main cherry-pick to origin
# 3. Watch Track A + Track F (both at reviewer when handoff written; about to gate)
# 4. Watch the 3 new GEPA chunks + gold-mine-recover (all at spec; longer wait)
# 5. After all gates: cherry-pick approved branches to main, push.

# If a workflow stalls
flt workflow advance <run>                      # fire advanceWorkflow manually
# If still stuck (rare)
flt workflow cancel <run>                       # captures diff, removes worktree

# If pi-coder agents misbehave again
# Check: tail -50 ~/.flt/logs/flt-<agent>.tmux.log
# Pipe-pane logs every session live; great for diagnosing post-mortem.

# To verify trade-up-bot fix
# Open https://tradeupbot.app, filter by 'Overpass 2024 Collection' — should show ~20K rows
# Confirm DB:
ssh -i ~/.ssh/tradeupbot-deploy root@tradeupbot.app 'set -a && . /opt/trade-up-bot/.env && set +a && psql "$DATABASE_URL" -tAc "select count(*) filter (where collection_names is null or array_length(collection_names, 1) is null), count(*) from trade_ups"'
# expects 0|999973 or similar
```

## Bug list — captured but deferred

- **Concurrent `advanceWorkflow` race**: predates this session. Bounded by poll interval; rare in practice.
- **Forced-fail prod path doesn't handle parallel groups**: `executeParallelStep` doesn't auto-prod children that go idle without verdict. Workaround: human cancels stuck parallel runs.
- **Engine doesn't auto-populate ArtifactManifest**: `manifest.ts` provides read/write helpers but engine doesn't yet emit `addArtifact` calls. Wire when `dynamic_dag` reconciler needs it.
- **Workflows can ping-pong unboundedly** when reviewer.on_fail → coder + verifier.on_fail → coder. Coder's max_retries doesn't apply because the retries counter only increments on direct self-loop. **Real fix**: track step-visit count cumulatively, abort after N total transitions per step regardless of which path. Defer.
- **continue-cli/droid/qwen/kilo session-log parsing not wired in harness/ts**. Track C is supposed to fix.
- **swe-agent OAuth proxy strips token counts**.
- **codex-proxy doesn't emit `finish_reason: "stop"`**.
- **`tmux-orchestrator@tmux-orchestrator` JSON entry survives plugin remove**.
- **`flt plugin audit` writes to cwd**; needs `--out` flag.
- **Probe assert_status race for very-fast adapters**.
- **Dropdown count vs filtered-table mismatch in trade-up-bot**: the dropdown counter still uses the old shape (probably profitable-only too?). Tim removed the silent `profit_cents > 0` from the FILTER endpoint, but the dropdown count source may still apply it. Worth a follow-up if Tim notices the counts don't match.
- **#22 phantom-claim handoffs**: reviewer should cross-reference handoff claims vs actual diff.
- **#21 results-file-only stalls**: poller should fire on results-dir mtime change, not just status changes.
- **`handoffs/` system block guidance is misleading**: agents write to wrong path; collect_artifacts not wired to use them; redundant with template vars + git diff. Strip from `templates/system-block-subagent.md` next session.

## Architectural wins this session

- **`flt workflow advance`** as escape hatch — used 4× to break stalls, now permanent infra.
- **Slug-based run IDs** make TUI + logs much more readable. `idea-to-pr-gepa-b1-b2` reads as the work it represents.
- **Init idempotency** — roles, SOUL, skills, presets all restorable. The wipe-and-reset workflow is dead.
- **YAML-as-load-on-demand** confirmed working: workflow YAML changes apply on the NEXT step transition without controller restart. Verified empirically (tracks B + E used new YAML mid-run after we updated it).
- **gitignore-on-spawn** prevents trade-up-bot-style `.flt/bootstrap.md` leaks systemically.
- **Track D is using itself** — Tim viewed the workflow modal modal via `w` keybind to identify the column-split + agent-name issues that became Track F. Pure dogfood.

## Memories worth knowing about

In `/Users/twaldin/.claude/projects/-Users-twaldin-flt/memory/`:
- `feedback_opus_1m.md` — opus[1m] always; never plain opus
- `feedback_completion.md` — fix to completion, not "approve with nit"
- `feedback_flt_kill.md` — capture diffs from helper worktree before kill
- `feedback_agent_patterns.md` — merge workflow, multi-agent conflict resolution
- `feedback_delegate_to_subagents.md` — pi-coder for impl + self-review pattern
- `feedback_never_native_subagents.md` — never use claude-code's `Agent`/`Task` tool in flt; flt only
- `project_flt_status.md` — refreshed: 12 adapters, phase 3 active
- `project_harness_ts_usage.md` — harness usage audit
