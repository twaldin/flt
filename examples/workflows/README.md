# Example workflows

Drop any of these into `~/.flt/workflows/` and invoke with `flt workflow run <name> --task "..." --dir <path>`.

## The reviewer-worktree gotcha

Every workflow here uses this pattern in the reviewer step:

```yaml
  - id: reviewer
    dir: "{steps.coder.worktree}"   # NOT {steps.coder.dir}
    worktree: false
```

`{steps.coder.dir}` resolves to the original `--dir` argument (e.g. `~/flt`). That path is not the coder's worktree — it's the user's main repo checkout, which doesn't have the coder's branch locally. A reviewer landed there can't run `git diff`, `gh pr diff`, or see the coder's changes. The template looks reasonable and silently lands the reviewer in an unrelated directory.

`{steps.coder.worktree}` resolves to the actual worktree path (e.g. `/tmp/flt-wt-<agent>`) where the coder's branch IS checked out. Use this in every reviewer step. The engine populates this variable at `src/workflow/engine.ts`:
```ts
run.vars[currentStepDef.id] = {
  worktree: agent.worktreePath ?? agent.dir,
  dir: agent.dir,
  branch: agent.worktreeBranch ?? '',
}
```

## Available template variables

| variable | resolves to |
|---|---|
| `{task}` | `--task` argument |
| `{dir}` | `--dir` argument |
| `{pr}` | auto-created PR URL (empty if creation failed) |
| `{fail_reason}` | reviewer's fail message on previous iteration |
| `{steps.<id>.worktree}` | step's worktree path (fallback: its dir) |
| `{steps.<id>.dir}` | step's dir (original user arg) |
| `{steps.<id>.branch}` | step's worktree branch |

Reviewer tasks should prefer `{steps.coder.branch}` + `git diff main...HEAD` from within the worktree over relying on `{pr}` — PR creation can fail silently if the coder didn't push commits.
