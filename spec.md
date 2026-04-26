# Spec: gold-mine harvester

## Goal

Harvest task-shaped markdown files from `github.com/twaldin/*` repos and from local `~/code`, `~/projects`, `~/src` directories into `tests/eval/gold-mine/` and `tests/eval/gold-mine-local/` fixture sets, with secrets redacted, for use as eval seeds and daily-mutator inputs.

## Acceptance criteria

- `scripts/harvest-gold-mine.ts` exists and is executable via `bun run scripts/harvest-gold-mine.ts`.
- `--dry-run` flag prints a harvest summary to stdout without writing any files to disk.
- `--skip-github` and `--skip-local` flags skip the respective source independently.
- `--repo <name>` limits GitHub harvest to a single repo.
- GitHub harvest enumerates all non-fork repos under `twaldin`, finds files matching `(spec|plan|design|proposal|acceptance|requirements|todo|roadmap|tasks?)\.md` in HEAD and in commit history (up to 200 commits), fetches content, and links each file to a PR via the commits API where available.
- Local harvest walks `~/code`, `~/projects`, `~/src` up to depth 6, skipping `node_modules`, `.git`, `target`, `dist`, `.next`, `build`, `.venv`, `venv`, and collects matching filenames (same pattern), skipping files > 1 MB.
- Redaction runs before any fixture is written: `ghp_*`, `github_pat_*`, `AKIA*`, `sk-*`, `pk-*`, `Bearer <token>`, `API_KEY=*`, `AUTH_TOKEN=*`, `/key/<token>/`, emails (except the repo author's and local git user's), and tokens ≥ 32 alphanumeric chars (excluding 40-char hex git SHAs).
- Each GitHub fixture directory contains `task.md` (TODO checkboxes stripped), `redacted.md`, `metadata.json`, and `acceptance.md` (PR body + final commits).
- Each local fixture directory contains `task.md`, `redacted.md`, `metadata.json` (no `acceptance.md`).
- Deduplication by content-hash + filename stem: when duplicates exist, keep the deepest commit depth; break ties by most-recent commit date.
- After writing, a self-check re-scans each `redacted.md` and throws if any redactable token remains, exiting with a non-zero status.
- `tests/eval/gold-mine/SUMMARY.md` is written with run statistics (repos scanned, files matched, fixtures written, duplicates merged, top 20 by length, top 20 by depth, suspected leaks list).
- `tests/eval/README.md` exists explaining fixture layout and regeneration commands.
- Unit tests at `tests/unit/harvest-gold-mine.test.ts` pass via `bun test tests/unit/harvest-gold-mine.test.ts`.
- `bun run scripts/harvest-gold-mine.ts --skip-github --skip-local` exits 0 (smoke test, no network required).

## Out of scope

- Any UI or dashboard for browsing fixtures.
- Harvesting repos from other GitHub users/orgs.
- Scheduling or automation of re-harvest runs.
- Mutation or transformation of fixture content beyond redaction and TODO-stripping.
- CI integration (harvest is a manual/on-demand operation).

## Open questions

None blocking — the implementation is complete and the coder confirmed both unit tests and a no-op smoke run pass.
