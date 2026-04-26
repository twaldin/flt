# GEPA Phase B chunk 2/3: metrics.json writer (B3) + eval suite scaffolding (B4)

## Goal

Emit a `metrics.json` summary to each workflow run directory on completion/failure/cancellation (B3), and scaffold a held-out eval suite with fixture tasks and `flt eval suite` subcommands so runs can be reproducibly replayed against known tasks (B4).

---

## Acceptance Criteria

### B3 — metrics.json writer

- [ ] On every terminal state transition in `engine.ts` (status → `completed`, `failed`, or `cancelled`), the engine writes `<run.runDir>/metrics.json` before saving the run.
- [ ] `metrics.json` conforms to this shape (all top-level fields required; nested fields optional where noted):
  ```json
  {
    "outcome": "completed" | "failed" | "cancelled",
    "scores": {
      "tests":      "pass" | "fail",   // omitted if no results/<key>-*.json exists
      "e2e":        "pass" | "fail",
      "lint":       "pass" | "fail",
      "typecheck":  "pass" | "fail",
      "reviewer":   "pass" | "fail"
    },
    "cost": {
      "usd":       number,   // 0 if unresolvable
      "tokensIn":  number,
      "tokensOut": number
    },
    "time": {
      "wallSeconds": number  // Math.round((completedAt - startedAt) / 1000)
    },
    "patch": {
      "filesChanged":  number,  // 0 if git unavailable or startBranch empty
      "linesAdded":    number,
      "linesDeleted":  number
    },
    "blockers": string[]         // failReason strings from all failed result files
  }
  ```
- [ ] `scores` keys are populated only when a matching step result file exists in `<runDir>/results/`. A step that ran but produced no file is omitted (not `null`).
- [ ] `patch` is computed via `git diff --shortstat <run.startBranch>` from the engine's working directory at write time. If `startBranch` is empty or git returns non-zero, all three fields are `0`.
- [ ] `cost` is the sum of cost/token fields from `activity.log` kill events whose agent name prefix matches the run ID (e.g. agents named `<runId>-<step>`). Fields are `0` if no matching events are found.
- [ ] `blockers` collects all `failReason` values from `results/*.json` files where `verdict === "fail"`. Empty array when there are none.
- [ ] `time.wallSeconds` is derived from `run.completedAt` and `run.startedAt`; rounds to nearest integer.
- [ ] Unit tests cover: happy-path completed run (scores populated, cost summed, patch parsed, blockers empty), failed run (outcome + blockers populated), cancelled run (patch falls back to zeroes when startBranch empty), missing results dir (scores is `{}`).

### B4 — eval suite scaffolding

- [ ] Directory `tests/eval/` exists and contains at least 3 fixture subdirectories covering distinct task types (bug-fix, small-feature, refactor, doc, test-addition).
- [ ] Each fixture directory contains exactly: `task.md` (the idea/prompt), `acceptance.md` (testable criteria), and either `repo-clone-cmd.sh` (executable) or a `repo-snapshot/` subdirectory.
- [ ] `flt eval suite list` prints a table of available fixtures (name, task type, repo source) sourced from `tests/eval/`.
- [ ] `flt eval suite run <name>` resolves the fixture, sets up the repo (runs `repo-clone-cmd.sh` into a temp dir, or copies `repo-snapshot/`), then spawns the configured workflow with the fixture's `task.md` content as the `--task` argument.
- [ ] Each fixture may optionally include a `config.json` with a `workflow` field (defaults to `idea-to-pr` when absent).
- [ ] Unit tests cover: `suite list` output contains all fixture names, `suite run <name>` calls `startWorkflow` with the correct task string and working directory, `suite run` errors clearly when fixture name is unknown.

---

## Out of Scope

- Parsing or displaying `metrics.json` in the TUI (future work).
- Automated scoring/pass-fail thresholds based on metrics (future).
- `flt eval suite run` actually waiting for the workflow to finish or reporting a pass/fail verdict; it only spawns and returns the run ID.
- Creating real remote repos for fixtures; `repo-clone-cmd.sh` may reference the local flt repo at a fixed commit.
- Migrating existing workflows to emit metrics (they will automatically benefit once the engine emits on terminal transitions).

---

## Open Questions

None blocking.
