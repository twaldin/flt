# Track B — GEPA Optimization Data Plumbing

## Problem

flt can run parallel experiments with treatment maps, but it cannot yet attribute outcomes to specific artifact versions, export agent traces for replay, emit normalized run metrics, or promote a winning candidate. Without this plumbing, GEPA-style overnight mutation loops have nothing to read or write to. Track B closes that gap.

**Hypothesis:** all six sub-tasks produce machine-checkable artifacts, so the human_gate for this track should be autonomous-possible (no taste judgment required).

---

## Sub-tasks

### B1 — Versioned artifact treatment hashes

At spawn time, compute SHA-256 of:
- The resolved role `.md` identified by `preset.soul`
- Each enabled `SKILL.md` (keyed by skill name)
- The workflow YAML

Store as `treatment: { roleHash: string, skillHashes: Record<name, hash>, workflowHash: string }`.

- Parallel step → `run.parallelGroups[stepId].candidates[i].treatment`
- Non-parallel step → `run.vars[stepId].treatment`

Without these hashes, GEPA cannot attribute a score delta to a specific file version.

### B2 — `flt trace export <run-id>`

Reads each agent's harness session log, normalizes to `<runDir>/transcript.jsonl`.

Entry shape:
```json
{ "ts": "ISO8601", "agent": "name", "role": "user|assistant|tool", "content": "...", "tokens": 0 }
```

Per-CLI parsers:

| CLI | log path | format |
|---|---|---|
| claude-code | `~/.claude/projects/<encoded>/<sid>.jsonl` | JSONL |
| codex | `~/.codex/sessions/yyyy/mm/dd/rollout-*.jsonl` | NDJSON |
| pi | `~/.pi/agent/sessions/<encoded>/*.jsonl` | JSONL |
| opencode | `~/.local/share/opencode/` | SQLite |
| swe-agent | `~/Library/Application Support/mini-swe-agent/last_mini_run.traj.json` | `.traj.json` |
| gemini | `~/.gemini/tmp/<basename>/logs.json` | convlog JSON |

Encoding note: use `realpathSync(workdir)` before applying CLI-specific encoding (claude: `/[\/_]/g → -`; pi: `--<all/>--`).

Fallback for unparsed CLIs: emit a single entry with `role: "assistant"` and raw final pane content.

### B3 — `metrics.json` writer

On workflow completion, failure, or cancel, engine emits `<runDir>/metrics.json`:

```json
{
  "outcome": "completed|failed|cancelled",
  "scores": { "tests": null, "e2e": null, "lint": null, "typecheck": null, "reviewer": null },
  "cost": { "usd": 0.0, "tokensIn": 0, "tokensOut": 0 },
  "time": { "wallSeconds": 0 },
  "patch": { "filesChanged": 0, "linesAdded": 0, "linesDeleted": 0 },
  "blockers": []
}
```

`patch` stats come from `git diff --shortstat <run.startBranch>...HEAD`. `scores` fields are null until a tester/reviewer step writes them. The engine populates cost/time/outcome from state; step results populate scores.

### B4 — Held-out eval suite

Create `tests/eval/<task>/` with 3–5 fixtures spanning: bug fix, small feature, refactor, doc, test addition.

Each fixture:
```
tests/eval/<task>/
  task.md          # natural-language task description
  acceptance.md    # pass/fail criteria (machine-checkable preferred)
  repo-clone-cmd.sh  # or repo-snapshot/
```

New CLI commands:
- `flt eval suite list` — prints available fixture names
- `flt eval suite run <name>` — spawns the configured workflow against the fixture, capturing `metrics.json` on completion

### B5 — Daily mutator workflow (`templates/workflows/daily-mutator.yaml`)

Pure workflow YAML using existing primitives:

1. `run:` shell step — calls `flt trace recent --since 24h --status failed` to collect yesterday's failure traces
2. `spawn:` mutator (cc-opus) — receives trace bundle; writes `experiments/<artifact>.vNext.md` + `hypothesis.json`
3. `parallel:` n=2, `treatment_map: {a: stable, b: candidate}` — runs `flt eval suite run` on both treatments
4. `human_gate:` — presents comparison report (metrics.json delta); **no auto-promote**

### B6 — `flt promote <candidate>`

Thin command, strict preconditions:

1. Requires `--evidence <run-ids>` (comma-separated)
2. Loads `metrics.json` for each run-id; verifies candidate score > stable score on at least one metric with no regression on others
3. Throws if evidence is missing or metrics show no improvement
4. On success:
   - Copies `experiments/<x>.vNext.md` → stable path
   - Archives old stable to `archive/<x>.v<N>.md` (auto-increments N)
   - Appends to `<x>.changelog.md`: date, run-ids, score deltas

---

## Acceptance criteria

- B1: `run.parallelGroups[step].candidates[i].treatment` populated with three hashes on parallel spawn; `run.vars[stepId].treatment` populated on non-parallel spawn
- B2: `flt trace export <run-id>` produces valid JSONL at `<runDir>/transcript.jsonl`; at least claude-code and codex parsers work; fallback emits one entry for unparsed CLIs
- B3: `<runDir>/metrics.json` exists after every workflow terminal transition; `patch` stats non-null when `startBranch` is set
- B4: `flt eval suite list` prints ≥3 fixtures; `flt eval suite run <name>` completes and leaves `metrics.json`
- B5: `daily-mutator.yaml` parses without error (`flt workflow list` shows it); dry-run of first shell step succeeds
- B6: `flt promote` rejects when no evidence provided; succeeds with valid evidence and correctly archives old stable

---

## Out of scope

- Auto-promotion (human_gate is always required for promotion)
- GEPA optimizer itself (Track B is the data substrate, not the optimizer)
- continue-cli / droid / qwen trace parsers (fallback path covers them)
- Track A TUI modal (separate workflow run)
