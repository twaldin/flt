# flt ↔ harness Migration — Split Analysis

Scope: what parts of `flt/src/adapters/*.ts` can delegate to the `harness`
Python library, and what MUST stay flt-native.

## Fundamental shape mismatch

`harness` is a **batch one-shot** API. `harness.run(RunSpec(...))` invokes
`claude -p "prompt" --output-format json` via `subprocess.run`, waits for
exit, parses the final JSON envelope, returns `tokens_in/out`,
`cost_usd`, `exit_code`, `duration`.

`flt` is an **interactive tmux** orchestrator. It creates a tmux session
running `claude --dangerously-skip-permissions`, monitors the pane with
`capture-pane`, detects ready/dialog/spinner states by regex, sends keys
with `tmux send-keys`, and relays messages between agents via `flt send`.

These are NOT substitutable. An interactive claude session does not emit
the `--output-format json` envelope — there is no final envelope, there
is a running TUI.

**Consequence**: flt's spawn path cannot be migrated to `harness.run`.
Interactive spawning, TUI readiness detection, dialog auto-approval,
spinner-based status, and inter-agent tmux messaging stay flt-native.

## Per-adapter field: migratable vs. flt-native

| flt `CliAdapter` field | Migratable? | Reason |
| --- | --- | --- |
| `name` | No | Registry key. |
| `cliCommand` | **DEAD** | Declared in every adapter, never read anywhere in `src/`. Drop in separate cleanup commit. |
| `instructionFile` | Partial | Same mapping exists in harness. flt has richer injection (template + SOUL.md + `<!-- flt:start -->` markers + backup/restore). Keep flt's pipeline. |
| `submitKeys` | No | tmux send-keys — no meaning in subprocess.run. |
| `spawnArgs` | No (interactive) | Targets long-lived TUI mode, not `-p`. |
| `env` | Partial | Could share loader helpers later; not in scope. |
| `detectReady` | No | Depends on live TUI pane. |
| `handleDialog` | No | Interactive-only. |
| `detectStatus` | No | Live pane spinner detection. |

## Cost / token tracking — the real migration

`flt` tracks ZERO cost or token data. `grep -n "cost_usd\|tokens_in" src/`
returns nothing. `harness` parses cost per-adapter (see README "Why"
section): claude-code JSON envelope, codex JSONL turn events, opencode
session sqlite, gemini stats.models, aider scrape, swe-agent trajectory.

The migration is: **add cost tracking to flt by invoking harness AFTER
an interactive flt agent exits**. Harness owns the parsing; flt owns the
spawn lifecycle. When `flt kill` runs, or when flt notices an agent's
tmux session has died, flt shells out to harness to extract cost/tokens
from the agent's on-disk trace (session file / session sqlite /
trajectory), saves it into agent state, surfaces it in `flt list`.

This is **lowest-risk, highest-value** because:

- Zero change to interactive spawn, tmux streaming, dialog handling.
- Uses harness logic that already works for each CLI.
- Adds a capability flt doesn't have.
- When harness gains a new adapter's cost parser, flt gets it for free.

### Sub-decision: how flt calls harness for parsing

Two approaches:

**(A) Shell out to `harness run --json` retrospectively** — cannot work.
`harness run` re-invokes the CLI; we want to parse a *past* session, not
run a new one.

**(B) New harness subcommand: `harness extract --harness <name> --workdir <path> [--session <id>]`**
that reads the on-disk artifact the adapter already knows about
(`~/.claude/projects/<slug>/<session>.jsonl` for claude-code, opencode's
session sqlite under `~/.local/share/opencode/session.db`, etc.), runs
the existing per-adapter parser, emits the same RunResult-shaped JSON
subset (`cost_usd`, `tokens_in`, `tokens_out`). flt shells out to this
with `{ stdio: inherit }` in a one-shot child process; no tmux involved
because parsing is instantaneous.

This branch adopts (B). Adding `harness extract` is a small addition to
harness (new CLI subcommand, per-adapter `extract()` method that factors
out the JSON-parsing code that already exists in each `run()`). Kept out
of scope of this branch if the harness change becomes non-trivial; in
that case fall back to flt parsing the session JSONL directly for
claude-code (one CLI only) and revisit cross-adapter coverage later.

