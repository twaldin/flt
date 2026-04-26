# Track B — GEPA Data Plumbing

**Goal.** Close the data-plumbing gap so tomorrow's runs are optimizable by an overnight GEPA-style mutator → eval → human-review-only-promotion loop. No UI work; all artifacts are machine-checkable.

---

## B1 — Versioned artifact treatment

At spawn time, compute SHA-256 of (a) the resolved role `.md` from `preset.soul`, (b) each enabled `SKILL.md` keyed by skill name, (c) the workflow YAML. For parallel-step candidates, store on `run.parallelGroups[step].candidates[i].treatment = { roleHash, skillHashes: Record<name,hash>, workflowHash }`. For single-spawn steps, store on `run.vars[stepId].treatment`. Persist into `run.json` via `saveRun`. Without these hashes GEPA cannot attribute outcome deltas to specific file versions.

**Acceptance:** `bun test` covers hash-stability (same file = same hash) and storage location for both parallel and single-step paths.

---

## B2 — `flt trace export <run-id>`

Read each agent's harness session log (paths per HANDOFF §"Session-log paths per harness") and normalize into `<runDir>/transcript.jsonl` with shape `{ ts, agent, role: 'user'|'assistant'|'tool', content, tokens? }`.

Per-CLI parsers: claude-code (.jsonl), codex (.jsonl), pi (.jsonl), opencode (SQLite at `~/.local/share/opencode/`), swe-agent (.traj.json), gemini (logs.json convlog). Fallback for unparsed CLIs: emit one entry with raw final pane content. Use `sessionLogPath` with `realpathSync(workdir)` for macOS `/var→/private/var` canonicalization.

**Acceptance:** `flt trace export <run-id>` produces a valid JSONL file; unit tests for each parser with fixture snapshots; fallback emits one-entry file without throwing.

---

## B3 — `metrics.json` writer per workflow run

On `completed | failed | cancelled`, engine emits `<runDir>/metrics.json`:

```ts
{
  outcome: 'completed' | 'failed' | 'cancelled',
  scores: { tests?: number, e2e?: number, lint?: number, typecheck?: number, reviewer?: number },
  cost: { usd: number, tokensIn: number, tokensOut: number },
  time: { wallSeconds: number },
  patch: { filesChanged: number, linesAdded: number, linesDeleted: number },
  blockers: string[]
}
```

Patch stats from `git diff --shortstat` against `run.startBranch`. Cost/token totals aggregated from per-agent harness archives in `~/.flt/runs/`. Wire `addArtifact` call in `executeStep`/`advanceWorkflow` so GC tracks this file.

**Acceptance:** Every workflow completion/fail/cancel produces a valid `metrics.json`; integration test verifies fields are populated.

---

## B4 — Held-out eval suite

Create `tests/eval/<task>/` with 3–5 fixtures covering: bug-fix, small-feature, refactor, doc, test-addition. Each fixture: `task.md` (natural-language description), `acceptance.md` (machine-checkable criteria), `repo-clone-cmd.sh` (reproducible repo state). Add CLI commands:

- `flt eval suite list` — print fixture names + descriptions
- `flt eval suite run <name>` — spawn the configured default workflow against the fixture, emit run-id

**Acceptance:** `flt eval suite list` outputs ≥3 fixtures; `flt eval suite run` launches a workflow run without error.

---

## B5 — Daily mutator workflow

Create `templates/workflows/daily-mutator.yaml` using existing primitives only:

1. `run:` shell step — calls `flt trace recent --since 24h --status failed` to collect failure transcripts
2. `spawn:` mutator step (cc-opus) — receives trace bundle, writes `experiments/<artifact>.vNext.md` + `hypothesis.json` (rationale + expected improvement)
3. `parallel:` step, `n=2`, `treatment_map: {a: stable, b: candidate}` — runs `flt eval suite run <name>` on both treatments
4. `human_gate:` — presents side-by-side `metrics.json` comparison report; **no auto-promote**

Promotion is always manual (`flt promote`, B6). The workflow never auto-merges.

**Acceptance:** `flt workflow run daily-mutator` parses and reaches `human_gate` without crashing; YAML validated by existing route-check parser.

---

## B6 — `flt promote <candidate>`

Thin CLI command. Required flag: `--evidence <run-ids>` (comma-separated). Steps:

1. Load `metrics.json` for each evidence run-id; verify `candidate` scores improve vs current stable (at least one score field better, none worse).
2. Copy `experiments/<x>.vNext.md` → stable path (derived from artifact name convention).
3. Archive old stable to `archive/<x>.v<N>.md` (N = next integer).
4. Append to `<x>.changelog.md`: date, run-ids, score deltas.
5. Throw with clear message if no metrics-improvement evidence exists.

**Acceptance:** Unit tests for promotion (happy path) and rejection (no improvement evidence); changelog entry format verified.

---

## Constraints

- No new external dependencies beyond what is already in `package.json`.
- All new modules must be pure-function testable without tmux/state where possible.
- Harness-ts changes (if any) require `bun run build` from `~/harness/ts` before testing.
- `opus[1m]` always for the mutator agent; never plain `opus`.
