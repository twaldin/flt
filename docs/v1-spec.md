# flt v1.0 Spec

## Core Insight

The CLI is the API. The same `flt` commands work whether a human types them, an agent runs them in tmux, or a cron fires them. Everything flows through `flt spawn`, `flt send`, `flt kill`. The TUI is a view layer, not the product.

---

## Feature 1: Separate `init` from `tui`

### Problem

`flt init` currently does two things: initializes the fleet state AND launches the TUI. These should be separate. `init` is a one-time setup. The TUI is a repeatable view you open and close.

### Proposed Commands

```
flt init                    # Initialize ~/.flt/, state.json, register as orchestrator. Run once.
flt init -o [name]          # Init + spawn an orchestrator agent
flt tui                     # Open the TUI (requires init). Can quit and reopen freely.
flt status                  # Quick CLI fleet status (no TUI, replaces `flt list`)
flt shutdown                # Kill all agents, clean up worktrees, deregister orchestrator
```

### Behavior

- `flt init` creates `~/.flt/` structure if missing, writes `state.json` with orchestrator info, ensures inbox exists. Idempotent — safe to run multiple times.
- `flt tui` reads state, renders the TUI. If no init has been done, errors with "run `flt init` first."
- `flt shutdown` kills all agents in state, removes worktrees, clears state. Inverse of init.
- The `-o` flag on init stays — spawns an orchestrator agent as part of setup.

### Open Questions

- Should `flt tui` auto-init if `~/.flt/` doesn't exist? Or force explicit init?
- Should `flt shutdown` require confirmation? Kill persistent agents with unsaved state?
- Is `flt status` worth having separately from `flt list`? Or just improve `flt list` output?

---

## Feature 2: `flt workflow`

### Problem

Multi-agent loops (coder → evaluator → loop if fail) break down in natural language instructions. Agents forget to loop, misparse pass/fail, drift after a few turns. Need a deterministic state machine for routing, with agents doing the intelligent work inside each step.

### Proposed Design

```yaml
# ~/.flt/workflows/code-fix.yaml
name: code-fix
params:
  - dir        # git repo path
  - issue      # issue description or number

steps:
  - id: coder
    spawn: --preset coder --dir {dir} "Fix: {issue}. Create branch, fix, test, make PR. When done: flt workflow continue {workflow_id} --result pass --pr <number>"
    on:
      pass: evaluator
      fail: report-fail
    timeout: 15m

  - id: evaluator
    spawn: --preset evaluator --no-worktree --dir {dir} "Review PR #{pr}. Run tests. Report: flt workflow continue {workflow_id} --result pass or --result fail --reason <why>"
    on:
      pass: report-pass
      fail: coder          # loop back
    max_retries: 3

  - id: report-pass
    send: parent "Workflow {name}: PR #{pr} passing eval, ready for merge"
    cleanup: true           # kill all spawned agents

  - id: report-fail
    send: parent "Workflow {name}: failed after {max_retries} attempts"
    cleanup: true
```

### CLI

```
flt workflow run <name> [--param key=value ...]     # Start a workflow
flt workflow continue <id> --result <pass|fail> [--pr N] [--reason "..."]  # Agent advances state
flt workflow list                                    # Show running workflows
flt workflow status <id>                             # Show current step, history
flt workflow cancel <id>                             # Kill all agents, abort
```

### State Machine Rules

- Each step has an `id` and an `on` map of result → next step id
- Steps can be `spawn` (create agent), `send` (message), or `kill` (cleanup)
- `on` values are step ids — like goto in C. Simple, no magic.
- `max_retries` on a step prevents infinite loops — after N failures, goes to a fallback step or errors
- `timeout` per step — if agent doesn't call `continue` within timeout, treat as fail
- `{workflow_id}` is auto-injected so agents know which workflow to advance
- `{param}` substitution from CLI args
- `cleanup: true` kills all agents spawned by this workflow run

### State Storage

```
~/.flt/workflows/          # Workflow definitions (YAML)
~/.flt/workflow-runs/      # Active run state (JSON per run)
```

