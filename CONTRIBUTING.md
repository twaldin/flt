# Contributing to flt

Thanks for the interest. flt is a solo project; I merge PRs when I have time.

## Before you open a PR

- **Open an issue first** for anything bigger than a typo or a one-line fix. Saves both of us from writing code that won't land.
- Keep the scope tight. One conceptual change per PR. If your patch touches five subsystems, split it.
- Match existing style. No new abstractions without a reason. Read a few neighboring files before writing.

## Running the tests

```bash
bun install
bun test
```

All 199 tests must pass. If your change needs new tests, add them.

## Style

- TypeScript, strict mode.
- No `as any` or `as unknown as` casts.
- Match surrounding code. If in doubt, look at the module you're editing.
- Write no comments by default. Only add a comment when *why* the code is the way it is would surprise a future reader.

## PR etiquette

- Title: imperative, lowercase ("fix self-kill cascade", not "Fixed Self-Kill Cascade").
- Body: what changed, why, how you tested. Three bullets is often enough.
- Reference the issue if there is one.
- Don't ping for a review; I see new PRs.

## What I'm likely to merge

- Bug fixes with a test that would have caught the bug.
- New CLI adapters (see `src/adapters/` — `claude-code.ts` is the simplest reference).
- Workflow primitives that other users will actually use.
- Documentation fixes.

## What I'll probably close

- "Let's rewrite in Rust / Go / X" — no.
- Dependency bumps with no other change (I'll handle these).
- Drive-by style reformatting.
- Features gated behind "it would be nice if".
