# Auto-commit silent fail in dag node coders

## Symptom (v0215-dogfood)

Dag node coders edited files and emitted `flt workflow pass`. `applyAutoCommit`
was invoked. The activity log showed no `auto-commit failed` events. Yet the
per-node branches ended up at the integration commit with no diff. The
reconciler had to manually `git commit` on the leaf branches before merging.

## Reproduction steps

1. Run a `dynamic-feature` workflow on any repo.
2. Let one dag node coder complete and signal pass.
3. Immediately after `applyAutoCommit` runs, inspect the node's git state:
   ```
   git -C <node-worktree> log --oneline -3
   git -C <node-worktree> status
   ```
   Expected: one auto-commit on top of the integration branch commit.
   Actual (pre-fix): `HEAD` still points at the integration branch commit.

## Root cause

`applyAutoCommit` (engine.ts:566) guards at line 573:

```typescript
if (!agent?.worktreePath) return
```

Dag node coders are spawned via `spawnDagNode` (engine.ts ~1015) with:

```typescript
const wt = createWorktree(repoDir, agentName, baseBranch)
await spawn({ name: agentName, dir: wt.path, worktree: false, ... })
```

The engine pre-creates the git worktree and passes it as `dir`. Because
`worktree: false`, `spawnDirect` never sets `worktreePath` or `worktreeBranch`
on the `AgentState`. So `getAgent(agentName).worktreePath` is `undefined`, and
`applyAutoCommit` returns on the first line without executing any git commands.

No error is logged because the guard is a silent early-return, not a throw.

## Git state at each transition

| Phase | git state |
|-------|-----------|
| worktree created (`createWorktree`) | new branch from integration commit; clean tree |
| coder runs and edits files | unstaged / uncommitted changes in `wt.path` |
| coder emits `flt workflow pass` | `applyAutoCommit` called; `agent.worktreePath` undefined → returns immediately |
| coder killed (`preserveWorktree: true`) | changes still sitting uncommitted in the worktree |
| reviewer spawned in same worktree | sees uncommitted changes, not a clean branch tip |
| reconciler tries to merge node branch | branch tip == integration commit, diff is empty |

## Fix applied

After `await spawn(...)` in the single-coder path of `spawnDagNode`, backfill
`worktreePath` on the agent state so `applyAutoCommit` proceeds:

```typescript
const spawnedCoder = getAgent(agentName)
if (spawnedCoder) setAgent(agentName, { ...spawnedCoder, worktreePath: wt.path })
```

`worktreeBranch` is intentionally NOT set. Dag node branches are not pushed as
standalone PRs; the reconciler merges them into the integration branch. Leaving
`worktreeBranch` unset ensures the push/PR section of `applyAutoCommit` is
skipped even in back-compat workflows where `shouldCreatePr` returns true.

## Why no `auto-commit failed` events

The event is emitted only inside the `try/catch` around the git command.
The early-return at line 573 happens before any git command is attempted, so
no exception is thrown and no event is logged. This is why the activity log
for v0215-dogfood was clean despite the commits never happening.

## Test coverage

The engine unit tests already mock `spawn` and return fake agent state with
`worktreePath` set. A targeted test for the backfill behaviour would require
a real git repo + spawn call, which is in integration-test territory. The fix
is a two-line change with clear intent; the existing engine-plumbing tests
verify the surrounding control flow.