## Call flow — before / after

### Before: `flt spawn` + `flt kill`

```
flt spawn coder --cli claude-code --model sonnet
  └─ tmux.createSession("flt-coder", workDir, "claude --dangerously-skip-permissions --model sonnet")
  └─ waitForReady(...) — poll pane, handle dialogs
  └─ setAgent("coder", {cli, model, tmuxSession, dir, spawnedAt, ...})
  └─ [optional] sendBootstrap(...)

(time passes — user chats with coder through tmux)

flt kill coder
  └─ tmux.killSession("flt-coder")
  └─ removeAgent("coder")
  └─ appendEvent({type:"kill", agent:"coder"})
```

**No cost/token data anywhere in this flow.**

### After: `flt spawn` unchanged, `flt kill` gains a parse step

```
flt spawn coder --cli claude-code --model sonnet       # UNCHANGED
  └─ (same as before)

flt kill coder
  ├─ agent = getAgent("coder")                          # NEW — capture before remove
  ├─ tmux.killSession("flt-coder")                      # UNCHANGED
  ├─ [NEW] costResult = harnessExtract({harness: agent.cli,
  │                                    workdir: agent.dir,
  │                                    spawnedAt: agent.spawnedAt})
  │         # shells out to `harness extract --harness claude-code
  │         #   --workdir <wt> --since <spawnedAt> --json`, parses stdout
  │         # -> { cost_usd, tokens_in, tokens_out }
  ├─ [NEW] appendEvent({type:"kill", agent, cost_usd, tokens_in, tokens_out})
  ├─ removeAgent("coder")                               # UNCHANGED
  └─ [NEW] archiveAgentCost("coder", costResult)        # persisted under
                                                        #   ~/.flt/agents/coder/run.json
                                                        #   so `flt activity` / logs can show it

flt list           # UNCHANGED behavior for live agents;
                   # killed agents that had cost recorded can be shown from archive
```

**Key properties:**

- Spawn path: byte-for-byte identical. No regression risk to tmux
  streaming, readiness detection, dialogs, or inter-agent messaging.
- Kill path: gains one best-effort subprocess call. If `harness extract`
  fails (missing binary, unsupported adapter, no session found), flt
  logs the failure and continues to remove the agent. Cost just won't be
  recorded — same state as today.
- Cost data is additive. No existing consumer depends on its presence.

### Minimal surface area for the live test

1. Add `src/harness.ts`: thin wrapper that spawns `harness extract ...`
   via `Bun.spawn`, parses `--json` stdout, returns `{ cost_usd,
   tokens_in, tokens_out } | null`.
2. Hook one call site: `src/commands/kill.ts` — call `harnessExtract`
   before `removeAgent`, append to activity event, optionally write to
   `~/.flt/agents/<name>/run.json`.
3. Live test:
   - `flt spawn coder --cli claude-code --model sonnet` (verify tmux
     streams normally).
   - Send a small prompt through tmux, wait for reply.
   - `flt kill coder`.
   - Verify `~/.flt/agents/coder/run.json` contains non-null cost +
     tokens, and activity log line shows `cost=$0.XXXX`.

If `harness extract` is not yet available, fallback for this branch is
to make `harnessExtract` call a minimal flt-local JSONL parser for
claude-code only (functions copy the parser from harness to prove the
boundary works). That would be acknowledged in the commit message and
treated as a followup to port into harness properly.

## Out of scope for this branch

- `detectReady`, `handleDialog`, `detectStatus` migration.
- `spawnArgs`, `env`, `submitKeys` for interactive spawn.
- Replacing flt's instruction injection with harness's
  `write_instructions`.
- Workflow engine changes.
- Cron / activity / controller changes beyond the single kill hook.

## Followups (later branches)

- Extend harness coverage to all six adapters' `extract()` paths.
- Live cost polling during long-running interactive sessions (not just
  at kill time) — optional nicety.
- `flt list` column for cumulative cost.
- `harness list` → `flt adapters` parity check in CI.
