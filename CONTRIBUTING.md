# Contributing to flt

Thanks for the interest. flt is a solo project; I merge PRs when I have time.

## Before you open a PR

- **Open an issue first** for anything bigger than a typo or a one-line fix. Saves both of us from writing code that won't land.
- Keep the scope tight. One conceptual change per PR. If your patch touches five subsystems, split it.
- Match existing style. No new abstractions without a reason. Read a few neighboring files before writing.

## Running the tests

```bash
bun install
bunx tsc --noEmit
bun test
```

All tests and the typecheck must pass. CI runs `bunx tsc --noEmit`, then the unit and integration suites separately. `bun test` also includes adapter telemetry tests.

Integration tests create real tmux sessions. On a machine with a live fleet, run tests with a temporary HOME and private tmux socket directory, with `TMUX` unset so it cannot select your live server:

```bash
(
  sandbox=$(mktemp -d /tmp/flt-tests.XXXXXX)
  mkdir -p "$sandbox/tmux"
  trap 'env -u TMUX TMUX_TMPDIR="$sandbox/tmux" tmux kill-server 2>/dev/null || true; rm -rf "$sandbox"' EXIT
  git config --file "$sandbox/.gitconfig" init.defaultBranch main
  git config --file "$sandbox/.gitconfig" user.name "flt tests"
  git config --file "$sandbox/.gitconfig" user.email "flt-tests@example.invalid"
  env -u TMUX -u FLT_AGENT_NAME -u FLT_PARENT_NAME -u FLT_PARENT_SESSION \
    -u FLT_DEPTH -u FLT_SKILLS_DIR -u FLT_ALLOW_NO_WORKTREE \
    HOME="$sandbox" TMUX_TMPDIR="$sandbox/tmux" bun test
)
```

Install dependencies before entering the sandbox. The temporary Git configuration is only for fixture repositories; your configured identity is unchanged. The tool-gated TUI pilot test skips when `tctl` is absent from the temporary HOME. See [the TUI testing guide](docs/testing-tui.md) for separate TUI verification.

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
