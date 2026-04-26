# Spec: dynamic_dag workflow primitive

## Goal

Add a `dynamic_dag` step type to the flt engine that accepts a runtime-emitted `plan.json` (nodes + dependency edges) and executes the graph dependency-first: parallel where independent, sequential along dep chains, with per-node coder→reviewer mini-loops and a single final reconciler that merges all leaf branches into an integration branch.

## Acceptance criteria

### Types & parsing
- `DynamicDagStep` added to the discriminated union in `src/workflow/types.ts` with fields: `type`, `plan_from`, `reconciler?`, `max_nodes` (default 12), `max_depth` (default 5), `max_parallel_per_wave` (default 6), `node_max_retries` (default 2).
- `DynamicDagState` and `DagNodeState` added; `WorkflowRun.dynamicDagGroups` record parallels existing `parallelGroups`.
- `parseDynamicDagStep` in `src/workflow/parser.ts` validates all fields and applies defaults.

### Validation (`validatePlan`)
- Rejects plan with a cycle; `failReason` contains `"cycle: <a>→<b>→<a>"`.
- Rejects duplicate node ids.
- Rejects a `depends_on` ref to an unknown id.
- Rejects plan exceeding `max_nodes`, `max_depth`, or (per-wave) `max_parallel_per_wave`.
- On any validation failure, writes a `verdict: 'fail'` result file so the engine routes via `on_fail`.

### Execution semantics
- `topologicalReadyNodes` returns only nodes whose every `depends_on` is `passed`; never advances a node before its deps.
- Root nodes (no deps) all spawn immediately from `run.startBranch`.
- A single-dep node branches off that dep's branch tip.
- A multi-dep node gets a `pre-<nodeId>-base` branch created by mechanical `git merge` of all dep branches; on conflict a reconciler agent resolves inline before the node spawns.
- Per-node coder→reviewer loop: coder pass → reviewer spawns in same WT; reviewer pass → node `passed`; reviewer fail → coder re-spawns with `fail_reason`, up to `node_max_retries`.
- When `node.parallel > N`, engine spawns N candidate coders; reviewer uses `--candidate` gate to select winner (reuses existing tournament UX).
- Independent chains keep running while a node-fail gate is pending on an unrelated chain.

### Failure handling
- Node exhausts `node_max_retries` → writes `.gate-pending` with `kind: node-fail` and options `retry-<id>`, `skip-<id>`, `abort`.
- `flt workflow node retry <run> <node-id>` resets retries and re-spawns coder.
- `flt workflow node skip <run> <node-id>` marks node + all transitive dependents `skipped` (BFS through reverse dep edges); final reconciler ignores skipped leaves.
- `flt workflow node abort <run>` writes a step-level fail; `on_fail` routing applies.
- Step passes if at least one leaf survives; fails if every node is skipped or aborted.
- `run.vars.execute.skipped` lists all skipped node ids.

### Final reconcile
- When all non-skipped leaves are `passed`, ONE reconciler spawns in the integration WT and `git merge`s each leaf in topological order.
- On reconciler agent fail → human gate (`retry-reconcile` / `abort`).
- `{steps.execute.branch}` and `{steps.execute.worktree}` exposed as step-output vars for downstream steps.

### CLI surface
- `flt workflow node retry|skip|abort <run> [node-id]` subcommand added in `src/commands/workflow.ts`.
- Writes `<runDir>/.gate-decision`; engine poller calls `handleNodeFailGate`.

### Tests
- `tests/unit/dag-validate.test.ts` — all validation failure paths green.
- `tests/unit/dag-topo.test.ts` — `topologicalReadyNodes` returns correct ready set for various DAG states.
- `tests/unit/dag-skip.test.ts` — transitive-skip walk returns complete dependent set.
- `tests/integration/dag-execute.test.ts` — mock-spawn 4-node plan (`a`, `b → c`, `d → c`, `e` independent); asserts spawn order, branch bases, integration branch contains all leaves.
- `templates/workflows/_smoke-dag.yaml` — 3-node DAG (`a`, `b`, `c depends on a+b`) runs end-to-end with `flt workflow run _smoke-dag`.

### Negative paths verified
- Cyclic plan → step fail with `failReason` containing the cycle string.
- Node forced to fail twice → `.gate-pending` appears; `flt workflow node skip` skips node + dependents; independent chain continues to `passed`.

## Out of scope

- Resume-from-checkpoint after orchestrator crash.
- Cost-aware scheduling (greedy-parallel within caps is the default).
- Cross-workflow DAG composition (a `dynamic_dag` step nested inside another `dynamic_dag`).
- Auto-rollback on partial-DAG failure (skip/abort is the user-driven recovery path).
