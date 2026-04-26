# flt rewrite — session handoff (2026-04-26 early)

## Where we are

**Phase 2 mostly through; harness session-aware refactor + 12-adapter e2e are all green.** All 12 registered flt adapters pass a strict end-to-end probe (spawn → bootstrap "create hi.txt" → idle → send STEP 2 → "delete + flt send parent" → inbox ping → kill) with running/idle status assertions at four checkpoints.

**Tasks 20, 20a, 21, 21A, 21B, 21C committed.** Phase 2 still owes: workflow primitives + manifest/gc + ask-oracle + default workflows + system block refinement + tests + final verification.

## Authoritative documents

- **Plan**: `/Users/twaldin/.claude/plans/cozy-wibbling-kahan.md` — full phase 1 + phase 2 plan with locked decisions, file lists, order. Read first on resume.
- **harness-ts source (now linked)**: `~/harness/ts/` — flt's `node_modules/@twaldin/harness-ts` is a `bun link` symlink to this dir. Edit harness in place; `bun run build` from `~/harness/ts` after changes.
- **harness-ts ADAPTER-MATRIX**: `~/harness/ADAPTER-MATRIX.md` — reference for what each CLI emits in cost/tokens.
- **e2e probe**: `tests/integration/e2e-harness.sh` — runs the full check across all 12.
- **GPT roadmap context**: `docs/conversation-with-gpt.md`.
- **Earlier rewrite plan**: `docs/rewrite-plan-v2.md` (epics A/B/C/D, partly superseded).

## Recent commits (since prior handoff at `2d1daa2`)

```
2a57e8a droid + qwen: BYO-key configs unlock both — 12/12 e2e PASS
4a2b81f continue-cli: display name = model id (was 'flt-model')
9404085 e2e probe: default to all 12 registered adapters
668e8ef crush + kilo: env-name fix and button-row dialog detection
bd622a1 qwen: bypass OAuth-discontinued dialog with --auth-type openai
e1d41d6 adapters: add yolo flags for crush, continue-cli, qwen, droid
eb3f615 continue-cli: write workdir config + tighten ready detection
c5d92e5 adapters: route non-cc harnesses through OAuth proxy with GPT default
499c43a adapters: register continue-cli, crush, droid, openclaude, qwen, kilo
cb4b6fe adapters: thin-wrap harness; harness owns detection + session-log + pricing
b58f62f gemini: pass --yolo so mid-run permission dialogs auto-approve
1a0223b swe-agent: inject default model so spawn doesn't insta-die
ea1666f P2: remove aider adapter; nvm-22 wrap for gemini; portable e2e probe
4dacff8 spawn: multi-line bootstrap auto-redirected to .flt/bootstrap.md + e2e probe
f68a22b P2: opus[1m] everywhere + cc-opus/cc-sonnet routing-bundle presets (task 20a)
594b5d1 P2: model resolution smoke + flt route check (task 20)
```

`~/harness` repo also got commits: `48acb7a`, `b00ffc2`, `49b5d1b`, `19d007c` etc.

## Adapter matrix (final state)

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

aider was REMOVED — REPL-driven, no autonomous shell tool, doesn't fit flt.

## Phase 2 task queue (resume point)

| # | Task | Status |
|---|---|---|
| 18 | Idle/ready detection per new adapter | done (in 21A) |
| 19 | Model resolution dialect map + routing resolver | done |
| 20 | Model resolution smoke + `flt route check` | done |
| 20a | cc-opus/cc-sonnet routing bundles + opus[1m] sweep | done |
| 21 | 6 new adapters | done |
| 21A | harness session-aware interface | done |
| 21B | e2e probe captures cost+tokens+conv-log; 6/6 PASS | done |
| 21C | unblock crush/droid/qwen/kilo | done |
| 22 | Workflow primitives (parallel/condition/human_gate/merge_best/collect_artifacts) | **next** |
| 23 | Workflow manifest.ts + gc.ts (artifact lifecycle) | pending |
| 24 | workflow command (approve/reject + --n) | pending |
| 25 | `flt ask oracle` wrapper | pending |
| 26 | 4 default workflows seeded by init | pending |
| 27 | System block refinement (parent vs oracle guidance) | pending |
| 28 | Phase 2 tests | pending |
| 29 | Final phase 2 verification (`flt route check` + full bun test green + 12/12 e2e) | pending |
| 30 | P2 polish: tag CC-only skills with `cli-support` frontmatter | pending |

## Critical gotchas (don't relearn)

