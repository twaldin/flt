Implemented B1 + B2 with minimal scoped changes.

## What I changed
- Added versioned workflow treatment hashing at spawn time.
  - `src/workflow/treatment.ts`
    - Added `buildWorkflowTreatment(workflowName, presetName)`
    - Hashes role content from `preset.soul`, enabled skills (`SKILL.md`), and workflow YAML (`~/.flt/workflows/<name>.yaml|yml`) with SHA-256.
  - `src/workflow/types.ts`
    - Added `WorkflowTreatment` type.
    - Added `treatment?: WorkflowTreatment` to `ParallelCandidate`.
    - Expanded `run.vars` value typing to allow `treatment` object.
  - `src/workflow/engine.ts`
    - Parallel spawn: stores treatment on each candidate.
    - Non-parallel spawn: stores treatment on `run.vars[stepId].treatment`.
    - Tightened template and var reads to handle non-string var values safely.

- Added `flt trace export <run-id>` command.
  - `src/commands/trace.ts` (new)
    - Discovers agents for a workflow run.
    - Resolves per-CLI session log paths.
    - Normalizes transcripts to `<runDir>/transcript.jsonl` lines:
      `{ ts, agent, role, content, tokens? }`
    - Implemented parsers for:
      - claude-code (.jsonl)
      - codex (.jsonl)
      - pi (.jsonl)
      - opencode (SQLite)
      - swe-agent (.traj.json)
      - gemini (logs.json)
    - Fallback for unparsed CLIs: single entry from tmux pipe-pane log.
  - `src/cli.ts`
    - Registered `trace export <runId>`.

## Tests added/updated
- `tests/unit/workflow-treatment.test.ts`
  - New deterministic hash test for role+skill+workflow.
- `tests/unit/workflow-parallel.test.ts`
  - Validates candidate treatment hashes are present.
- `tests/unit/workflow-engine-plumbing.test.ts`
  - Validates non-parallel step stores treatment object.
- `tests/unit/trace-export.test.ts` (new)
  - Verifies claude-code transcript normalization.
  - Verifies fallback behavior for unsupported CLI.

## Test command run
- `bun test tests/unit/workflow-treatment.test.ts tests/unit/workflow-parallel.test.ts tests/unit/workflow-engine-plumbing.test.ts tests/unit/trace-export.test.ts`
- Result: pass (22 tests, 0 fail)

## Reviewer focus
- `src/commands/trace.ts` parser assumptions for codex/pi/opencode event shapes.
- `buildWorkflowTreatment()` behavior when preset soul/skills are missing (currently hashes empty role/workflow if absent and skips missing skills).