Run state JSON:
```json
{
  "id": "code-fix-1234",
  "workflow": "code-fix",
  "params": { "dir": "~/project", "issue": "#42" },
  "currentStep": "evaluator",
  "history": [
    { "step": "coder", "result": "pass", "pr": 52, "at": "2026-04-13T..." },
    { "step": "evaluator", "result": "fail", "reason": "tests broken", "at": "..." },
    { "step": "coder", "result": "pass", "pr": 52, "at": "..." }
  ],
  "retries": { "evaluator": 1 },
  "agents": ["fix-42-coder", "eval-42"],
  "startedAt": "...",
  "status": "running"
}
```

### Integration with Existing Features

- Workflows use `flt spawn` and `flt send` internally — no new primitives
- Agents spawned by workflows get `FLT_WORKFLOW_ID` env var so they know to call `flt workflow continue`
- Workflow definitions can reference presets (`--preset coder`)
- Monitor/agentelo SOUL.md says "run `flt workflow run code-fix`" instead of manually scripting the loop

### Open Questions

- Should workflows be YAML or JSON? YAML is more readable but adds a parser dep.
- Should `flt workflow continue` be the only way to advance, or should we also detect completion via inbox messages?
- How to handle agent context filling mid-workflow? Auto-compact before continuing?
- Should workflows support parallel steps (spawn coder AND researcher simultaneously)?
- Should workflow definitions be shareable (npm packages, git repos)?
- How does a workflow interact with the TUI sidebar? Show workflow status per agent?

---

## Feature 3: Agent Watchdog

### Problem

Dead agents stay dead. If a tmux session crashes, flt doesn't notice until you look. AMUX auto-restarts, flt requires human intervention.

### Proposed Design

The heartbeat cron already exists. Extend it:

1. **Dead detection**: on each heartbeat, check `tmux has-session` for every agent in state.json. If session gone → mark as `exited`.
2. **Auto-restart for persistent agents**: if a persistent agent (trader, agentelo) dies, auto-respawn using its preset + SOUL.md. Log the restart to inbox.
3. **Stuck detection**: if an agent has been `running` (active spinner) for > configured timeout without any output change, it might be stuck. Alert to inbox.
4. **Context threshold**: already built — heartbeat detects >50% context and triggers compaction.

### Configuration

```json
// ~/.flt/config.json
{
  "watchdog": {
    "autoRestart": ["trader", "agentelo"],    // agents to auto-restart if they die
    "stuckTimeout": 1800,                      // seconds before alerting on stuck agent
    "contextThreshold": 50                     // % context before auto-compact
  }
}
```

### Context % Detection Per CLI

How to scrape context usage from each CLI's tmux pane:

| CLI | Display | Regex | Auto-compact? |
|-----|---------|-------|---------------|
| Claude Code | Custom statusline `●●●○○○○○○○ 34%` | `[●○]{5,} (\d+)%` | No — we trigger via heartbeat |
| Gemini CLI | Footer `85% used` | `(\d+)% used` | Yes — `context_window_will_overflow` event |
| Codex | `X% left` in status | `(\d+)%\s+left` | Yes — auto-compacts near limit |
| Aider | Not shown | N/A | Yes — auto-summarizes chat history at `--max-chat-history-tokens` |
| OpenCode | Not shown | N/A | Unknown |

For CLIs that don't show context %, use pane-content-delta heuristics (if agent stops responding mid-generation, context may be full) or rely on the CLI's own auto-compaction.

### Open Questions

- Should watchdog be part of heartbeat cron or a separate always-running process?
- How many restart attempts before giving up? Exponential backoff?
- Should the TUI show watchdog events (restarts, compactions) in a dedicated panel?
- For CLIs without context % display, should flt track token estimates based on pane content length?

---

## Feature 4: `flt cron list`

### Problem

Users and agents set up crons via regular crontab. No visibility into which crons are flt-related.

### Proposed Design

Read-only. No add/remove — crontab is fine for that.

```
flt cron list
```