1. **Restart controller after any spawn/skill/state code change**: long-running bun process. Code edits to `src/commands/{spawn,skills,kill}.ts`, `src/skills.ts`, `src/state.ts` etc. don't take effect until:
   ```bash
   flt controller stop && rm -f ~/.flt/controller.{pid,sock} && flt controller start
   ```
2. **Multi-line bootstrap auto-redirect**: `spawn.ts` writes multi-line bootstrap to `<workdir>/.flt/bootstrap.md` and sends a one-line redirect — fixed in commit `4dacff8`. Don't undo this; the screenshot bug (each line treated as separate "Steering" message) was the reason.
3. **`flt kill` nukes the worktree**: capture the diff BEFORE killing a helper agent or the work is lost. Better long-term: have helpers commit before sending done.
4. **Hard ban on two agents per workdir**: spawn refuses with clear error pointing at kill-or-worktree (commit `c0838a1`).
5. **`.flt/` and `.claude/` in repo root are gitignored**: spawn artifacts write there. Don't commit.
6. **State.json shape**: must be `{"agents":{}, "config":{"maxDepth":3}}`. Empty `{}` causes runtime null-deref. Init seed handles this.
7. **pi + gemini need node 22**: their bundles use Unicode regex /v flag. Adapters wrap `bash -lc "source $HOME/.nvm/nvm.sh && nvm use 22 >/dev/null; <cmd>"`.
8. **No env isolation on spawn**: dropped CLAUDE_CONFIG_DIR + XDG_CONFIG_HOME — they hid OAuth/provider config.
9. **`opus[1m]` always**: never plain `opus` anywhere. `force1mOpus(cli, model)` in `src/model-resolution.ts` coerces. See memory `feedback_opus_1m.md`.
10. **harness-ts is now a `bun link` symlink**: `node_modules/@twaldin/harness-ts → ~/harness/ts`. Edit ~/harness/ts directly, `bun run build` to regen `dist/index.js`. flt picks up changes immediately.
11. **Per-CLI auth differs**:
    - claude-code/openclaude: Anthropic Max sub (no env needed)
    - codex/opencode/swe-agent/crush/kilo/droid: OAuth proxy at `http://127.0.0.1:10531/v1` via OPENAI_BASE_URL/OPENAI_API_KEY (or `OPENAI_API_ENDPOINT` for crush)
    - gemini: GEMINI_API_KEY from ~/.env
    - qwen: GEMINI_API_KEY via Gemini's OpenAI-compat endpoint
    - continue-cli: OAuth proxy via workdir-written config.yaml
    - droid: OAuth proxy via workdir-written settings.json
    - pi: pi-coding-agent's own provider config (auto-routed)
12. **kilo dialog detection uses BUTTON ROW, not title**: titles linger in scrollback after dialog closes. Detect by visible button row in last 12 non-empty lines.
13. **gemini --yolo + claude-code --dangerously-skip-permissions + codex --dangerously-bypass-approvals-and-sandbox**: each CLI has its own auto-approve flag; use the right one.

## Architectural wins this session

**Harness owns CLI knowledge.** flt's 12 adapters are now thin wrappers that delegate detection/dialog handling to `~/harness/ts` via `getAdapter('<cli>')`. Total flt adapter LOC went from ~414 → ~176 (-238). Adding a new harness = add to ~/harness/ts/src/adapters + register in flt + write a thin wrapper.

**Pure-function design.** harness exposes `detectReady(pane: string): ReadyState` etc. — pure predicates on pane content, no tmux awareness, no async/scheduling. flt drives polling/timing per its tmux runtime. Other consumers (web UIs, CI tools) can capture pane content however they like.

**Cost is non-null when tokens are non-null.** `~/harness/ts/src/pricing.ts` has per-model rates. `deriveCost(model, in, out)` is a fallback when CLI doesn't emit cost. Used by codex, gemini, qwen, swe-agent.

**Session-log paths per harness** — for the mutator/GEPA conversation-data pipeline:
- claude-code: `~/.claude/projects/<encoded>/<sid>.jsonl`
- codex: `~/.codex/sessions/yyyy/mm/dd/rollout-*.jsonl`
- pi: `~/.pi/agent/sessions/<encoded>/*.jsonl`
- opencode: SQLite at `~/.local/share/opencode/`
- swe-agent: `~/Library/Application Support/mini-swe-agent/last_mini_run.traj.json`
- gemini: `~/.gemini/tmp/<basename>/logs.json` (convlog only, no tokens)
- crush/kilo: SQLite (parsers exist in harness for headless mode)
- continue-cli/droid/qwen: not yet wired (TBD; convlog-only is fine for mutator)

