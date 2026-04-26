# Coder handoff

## What I changed

- Added `scripts/harvest-gold-mine.ts` implementing the harvest pipeline, including:
  - task-shaped filename matching
  - TODO checkbox stripping
  - ordered redaction rules with flags
  - GitHub and local harvest flows
  - dedupe by content hash + filename stem with depth/date tie-breaks
  - fixture writing (`task.md`, `redacted.md`, `metadata.json`, `acceptance.md` for GitHub)
  - summary generation at `tests/eval/gold-mine/SUMMARY.md`
- Added unit tests at `tests/unit/harvest-gold-mine.test.ts` covering pure helper behavior from the design.
- Added `tests/eval/README.md` describing downstream usage by daily-mutator and eval suite.
- Added initial generated summary file at `tests/eval/gold-mine/SUMMARY.md`.

## Risks / reviewer focus

- Historical-only GitHub file discovery uses commit traversal and may miss very old files if they are outside the traversal window.
- Linked PR lookup depends on `commits/{sha}/pulls`; API behavior differs across repos and may return empty for some commits.
- Full fixture population is environment-dependent (`gh` auth + local directory availability).

## Tests run

- `bun test tests/unit/harvest-gold-mine.test.ts` ✅
- `bun run scripts/harvest-gold-mine.ts --skip-github --skip-local` ✅
