# flt Workflows

Workflows chain agents together automatically. The controller advances each step when the current agent goes idle — no polling scripts, no manual hand-offs.

---

## Quick start

```bash
# Place workflow definition in ~/.flt/workflows/
cat > ~/.flt/workflows/code-review.yaml << 'EOF'
name: code-review
steps:
  - id: implement
    preset: coder
    task: "Implement feature X in the auth module"
    on_complete: review

  - id: review
    preset: reviewer
    task: "Review the changes in {steps.implement.worktree}"
    on_complete: done
    max_retries: 1
EOF

# Start it
flt workflow run code-review

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
    on_fail: <id | 'abort'>     # optional — step to run on failure after retries exhausted
    max_retries: <number>       # optional — default 0 (no retries)
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

Spawns an agent using the named preset. The preset determines the CLI and model. The agent's name is `<workflow>-<step-id>` (e.g. `code-review-implement`). The task is sent as the bootstrap message.

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

Later steps can reference agent state from earlier steps:

| Variable | Value |
|----------|-------|
| `{steps.<id>.worktree}` | Absolute path to the agent's git worktree (or `dir` if no worktree) |
| `{steps.<id>.dir}` | Agent's working directory |
| `{steps.<id>.branch}` | Git branch name (e.g. `flt/code-review-implement`), or empty string |

Variables are resolved at step execution time, using values captured immediately after the referenced step's agent was spawned. If the referenced step hasn't run yet or the variable is unknown, the template placeholder is left unchanged.

In `task` and `dir` fields, variables are substituted as-is. In `run` fields, values are shell-escaped with single quotes before substitution.

---

## Failure handling

### Retries

```yaml
- id: review
  preset: reviewer
  task: "Review the PR"
  on_complete: done
  max_retries: 2
```

If the agent dies (its tmux session disappears), the step is marked failed. If `retries < max_retries`, the failed agent is killed, and a fresh agent is spawned for the same step. The retry count is tracked in the run state.

### Failure routing

```yaml
- id: implement
  preset: coder
  task: "Implement feature X"
  on_complete: review
  on_fail: notify-failure
  max_retries: 1

- id: notify-failure
  run: "flt send parent 'Implementation failed after retries'"
  on_complete: done
```

When `max_retries` is exhausted:
- If `on_fail` is a step id → advance to that step
- If `on_fail` is `'abort'` or omitted → mark workflow `failed`, stop

### What counts as failure

The controller detects failure by watching for the agent's tmux session to disappear while the workflow is still `running`. This means a crash or an agent that calls `exit` is detected. An agent that hangs indefinitely will not be detected as failed — it will stay `running` until killed manually or the content-stable timeout fires (60s), at which point it becomes `idle` and the workflow advances normally.

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

On completion, the parent receives: `Workflow "<name>" completed.`

If the parent is an agent, the message is sent via `tmux sendLiteral` + submit keys (same as `flt send`). If the parent is dead, the message falls back to inbox.

---

## Run state

Each workflow's run state is persisted to `~/.flt/workflows/<name>/run.json`:

```typescript
interface WorkflowRun {
  id: string                    // "<name>-<timestamp>"
  workflow: string              // workflow name
  currentStep: string           // step id currently executing
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  parentName: string            // who gets notified on completion
  history: {
    step: string
    result: 'completed' | 'failed' | 'skipped'
    at: string                  // ISO timestamp
    agent?: string              // agent name for agent steps
  }[]
  retries: Record<string, number>               // retry count per step
  vars: Record<string, { worktree, dir, branch }>  // captured agent vars per step
  startedAt: string
  completedAt?: string
}
```

Only one run per workflow name is tracked. Starting a workflow when one is already `running` throws an error. `flt workflow cancel` sets status to `'cancelled'` and kills the current step's agent.

---

## Example: monitor-fix-review pipeline

```yaml
# ~/.flt/workflows/monitor-fix-review.yaml
name: monitor-fix-review
steps:
  - id: fix
    preset: coder
    task: "Fix the bug described in ~/.flt/agents/monitor/SOUL.md"
    on_complete: review
    on_fail: abort
    max_retries: 2

  - id: review
    preset: reviewer
    task: "Review the changes in {steps.fix.worktree}. Branch: {steps.fix.branch}"
    on_complete: notify
    on_fail: abort
    max_retries: 1

  - id: notify
    run: "flt send parent 'PR ready for merge from branch {steps.fix.branch}'"
    on_complete: done
```

Run from a cron-spawned monitor:

```bash
flt workflow run monitor-fix-review --parent cairn
```

---

## Example: parallel presets with shell merge

Workflows execute steps serially. To simulate parallel work, run two workflows and merge with a shell step:

```yaml
name: parallel-research
steps:
  - id: research-a
    preset: researcher
    task: "Research approach A for the caching problem"
    on_complete: research-b

  - id: research-b
    preset: researcher
    task: "Research approach B for the caching problem. See {steps.research-a.worktree} for approach A."
    on_complete: synthesize

  - id: synthesize
    preset: coder
    task: "Synthesize the research from {steps.research-a.worktree} and {steps.research-b.worktree} into a recommendation"
    on_complete: done
```

True parallelism would require multiple workflow runs with a coordinating agent using `flt workflow run` directly.
