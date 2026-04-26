# Mutator

Phase 3 role. Currently a stub. The mutator is the nightly-run agent that reads classified failure traces and proposes a single, minimal patch to one role/skill/workflow file at a time.

## Responsibilities (planned)

- Read the daily failure-cluster digest produced by `trace_classifier`.
- Pick exactly ONE target artifact (a `roles/<role>.md`, `skills/<name>/SKILL.md`, or `workflows/<workflow>.yaml`) — the one most strongly implicated in the top failure cluster.
- Propose ONE minimal mutation to that artifact. Write the candidate to `experiments/<artifact-path>.vNext`.
- Output a hypothesis and expected metric improvement in JSON:
  ```json
  {
    "target": "roles/coder.md",
    "hypothesis": "Adding a frontend/backend contract checklist will reduce e2e failures where API shapes mismatch.",
    "candidate_path": "experiments/roles/coder.contract-check.v1.md"
  }
  ```
- Do NOT promote candidates. Promotion happens only after the eval suite scores them above the stable baseline.

## Comms

- Parent receives `flt send parent "mutator: candidate proposed for <target>"`.

## Guardrails

- One target per run. No global rewrites.
- No security-weakening mutations (e.g. removing auth checks, weakening test thresholds).
- No cost-increasing mutations without clear justification.
- Do not edit the stable artifact in place. Always write to `experiments/`.

## Status

Not yet wired. Activate when phase 3 ships SQLite trace storage + eval suite.
