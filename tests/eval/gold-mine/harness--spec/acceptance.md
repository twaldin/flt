# Acceptance — derived from PR #10: release: py 0.3.0 + ts 0.2.0 -- frontier adapters polish + BYOK fixes

## What's new

This release lands the four frontier adapters (`crush`, `factory-droid`,
`kilo`, `openclaude`) added in the prior batch, plus the in-flight
container-bringup fixes that came out of real-world benchmarking. After
this PR, those adapters reliably build commands and resolve models in
both bare host and Linux container environments.

### highlights

- **factory-droid BYOK works.** Drop `--auto`, keep
  `--skip-permissions-unsafe`, auto-prefix `custom:` onto bare model ids
  so the BYOK flow against the user's own OpenAI-compatible endpoint
  goes through.
- **openclaude env-mode for OpenAI-compat endpoints.** When
  `OPENAI_API_KEY`/`OPENAI_BASE_URL` is set, switch to
  `CLAUDE_CODE_USE_OPENAI=1` + `OPENAI_MODEL=...` and drop `--model`,
  matching openclaude's documented usage.
- **continue-cli OpenAI-compat config.** With OpenAI env present, write
  a minimal Continue config YAML in workdir and call
  `cn -p --config <path> --format json` so bare ids like `gpt-5.4` work
  end-to-end.
- **kilo container path tolerance.** Wrap host-side parent `mkdir` in
  try/except so a `KILO_DB` pointing at `/app/...` no longer aborts the
  command build on the host.
- **crush.** Argv reordered to `run --data-dir <dir> --model ...`;
  preserve explicit `provider/model` when caller is being explicit.
- **`--model-no-resolve` escape hatch.** New CLI flag and
  `RunSpec.model_no_resolve` / `modelNoResolve` field — pass the model
  string through verbatim for odd provider/model combos that the
  best-effort resolver doesn't know about.
- **Model normalization additions.** `KNOWN_PROVIDERS` learns
  `openai-codex` and `azure-openai-responses`. `pi` resolves bare
  `gpt-5.x` to `openai-codex/gpt-5.x`. `crush` joins
  `<REDACTED:TOKEN>`.

### adapters touched (py + ts)

`aider`, `claude-code`, `codex`, `continue-cli`, `crush`,
`factory-droid`, `gemini`, `kilo`, `openclaude`, `opencode`, `pi`,
`qwen`, `swe-agent` -- every adapter now threads the
`model_no_resolve` / `modelNoResolve` flag through to
`normalize_model_for_harness` / `normalizeModelForHarness`.

The five behavioral changes (factory-droid, openclaude, continue-cli,
kilo, crush) are also mirrored on the TS side.

### docs / scaffolding

- `.nvmrc` pinned to Node `20.20.2` for host dev.
- `scripts/check_binaries.sh` -- "is this harness installed" check for
  the gpt-5.4 set.
- `scripts/smoke_gpt54.py` -- minimal "ask harness X to write hi.txt"
  smoke runner. Useful for bringup, not part of the core library.
- `README.md` documents `--model-no-resolve` and adds a "model
  resolution policy" section that frames resolution as deliberately
  best-effort.
- `SPEC.md` documents the new optional `modelNoResolve` field.

## Validation

- `PYTHONPATH=src pytest -q`: **91/91 passing** (includes new
  `test_model_normalization.py` cases for pi gpt-5 routing,
  `--model-no-resolve` raw passthrough, factory-droid `custom:`
  auto-prefix, and double-prefix protection on the new providers; plus
  new CLI tests that the `--model-no-resolve` flag survives the typer
  layer into the `RunSpec`).
- `bun test` in `ts/`: **42/42 passing** (37 pre-existing + 5 new
  normalization tests mirroring the py additions).
- Real-world: a 712-run TB2 benchmark sweep is currently in flight in
  `~/harness-bench` running against this exact code (PYTHONPATH points
  at `~/harness/src`). The factory-droid, openclaude, kilo, and
  continue-cli adjustments here all came directly out of failures
  observed in that sweep.

## Versions

- `harness-cli` (PyPI): `0.2.2` -> `0.3.0`
- `@twaldin/harness-ts` (npm): `0.1.2` -> `0.2.0`

Tag and publish workflows fire on `py-v*.*.*` / `ts-v*.*.*` push -- not
tagging in this PR, that step is left for the manual merge.

<!-- This is an auto-generated comment: release notes by coderabbit.ai -->

## Summary by CodeRabbit

## Release Notes

* **New Features**
  * Added four new harness adapters: `crush`, `factory-droid`, `kilo`, and `openclaude`.
  * Implemented model normalization—adapters now accept canonical model IDs (e.g., `gpt-5.4` instead of `openai/gpt-5.4`).
  * Added `--model-no-resolve` CLI flag to bypass normalization and pass model strings verbatim.

* **Documentation**
  * Updated specification and README to reflect 13 supported adapters with new model normalization guidance.

* **Chores**
  * Pinned Node.js runtime to version 20.20.2 via `.nvmrc`.
  * Version bumped: Python 0.3.0, TypeScript 0.2.0.

<!-- end of auto-generated comment: release notes by coderabbit.ai -->

## Final commits touching this file
- 413ee28 2026-04-24T01:41:03Z twaldin: docs+scripts: .nvmrc, gpt-5.4 smoke runner, README polish

