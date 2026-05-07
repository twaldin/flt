# src/workflow/

YAML state machine that chains agents together. A workflow is a list of typed steps; the engine advances the state machine when an agent it spawned transitions `running → idle`. State persists under `~/.flt/runs/<run-id>/`; per-run vars, history, and dynamic-DAG node state all live in a single `WorkflowRun` record.

## Files

- `types.ts` — `WorkflowDef`, `WorkflowRun`, the `WorkflowStepDef` discriminated union, DAG state.
- `parser.ts` — load + validate `~/.flt/workflows/<name>.yaml`.
- `engine.ts` — the state machine: `runWorkflow`, `advanceWorkflow`, per-step-type handlers.
- `condition.ts` — evaluator for `condition` step `if:` expressions.
- `treatment.ts` — treatment matrix (role × skill × workflow hashes) for parallel candidate variants.
- `gates-store.ts` — `human_gate` pending-decision queue read by the TUI.
- `gc.ts` — cleanup of completed runs.
- `manifest.ts` — workflow listing + metadata for the TUI workflow modal.
- `metrics.ts` / `results.ts` — per-run metrics and final result aggregation.

## Step types

All steps share `BaseStep` (`id`, `on_complete`, `on_fail`, `max_retries`, PR-creation fields). Discriminated by `type`:

- **`spawn`** (default when `type` omitted) — spawn one agent with `preset` + `task`. Worktree by default.
- **`parallel`** — spawn `n` candidates of one step in parallel; `presets` lets each candidate use a different preset to vary the treatment. Aggregates verdicts; `merge_best` is the usual follow-up.
- **`dynamic_dag`** — `plan_from` references an upstream agent's planning artifact, builds a DAG with depends-on edges, runs nodes in waves with `max_parallel_per_wave`. Optional `reconciler` re-plans when nodes fail.
- **`condition`** — branch on `if:` (a small expression over `vars` and prior step results) → `then` step or `else` step.
- **`human_gate`** — block until a human approves/rejects via TUI gates modal (`g` from normal mode) or `flt workflow approve|reject`.
- **`merge_best`** — merge the winning candidate's branch from a `parallel` group into `target_branch` and surface the result to the next step.
- **`collect_artifacts`** — copy named files from listed agents' run dirs into a single `into:` path before their worktrees are torn down.

When adding a step type, extend the union in `types.ts` and add a handler in `engine.ts` (search for the existing `switch (step.type)` site). Then update `parser.ts` validation.

## Advance-on-idle

The controller poller (`src/controller/server.ts`) registers a status-change callback. On `running → idle` for an agent that has `workflowRunId` set, it calls `advanceWorkflow(workflowName, agentName)`. Steps that never go idle (instant CLI errors, refusals to start) won't advance — design any new step type to tolerate this or signal an explicit failure.

Inside the agent, `flt workflow pass|fail [reason]` writes a `WorkflowResultPayload` (verdict + optional review fixes) the engine reads when the agent goes idle. This is how a step records "done, success" vs "done, failed". Without an explicit pass/fail, the engine treats idle as completion of the spawn and moves on per `on_complete`.

## Variables and templating

Each run's `vars` map is `{ [stepId]: { [key]: string } }`. Templates in `task`/`pr_*` fields use `{steps.<id>.<key>}` (e.g. `{steps.implement.branch}`). `{task}`, `{pr}`, and other top-level inputs come from the workflow run's input map (`vars._input`). The engine populates step outputs (branch, worktree, agent name, PR URL) into `vars[stepId]` after the step completes.

## Treatment matrix

For `parallel` steps, `treatment.ts` hashes (role file, skill files, workflow yaml) into a `Treatment` record per candidate so eval/metrics can attribute outcomes to specific role+skill combos. `permuteTreatmentMap` distributes treatments across candidates when `presets` lists fewer entries than `n`. Don't bypass this when adding parallel-style steps — eval consumers depend on it.

## PR creation

Steps can opt in via `auto_pr_step: true` (or workflow-level `auto_pr: true`). The engine resolves `pr_adapter` (`gh` | `gt` | `manual` from `src/pr-adapters/`) and uses `pr_*` template fields to build title/body/branch-prefix/reviewers. PR creation runs after the step succeeds; failures surface as a step failure.
