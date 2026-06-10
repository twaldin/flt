# Testing the flt TUI with the tui-pilot harness

`scripts/tui-pilot.sh` spins up a fully isolated flt instance (private HOME +
private tmux server) and pilots the TUI via tuistory — without touching the
developer's live fleet or state.

## Prerequisites

| Tool | How to get it |
|------|---------------|
| `tuistory` | `bun add -g tuistory` |
| `tctl` | Included in the droid-control plugin at `~/.factory/plugins/marketplaces/factory-plugins/plugins/droid-control/bin/tctl`. This path is machine-specific; if the plugin moves, update the `TCTL=` line in the script. |
| `tmux` | System package (`brew install tmux`). Required by the flt controller. |
| `bun` | `curl -fsSL https://bun.sh/install \| bash` |

## Isolation model

Every flt path resolves through `home()` = `process.env.HOME` (`src/state.ts`).
Overriding `HOME` to a temp directory makes `~/.flt`, `~/.flt/controller.sock`,
`~/.flt/state.json`, and all logs land in the throwaway dir.

tmux server isolation is achieved via `TMUX_TMPDIR`. Setting it to a directory
that has no existing socket causes tmux to start a fresh server with no
knowledge of the user's sessions.

`TMUX` is handled specially: the user's outer `$TMUX` socket is never passed
to the child because it would point the child's tmux calls at the real server.
Instead the `tui` subcommand sets `TMUX` to a dummy socket path in the ISO dir.
This satisfies flt's guard check (`src/commands/init.ts:328`) while ensuring
all tmux calls fail gracefully (they use `tmuxNoThrow` which swallows errors).

## Subcommands

### `up [--link <host-dir>...]`

Creates the ISO dir, starts the isolated flt controller, and prints the ISO
path. Pass `--link` to symlink CLI auth directories into the fake HOME (needed
only when spawning real AI agents — not required for TUI chrome smoke tests).

```
$ ISO=$(bash scripts/tui-pilot.sh up)
tui-pilot: starting isolated controller at /tmp/flt-pilot.AbcXyz
/tmp/flt-pilot.AbcXyz

$ echo $ISO
/tmp/flt-pilot.AbcXyz

$ ls $ISO/.flt/
controller.pid  controller.sock  state.json
```

### `tui [--record]`

Launches the flt TUI in a tuistory PTY session named `flt-pilot`. Blocks until
tuistory acknowledges the session is up. Pass `--record` to write an asciinema
`.cast` to `$ISO/tui.cast` for archival.

```
$ FLT_PILOT_HOME=$ISO bash scripts/tui-pilot.sh tui
Session "flt-pilot" started
OK
```

### `snapshot`

Prints a trimmed text snapshot of the current TUI state.

```
$ FLT_PILOT_HOME=$ISO bash scripts/tui-pilot.sh snapshot
╭────────────────────────────╮╭──────────────────────────────────────────╮
│No agents running.          ││No agent selected                         │
│                            ││                                          │
│Press : then type           ││                                          │
│spawn <name> -p default     ││                                          │
│                            ││                                          │
╰────────────────────────────╯╰──────────────────────────────────────────╯
:command...
[NORMAL] j/k select | : cmd | s spawn | w workflows | ... | q quit
```

### `down [--rm]`

Closes the tuistory session, stops the isolated controller, kills the isolated
tmux server. The ISO dir is preserved by default for post-mortem inspection;
pass `--rm` to delete it.

```
$ FLT_PILOT_HOME=$ISO bash scripts/tui-pilot.sh down --rm
tui-pilot: removed /tmp/flt-pilot.AbcXyz
```

### `smoke`

Full automated cycle: `up` → `tui` → `wait-idle` → `snapshot` → assert →
`down --rm`. Exits 0 if the snapshot contains the expected TUI chrome (`"No
agents running."` from `src/tui/panels.ts`). Exits 0 with a SKIP message if
tuistory or tctl are absent (so it is safe to call in environments that lack the
tools).

```
$ bash scripts/tui-pilot.sh smoke
tui-pilot smoke: ISO=/tmp/flt-pilot.DNoXni
tui-pilot: starting isolated controller at /tmp/flt-pilot.DNoXni
/tmp/flt-pilot.DNoXni
Session "flt-pilot" started
OK
tui-pilot smoke: snapshot:
╭────────────────────────────╮╭──────────────────────────────────────────╮
│No agents running.          ││No agent selected                         │
│                            ││                                          │
│Press : then type           ││                                          │
│spawn <name> -p default     ││                                          │
╰────────────────────────────╯╰──────────────────────────────────────────╯
:command...
[NORMAL] j/k select | : cmd | ... | q quit
tui-pilot smoke: PASS — found 'No agents running.' in snapshot
tui-pilot smoke: OK
Session "flt-pilot" closed
Controller stopped.
```

## Auth symlinks for spawning real AI agents

If the smoke test needs to spawn a real AI agent (not just verify TUI chrome),
the agent CLI reads config from `$HOME`. Symlink the relevant dirs:

```
$ ISO=$(bash scripts/tui-pilot.sh up \
    --link ~/.claude \
    --link ~/.codex \
    --link ~/.config)
```

For TUI-chrome-only verification (the primary use case), no symlinks are needed.

## Review protocol for TUI changes

TUI PRs must attach before/after snapshot output. The recommended workflow:

1. Before the change: `bash scripts/tui-pilot.sh smoke` — save the snapshot
   from stderr.
2. Apply the change.
3. After the change: `bash scripts/tui-pilot.sh smoke` — save the new snapshot.
4. Attach both snapshots to the PR body.
5. For richer evidence, pass `--record` to the `tui` subcommand and attach the
   `.cast` file. Recordings can be replayed with `asciinema play`.

Visual verdicts on snapshot diffs should be rendered by the strongest available
logical/visual reviewer model (Opus-tier or better), not by the executor that
made the change. The executor's job is to produce the before/after evidence; the
reviewer's job is to judge it.

## Cross-CLI skill discovery verification (plan 007 worked example)

Use the harness to confirm each adapter finds `.flt/skills/flt/SKILL.md` at
spawn time. For each CLI adapter to test (here: `pi` as a cheap proxy):

```bash
ISO=$(bash scripts/tui-pilot.sh up --link ~/.claude --link ~/.codex)
export FLT_PILOT_HOME=$ISO

# Spawn a cheap agent with skill projection enabled.
env -u TMUX HOME=$ISO TMUX_TMPDIR=$ISO/tmux \
  bun src/cli.ts spawn skill-check --cli pi --no-worktree \
    --dir /tmp FLT_ALLOW_NO_WORKTREE=1

# Check that the flt skill was projected into the worktree.
ls $ISO  # or: iso_env bun src/cli.ts logs skill-check

# Close the isolated session.
bash scripts/tui-pilot.sh down --rm
```

For a full cross-adapter sweep, repeat for each adapter (`claude-code`, `codex`,
`opencode`, etc.) and assert that `.flt/skills/flt/SKILL.md` is present in the
worktree after spawn and absent after kill.