Output:
```
Schedule              Agent          Action
*/30 * * * *          monitor        spawn (codex/gpt-5.3-codex)
0 * * * *             trader         send "hourly scan"
17 7-23 * * *         cairn          heartbeat
*/30 * * * *          agentelo       send "30min check"
*/30 14-21 * * 1-5    stock-monitor  spawn (codex/gpt-5.3-codex)
30 4 * * *            —              dream-cycle
0 5 * * *             —              overnight-compact
0 6 * * *             —              news-digest
30 7 * * *            —              morning-briefing
```

Implementation: `crontab -l | grep flt`, parse the script names from paths, extract agent names from script content.

### Open Questions

- Worth the complexity? Or just document `crontab -l | grep flt` in README?
- Should `flt cron list` also show last run time (from log files)?

---

## Feature 5: Fleet Activity Log

### Problem

No structured record of what happened. The inbox is unstructured text. Need machine-readable events for debugging, observability, and workflow state.

### Proposed Design

```
~/.flt/events.jsonl     # Append-only structured event log
```

Events:
```jsonl
{"type":"spawn","agent":"coder-42","cli":"codex","model":"gpt-5.3-codex","at":"2026-04-13T..."}
{"type":"send","from":"cairn","to":"coder-42","message":"fix the bug","at":"..."}
{"type":"status","agent":"coder-42","from":"running","to":"idle","at":"..."}
{"type":"kill","agent":"coder-42","by":"cairn","at":"..."}
{"type":"workflow","workflow":"code-fix","step":"evaluator","result":"pass","at":"..."}
{"type":"compact","agent":"trader","context":"67%","at":"..."}
{"type":"restart","agent":"trader","reason":"session died","at":"..."}
```

### CLI

```
flt events [--agent name] [--type spawn|send|kill] [--since 1h]
```

### Open Questions

- JSONL vs SQLite? JSONL is simpler, SQLite enables queries.
- Retention policy? Rotate daily? Keep forever?
- Should the TUI have an events panel?

---

## Feature 6: README Rewrite

### Changes

1. **Lead with the insight**: "The same CLI works for humans, agents, and cron. `flt spawn`, `flt send`, `flt kill` — from your terminal, from an agent's tmux session, or from a cron job."
2. **Show the killer demo**: monitor → issue → coder → evaluator → inbox loop, driven by SOUL.md + cron + flt commands
3. **Explicit philosophy**: "flt is a cockpit, not an autopilot. You stay in control. Agents don't go rogue."
4. **Positioning**: "One fleet. Any agent. Your terminal."

---

## Feature 7: Persistent Agent Memory

### Problem

Agents forget everything on session clear/restart. SOUL.md and state.md are manual. Need automatic persistence.

### Proposed Design

```
flt memory set <agent> <key> <value>    # Set a key-value pair
flt memory get <agent> <key>            # Get a value
flt memory list <agent>                 # List all keys
```

Storage: `~/.flt/agents/<name>/memory.json`

Agents can call these from their tmux session. Memory survives session kills, compaction, and restarts. On boot, agents can `flt memory list <self>` to recall.

### Open Questions

- Is key-value enough? Or need structured/nested data?
- Should memory be automatically injected into agent context on boot? Or agent reads it manually?
- Size limits? Memory can grow unbounded.
- Should memory be shared across agents? Or strictly per-agent?

---

## Design Questions for /grill Review

1. **init vs tui split**: Is `flt init` + `flt tui` the right split, or should `flt` with no args launch the TUI (like lazygit)?
2. **Workflow format**: YAML vs JSON vs TypeScript for workflow definitions?
3. **Workflow scope**: Should workflows support parallel steps? Conditional branching beyond pass/fail?
4. **Watchdog placement**: Cron-based (current heartbeat) vs long-running daemon?
5. **Event storage**: JSONL vs SQLite for the activity log?
6. **Memory injection**: Auto-inject memory into agent context, or let agents pull manually?
7. **Naming**: `flt workflow` vs `flt flow` vs `flt pipe` vs `flt chain`?
8. **Publish target**: npm (requires Node compat) vs Bun-only binary? GitHub releases?
9. **Agent capability registry**: Should presets evolve into a richer "agent type" system with declared capabilities?
10. **Remote agents**: Out of scope for v1, or worth a basic SSH-based implementation?
