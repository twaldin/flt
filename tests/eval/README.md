# Eval fixtures

Two kinds of fixtures live here:

**Hand-authored task fixtures** (B4 / `flt eval suite`): each directory contains `task.md`, `acceptance.md`, and either `repo-clone-cmd.sh` or `repo-snapshot/`. Used by `flt eval suite list` / `flt eval suite run <name>` to spawn the configured workflow against a known scenario.

**Harvested fixtures** (gold-mine):

- `gold-mine/`: fixtures harvested from `github.com/twaldin/*` repositories.
- `gold-mine-local/`: fixtures harvested from local task-shaped markdown files.

Each harvested fixture file:

- `task.md`: original task content with TODO checkbox lines stripped.
- `redacted.md`: redacted task content for safe eval usage.
- `metadata.json`: source provenance and commit metadata.
- `acceptance.md`: GitHub fixtures only; derived from linked PR + final commits.

Regenerate harvested fixtures:

```bash
bun run scripts/harvest-gold-mine.ts
bun run scripts/harvest-gold-mine.ts --repo flt --dry-run
bun run scripts/harvest-gold-mine.ts --skip-local
bun run scripts/harvest-gold-mine.ts --skip-github
```
