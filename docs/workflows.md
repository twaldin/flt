# flt Workflows

Workflows chain agents together automatically. The controller advances each step when the current agent goes idle — or when the agent explicitly signals a result with `flt workflow pass` / `flt workflow fail`.

---

## Quick start

```bash
# Place workflow definition in ~/.flt/workflows/
cat > ~/.flt/workflows/code-review.yaml << 'EOF'
name: code-review
steps:
  - id: implement
    preset: coder
    task: "Implement {task} in the auth module"
    on_complete: review

  - id: review
    preset: reviewer
    task: "Review PR {pr}. Signal pass/fail when done."
    on_complete: done
    on_fail: implement
    max_retries: 1
    worktree: false
EOF

# Start it with a task description
flt workflow run code-review -t "add OAuth login" -d ~/project

# Check progress
flt workflow status code-review

# List all workflows and active runs
flt workflow list

# Cancel if needed
flt workflow cancel code-review
```

---

## YAML schema

```yaml
name: <string>          # required — must match the filename (without .yaml/.yml)
steps:                  # required — non-empty array
  - id: <string>        # required — unique step identifier
    preset: <string>    # required for agent steps — must exist in flt presets
    task: <string>      # required for agent steps — initial message to send the agent
    dir: <string>       # optional — working directory override (supports templates)
    on_complete: <id | 'done'>  # optional — next step id or 'done' to finish
    on_fail: <id | 'abort'>     # optional — step to run on failure/signal; can loop back to an earlier step
    max_retries: <number>       # optional — default 0 (no retries on crash)
    worktree: <boolean>         # optional — default true; set false for reviewer steps that share another step's worktree
    run: <string>       # alternative to preset+task — run a shell command instead
```

`name` must match the filename without extension. `steps` must be non-empty. Step `id`s must be unique. `on_complete` and `on_fail` must reference valid step ids or the sentinels `'done'` / `'abort'`. If a preset-based step references a preset that doesn't exist, `flt workflow run` will throw immediately rather than failing mid-run.

---

## Step types

### Agent step

```yaml
- id: implement
  preset: coder
  task: "Fix the regression in src/parser.ts"
  on_complete: test
```

Spawns an agent using the named preset. The preset determines the CLI and model. The agent's name is `<run-id>-<step-id>` (e.g. `code-review-implement`). The task is sent as the bootstrap message.

When the agent goes idle (detected by the controller poller), the step is marked complete and the workflow advances. The agent is automatically killed when its step completes.

### Shell command step

```yaml
- id: notify
  run: "gh issue comment 42 --body 'Implementation complete'"
  on_complete: done
```

Runs a shell command synchronously (30-second timeout). If the command exits 0, the step is complete. If it exits non-zero, the step fails immediately (no retries).

Shell commands can use template variables — they are shell-escaped with single quotes:

```yaml
- id: copy
  run: "cp -r {steps.implement.worktree}/src ./src"
```

expands to:

```bash
cp -r '/tmp/flt-wt-code-review-implement/src' ./src
```

---

## Template variables

Later steps can reference workflow inputs and agent state from earlier steps:

| Variable | Value |
|----------|-------|
| `{task}` | Task description passed via `flt workflow run --task` |
| `{dir}` | Working directory passed via `flt workflow run --dir` |
| `{pr}` | PR URL (set automatically after the first worktree step creates a PR) |
| `{fail_reason}` | Reason string from the most recent `flt workflow fail 'reason'` call |
| `{steps.<id>.worktree}` | Absolute path to that step's git worktree (or `dir` if no worktree) |
| `{steps.<id>.dir}` | That step's working directory |
| `{steps.<id>.branch}` | That step's git branch name, or empty string |

Variables are resolved at step execution time. In `task` and `dir` fields, values are substituted as-is. In `run` fields, values are shell-escaped with single quotes. If the referenced step hasn't run yet or the variable is unknown, the placeholder is left unchanged.

---

## Pass/fail signaling

Agents inside a workflow step can explicitly direct the workflow's next transition instead of waiting for idle detection:

```bash
flt workflow pass            # advance to on_complete step
flt workflow fail 'reason'   # advance to on_fail step; reason is available as {fail_reason}
```

These commands write `stepResult` to the workflow's run state. When the agent next goes idle, the controller reads `stepResult` and routes accordingly — overriding the default idle → `on_complete` path.

This is the primary mechanism for a **reviewer agent** to loop the implementation back:

```yaml
- id: review
  preset: reviewer
  task: "Review PR {pr}. Run: flt workflow pass (approved) or flt workflow fail 'reason' (needs changes)"
  on_complete: done    # approved → done
  on_fail: implement   # needs changes → loop back to implement step
  worktree: false
```

The reviewer calls `flt workflow pass` or `flt workflow fail 'the auth is broken'`, goes idle, and the controller routes to `done` or re-runs `implement`.

---

## Auto-commit and auto-PR

After each agent step that used a git worktree, the engine automatically:

1. **Commits** any uncommitted changes (`git add -A && git commit -m "workflow: auto-commit step <id>"`)
2. **Pushes** the branch to origin
3. **Creates a PR** via `gh pr create` if none exists yet for this branch. The PR URL is stored in `{pr}` and included in the workflow completion notification.

If a PR already exists (from a previous run of the same step), the engine pushes new commits to the existing branch and PR.

The reviewer step uses `worktree: false` so it doesn't create its own branch — it reads the coder's worktree via `{steps.<id>.worktree}` and reviews the existing PR via `{pr}`.