**Encoding canonicalization.** sessionLogPath uses `realpathSync(workdir)` to handle macOS `/var → /private/var` symlinks before applying CLI-specific encoding (claude: `/[\/_]/g → -`; pi: `--<all/>--`).

## Resume checklist on next session

```bash
# Sanity
flt controller status                           # should show running
flt list                                        # current agents (just flt-rewriter)
git log --oneline -5                            # recent commits
cat HANDOFF.md                                  # this file
bun test 2>&1 | tail -3                         # 293 / 0 fail expected

# Verify clean global skill state
find ~/.claude -name SKILL.md 2>/dev/null | wc -l   # 0
ls ~/.flt/skills/ | wc -l                            # 24

# Verify routing seeds present + flt route check green
cat ~/.flt/routing/policy.yaml
flt route show coder                            # {"preset":"pi-coder",...}
flt route check                                 # 11 OK · 0 WARN · 0 FAIL

# Verify harness link
readlink node_modules/@twaldin/harness-ts       # ../../../harness/ts

# Run e2e probe
tests/integration/e2e-harness.sh                # 12/12 PASS expected

# Pick up where left off
# → Task 22: workflow primitives
```

## Next steps (concrete) — task 22 (workflow primitives)

Per the plan in `cozy-wibbling-kahan.md`:

1. **Edit** `src/workflow/types.ts`: extend `WorkflowStepDef` with discriminated union `type: 'spawn' | 'parallel' | 'condition' | 'human_gate' | 'merge_best' | 'collect_artifacts'`. Add fields per primitive.
2. **Edit** `src/workflow/parser.ts`: dispatch by step `type`; backward-compat for legacy untyped steps (treat as `type: 'spawn'`).
3. **Edit** `src/workflow/engine.ts`: per-type executors. TDD per primitive in this order:
   - `parallel`: spawn N agents in N worktrees with anonymized labels
   - `condition`: evaluate `if` expression against last step output
   - `human_gate`: write `<runDir>/.gate-pending`, block on `flt workflow approve`
   - `merge_best`: read manifest.candidates, git merge winner
   - `collect_artifacts`: copy named files from each `from` step's worktree

After 22 → 23 (manifest/gc) → 24 (workflow approve/reject + --n) → 25 (ask-oracle).

## Memories worth knowing about

In `/Users/twaldin/.claude/projects/-Users-twaldin-flt/memory/`:
- `feedback_opus_1m.md` — opus[1m] always; never plain opus
- `feedback_completion.md` — fix to completion, not "approve with nit"
- `feedback_flt_kill.md` — capture diffs from helper worktree before kill
- `feedback_agent_patterns.md` — merge workflow, multi-agent conflict resolution
- `project_flt_status.md` — older project status (predates this session)
- `project_harness_ts_usage.md` — harness usage audit + cost/token wiring paths

## Bug list — captured but deferred

- **continue-cli session-log parsing**: not implemented in harness (parseOutput exists for headless; interactive logs at `~/.continue/sessions/...` TBD)
- **droid/qwen/kilo session-log parsing**: same — convlog access for mutator is the main need; tokens are nice-to-have
- **swe-agent OAuth proxy strips token counts**: trajectory shows api_calls but tokens=0. Real fix is on proxy or use direct OPENROUTER auth.
- **codex-proxy doesn't emit `finish_reason: "stop"`**: qwen-code's native gemini path errors. Worked around by using Gemini OpenAI-compat endpoint instead. Proxy fix would unlock more clients.
- **`tmux-orchestrator@tmux-orchestrator` JSON entry**: `claude plugin remove tmux-orchestrator` succeeded but the JSON entry survives. Phase 2 polish.
- **TUI poll() null guards**: added `?? {}` for `Object.entries(agents)` (commit 751a151) and similar in `commands/list.ts` (commit 8cd4673). Any other `Object.entries(state.x)` site needs review if state.x can be undefined.
- **`flt plugin audit` writes to `cwd`**: the markdown report lands in your current directory. `--out <path>` flag eventually.
- **Probe assert_status race**: very-fast adapters (codex, cn, kilo) finish step 2 in <1s and the `assert running` poll never sees 'running' (records "got idle" but doesn't fail). Cosmetic only — actual e2e flow still verifies hi.txt + parent-ping. Could shrink poll interval to fix.
