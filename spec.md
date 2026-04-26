# Track E — Gold-Mine Harvest into Eval Suite

## Goal

Turn historical task-shaped markdown files from `github.com/twaldin` repos — and local `~/code`, `~/projects`, `~/src` directories — into redacted eval fixtures for the GEPA loop.

## Deliverables

| Artifact | Description |
|---|---|
| `scripts/harvest-gold-mine.ts` | Harvester script (runnable with `bun run scripts/harvest-gold-mine.ts`) |
| `tests/eval/gold-mine/<repo>--<filename>/` | Fixtures from GitHub repos |
| `tests/eval/gold-mine-local/<dir-slug>/` | Fixtures from local disk |
| `tests/eval/gold-mine/SUMMARY.md` | Run report |
| `tests/eval/README.md` | Usage guide for downstream consumers |

## Pipeline

### 1. Enumerate repos
```
gh repo list twaldin --limit 200 --json name,defaultBranch,url,description,isArchived
```
Exclude forks. Include archived (real history).

### 2. Find task-shaped md files
For each repo, walk the HEAD tree via `gh api repos/twaldin/<name>/git/trees/HEAD?recursive=1`.

Match filenames against:
```
(^|/)(spec|plan|design|proposal|acceptance|requirements|todo|roadmap|TASKS?)\.md$
```

For files no longer in HEAD, fetch via `gh api 'repos/twaldin/<name>/commits?path=<file>&per_page=1'`.

### 3. Fetch content + metadata
Per file: path, last commit SHA + date, author, HEAD-present flag, linked PRs (closed by this spec).

### 4. Write fixture
Each fixture directory contains:
- `task.md` — original content, TODO checkboxes stripped
- `acceptance.md` — derived from linked PR title/body, final commits, tests added
- `metadata.json` — `{ repo, original_path, last_sha, last_date, status }`
- `redacted.md` — `task.md` after redaction pass

### 5. Redaction rules
Strip and replace with `<REDACTED:KIND>`:
- Secrets: `API_KEY`, `AUTH_TOKEN`, `/key/[a-zA-Z0-9]{16,}/`, tokens `≥32 chars`, `sk-*`, `pk-*`, `Bearer *`, `AKIA*`, `ghp_*`, `github_pat_*`
- Emails: `/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+/` — except the committer's own address

### 6. Dedupe
When the same task appears in multiple repos, keep the instance with the most commit history.

### 7. Local harvest
Walk `~/code/`, `~/projects/`, `~/src/` — skip `node_modules`, `.git`, `target`, `dist`. Apply the same filename filter and redaction. Write to `tests/eval/gold-mine-local/<dir-slug>/` with `task.md` + `metadata.json`.

### 8. Summary report
`tests/eval/gold-mine/SUMMARY.md` includes:
- Total repos scanned / md files matched
- Top 20 fixtures by length and by depth (commit count referencing file)
- Any suspected unredacted leaks flagged for human review

## Acceptance Criteria

- `bun run scripts/harvest-gold-mine.ts` runs without error and populates `tests/eval/gold-mine/` and `tests/eval/gold-mine-local/`
- Every fixture directory contains `task.md`, `metadata.json`, and `redacted.md`
- `SUMMARY.md` exists and lists counts
- `tests/eval/README.md` explains how the gold-mine fixtures feed the daily-mutator and flt eval suite
- No unredacted secrets or emails (other than committer email) in any fixture file
- Script is idempotent: re-running updates fixtures without duplicating them

## Dependencies

- Track B (B4 eval suite scaffolding) must land first; if `tests/eval/` is absent, this track creates it
- GitHub CLI (`gh`) authenticated as `twaldin`
- Bun runtime

## Hypothesis at Gate

Autonomous-possible. The harvest is mechanical (API calls + file writes) and redaction is fully rule-based. No LLM judgment required.