---

## Failure handling

### Retries (crash-based)

```yaml
- id: review
  preset: reviewer
  task: "Review the PR"
  on_complete: done
  max_retries: 2
```

If the agent's tmux session disappears (crash, `exit` call), the step is marked failed. If `retries < max_retries`, a fresh agent is spawned for the same step. The retry count is tracked in the run state.

### Failure routing

```yaml
- id: implement
  preset: coder
  task: "Implement {task}"
  on_complete: review
  on_fail: notify-failure
  max_retries: 1

- id: notify-failure
  run: "flt send parent 'Implementation failed: {fail_reason}'"
  on_complete: done
```

When either `max_retries` is exhausted **or** the agent calls `flt workflow fail`:
- If `on_fail` is a step id → advance to that step (can be an earlier step to loop)
- If `on_fail` is `'abort'` or omitted → mark workflow `failed`, stop

`{fail_reason}` is populated from the string passed to `flt workflow fail 'reason'`. It is empty when failure is due to a crash.

### What counts as failure

**Crash:** The controller detects when an agent's tmux session disappears. Status transitions to `exited` and an inbox notification is sent via the watchdog. For workflow purposes, a crash respawns the step if retries remain, or routes to `on_fail`.

**Signal:** An agent can call `flt workflow fail 'reason'` at any point. On next idle, the controller routes to `on_fail`.

An agent that hangs indefinitely will not be detected as crashed — it stays `running` until the 60-second content-stable timeout forces it to `idle`, at which point the workflow advances normally via `on_complete`.

---

## Parent notification

When a workflow completes (or fails), a notification is sent to the workflow's parent:

```bash
flt workflow run code-review --parent cairn   # notifies the "cairn" agent
flt workflow run code-review                  # notifies human inbox (or caller agent if run from agent)
```

The parent is resolved when `flt workflow run` is called:
- `--parent <name>` → that agent
- `FLT_AGENT_NAME` is set (called from inside an agent) → that agent
- Otherwise → `'human'` (inbox)

On completion the parent receives: `Workflow "<name>" completed. PR: <url>` (PR URL included when a PR was created).

If the parent is an agent, the message is sent via `tmux sendLiteral` + submit keys. If the parent is dead, the message falls back to inbox.

---

## Concurrent runs

Multiple instances of the same workflow can run simultaneously. Run IDs use sequential suffixes:

- First run: `code-review`
- Second (while first is still running): `code-review-2`
- Third: `code-review-3`, etc.

Each run has its own state file at `~/.flt/workflows/runs/<id>.json`. `flt workflow status <id>` shows a specific run; `flt workflow status` without an argument shows all active runs.

---

## Run state

Each workflow's run state is persisted to `~/.flt/workflows/runs/<id>.json`:

```typescript
interface WorkflowRun {
  id: string                    // "<name>" or "<name>-<N>" for concurrent runs
  workflow: string              // workflow name
  currentStep: string           // step id currently executing
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  parentName: string            // who gets notified on completion
  stepResult?: 'pass' | 'fail'  // set by agent via flt workflow pass/fail
  stepFailReason?: string       // reason from flt workflow fail
  history: {
    step: string
    result: 'completed' | 'failed' | 'skipped'
    at: string                  // ISO timestamp
    agent?: string              // agent name for agent steps
  }[]
  retries: Record<string, number>
  vars: {
    _input: { task: string; dir: string }   // values from --task/--dir flags
    _pr?: { url: string; branch: string }   // auto-created PR
    [stepId: string]: { worktree: string; dir: string; branch: string }
  }
  startedAt: string
  completedAt?: string
}
```

---

## Example: PR-based code-and-review

The canonical use case: coder implements, engine auto-creates PR, reviewer reviews via `flt workflow pass/fail`, loops until approved.

```yaml
# ~/.flt/workflows/pr-review.yaml
name: pr-review
steps:
  - id: implement
    preset: coder
    task: "{task}"
    on_complete: review
    on_fail: abort
    max_retries: 0

  - id: review
    preset: reviewer
    task: |
      Review PR {pr} (branch: {steps.implement.branch}).
      If approved: flt workflow pass
      If changes needed: flt workflow fail '<what needs fixing>'
    on_complete: done
    on_fail: implement    # loop back — coder fixes and re-pushes
    worktree: false
```

```bash
flt workflow run pr-review -t "add rate limiting to /api/users" -d ~/project
```

Flow:
1. `implement` runs, commits, engine creates PR → `{pr}` is set
2. `review` reads the PR, calls `flt workflow fail 'missing tests'`
3. Engine loops back to `implement` with `{fail_reason}` = "missing tests"
4. `implement` adds tests, commits, pushes to same PR
5. `review` runs again, calls `flt workflow pass`
6. Workflow completes, parent notified with PR URL

---

## Example: monitor-fix-review pipeline

```yaml
# ~/.flt/workflows/monitor-fix-review.yaml
name: monitor-fix-review
steps:
  - id: fix
    preset: coder
    task: "{task}"
    on_complete: review
    on_fail: abort
    max_retries: 2

  - id: review
    preset: reviewer
    task: "Review PR {pr}. Branch: {steps.fix.branch}. Signal pass/fail."
    on_complete: notify
    on_fail: fix
    worktree: false

  - id: notify
    run: "flt send parent 'PR ready for merge: {pr}'"
    on_complete: done
```

Run from a cron-spawned monitor:

```bash
flt workflow run monitor-fix-review -t "fix the pricing bug" --parent cairn
```
