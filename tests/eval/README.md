# Eval fixtures

This directory contains harvested task fixtures for evaluation workflows.

- `gold-mine/`: fixtures harvested from `github.com/twaldin/*` repositories.
- `gold-mine-local/`: fixtures harvested from local task-shaped markdown files.

Each fixture is consumed downstream by:

1. Daily mutator runs (as realistic seed tasks).
2. FLT eval suite runs (as repeatable historical scenarios).

Fixture files:

- `task.md`: original task content with TODO checkbox lines stripped.
- `redacted.md`: redacted task content for safe eval usage.
- `metadata.json`: source provenance and commit metadata.
- `acceptance.md`: GitHub fixtures only; derived from linked PR + final commits.

Regenerate fixtures:

```bash
bun run scripts/harvest-gold-mine.ts
```

Fast iteration flags:

```bash
bun run scripts/harvest-gold-mine.ts --repo flt --dry-run
bun run scripts/harvest-gold-mine.ts --skip-local
bun run scripts/harvest-gold-mine.ts --skip-github
```
