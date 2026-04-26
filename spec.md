# Spec: GEPA Phase B chunk 3/3 — daily-mutator workflow (B5) + flt promote (B6)

## Goal

Wire the last two pieces of the GEPA overnight loop: a workflow YAML that drives
daily mutation → evaluation → human-review, and a `flt promote` command that
enforces evidence-backed promotion from candidate to stable.

---

## Acceptance Criteria

### B5 — `templates/workflows/daily-mutator.yaml`

- [ ] File exists at `templates/workflows/daily-mutator.yaml` and is copied to
  `~/.flt/workflows/daily-mutator.yaml` by `flt init` (seeded via `WORKFLOW_FILES`
  constant alongside existing four workflows).
- [ ] **Step 1 — collect**: `run:` shell step executes
  `flt trace recent --since 24h --status failed`; if the command is absent the step
  falls back to `echo "flt trace not available — bundle empty"` and continues (not
  a failure). Step stores output in `$FLT_RUN_DIR/artifacts/trace-bundle.txt`.
- [ ] **Step 1a — redact**: second `run:` step strips secret patterns
  (`sk-*`, `ghp_*`, `github_pat_*`, `AKIA[A-Z0-9]+`, `/[a-zA-Z0-9_-]{32,}/`,
  email addresses, `API_KEY`/`AUTH_TOKEN`/`BEARER` env vars) from
  `trace-bundle.txt`, replacing each with `<REDACTED:KIND>`. Output written to
  `$FLT_RUN_DIR/artifacts/trace-bundle-redacted.txt`.
- [ ] **Step 1b — find-skills** (optional pre-mutation): `run:` step calls
  `npx skills find <task-keywords>` (keywords extracted from task var); output
  appended to `$FLT_RUN_DIR/artifacts/skill-candidates.txt`. Step is non-blocking
  (error → continue).
- [ ] **Step 2 — mutate**: `cc-opus` spawn step reads the redacted trace bundle and
  skill candidates; writes two files to `$FLT_RUN_DIR/artifacts/`:
  - `<artifact>.vNext.md` — proposed role/skill/workflow candidate with YAML
    front-matter containing `stable_path:` (absolute path of the file being mutated)
    and `mutation_type: prompt_edit | skill_acquisition`.
  - `hypothesis.json` — `{ artifact, mutation_type, hypothesis, expected_delta }`.
- [ ] **Step 3 — eval**: `parallel` step with `n: 2` and
  `treatment_map: { a: stable, b: candidate }`. Each child runs the configured eval
  suite (`flt eval suite run <suite>` or falls back to `bun test`). Results written
  to `$FLT_RUN_DIR/results/eval-a.json` and `eval-b.json`.
- [ ] **Step 4 — gate**: `human_gate` step. Notify text summarises hypothesis,
  shows both eval results side-by-side, and includes the path to `hypothesis.json`.
- [ ] No auto-promotion step exists in the workflow — gate is terminal on approve.
- [ ] Workflow parses without error under the existing `parseWorkflow` parser
  (`bun test` passes, parser test covers `daily-mutator.yaml`).

### B6 — `flt promote <candidate> --evidence <run-ids>`

- [ ] `flt promote` is registered in `src/cli.ts` and implemented in
  `src/commands/promote.ts`.
- [ ] Accepts positional `<candidate>` (path to `experiments/<x>.vNext.md`) and
  required `--evidence <run-ids>` (comma-separated run IDs).
- [ ] Reads `stable_path` from the candidate's YAML front-matter; throws with a
  clear message if absent.
- [ ] For each evidence run ID, reads `~/.flt/runs/<id>/metrics.json`. Throws if
  any run ID has no metrics file.
- [ ] Computes improvement: candidate run(s) must have at least one `scores.*` field
  where the value exceeds the most-recent stable metrics on record. "Stable metrics"
  are read from `<stable_path>.metrics.json` (a sidecar written by promote on each
  prior promotion). On first promotion (no sidecar), evidence check is skipped with
  a warning; the flag is still required as an explicit acknowledgement.
- [ ] Throws (non-zero exit, descriptive message) if evidence run IDs produce no
  score improvement over the stable sidecar.
- [ ] On successful evidence check:
  1. Reads `<stable_path>`, writes it to
     `archive/<basename>.v<N>.md` where `N` = count of existing archive files + 1.
  2. Copies `<candidate>` → `<stable_path>` (strips YAML front-matter before write).
  3. Appends one entry to `<stable_path>.changelog.md`:
     ```
     ## <ISO date> — run-ids: <ids>
     Score deltas: <field>: <old> → <new>, ...
     ```
  4. Writes updated metrics sidecar `<stable_path>.metrics.json` from evidence runs.
- [ ] All file operations are atomic enough that a mid-run crash leaves either the
  old stable or the new stable intact (write-then-rename for the stable file).
- [ ] Unit tests in `tests/unit/promote.test.ts` cover:
  - Happy path (promotes, writes archive + changelog + sidecar).
  - Missing front-matter → throws.
  - Missing metrics.json for evidence run → throws.
  - No score improvement → throws.
  - First-promotion (no sidecar) → warns, promotes.
- [ ] Parser test in `tests/unit/workflow-parser.test.ts` (or a new file) validates
  `daily-mutator.yaml` loads without errors.

---

## Out of Scope

- `flt trace recent` command implementation — B5 step 1 treats it as a placeholder
  and degrades gracefully if absent. Implementing `flt trace` is a separate task.
- Auto-approve / auto-merge at the human gate.
- Multi-artifact batch promotion (one candidate per `flt promote` invocation).
- UI surface for the daily-mutator workflow beyond the existing workflow status TUI.
- Harness session-log parsing / redaction beyond simple regex (B2's unified
  transcript is separate).

---

## Open Questions

None blocking. One assumption recorded: the `stable_path` front-matter convention
is new — the mutator step's bootstrap task must be written to produce it. The
architect should ensure the mutator bootstrap task template includes this
requirement explicitly.
