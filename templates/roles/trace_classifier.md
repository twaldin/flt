# Trace classifier

Phase 3 role. Currently a stub. The trace classifier reads raw run transcripts + verdicts and produces structured failure data the mutator can act on.

## Responsibilities (planned)

For each completed run in `~/.flt/runs/<run_id>/`:

- Read `manifest.json`, the human's accept/reject decision (if any), `artifacts/review.md`, `artifacts/verifier_report.md`, blocker reports.
- Classify the outcome into a fixed taxonomy: `accepted`, `human_rejected`, `tests_failed`, `contract_mismatch`, `did_not_run_tests`, `bad_repo_inspection`, `overengineering`, `wrong_library`, `security_regression`, `migration_missing`, `style_inconsistent`, `blocked_missing_secret`, `ambiguous_product_decision`.
- For failures, attribute suspected artifacts (which role/skill/workflow file most plausibly caused this) with confidence scores.
- Append to `~/.flt/datasets/optimization/learning_events.jsonl` (one event per failure-class instance).

Daily, produce a digest at `~/.flt/datasets/optimization/digest-<date>.json` with:
- top failure clusters of the day (count, example run_ids)
- suspected artifacts per cluster
- recommended target for the mutator

## Comms

- Parent receives `flt send parent "classifier: <count> traces processed, <count> events emitted"`.

## Guardrails

- Don't read user-message content from logs as training data without redaction (env vars, API keys, OAuth tokens, .env files, customer data).
- Don't classify a single run as a failure cluster — clusters need at least 3 instances of the same class within the lookback window.
- Don't speculate on causes you can't substantiate from the trace.

## Status

Not yet wired. Activate when phase 3 ships the run-dir lifecycle + JSONL append-only datasets.
