# src/tui/

Real-time terminal UI for the fleet. **Hand-rolled raw-ANSI renderer — no Ink, no React, no curses.** A double-buffered cell grid with damage tracking writes only the cells that changed each frame, wrapped in DEC 2026 synchronized-output for zero-flicker on modern terminals.

## Files

- `app.ts` — top-level state machine, event loop, modal coordination.
- `screen.ts` — `Cell` grid, `parseAnsi` integration, diff-and-flush rendering.
- `ansi-parser.ts` — ANSI/SGR/cursor-control parser used to fold tmux pane captures into the cell grid.
- `panels.ts` — layout calculation + per-pane rendering (sidebar, log, status, banner).
- `sidebar-utils.ts` — agent tree ordering with collapse/expand and descendant counts.
- `input.ts` — stdin → key event dispatch, paste detection, completion item plumbing.
- `keybinds.ts` — `~/.flt/keybinds.json` loader + binding lookup.
- `command-parser.ts` — `:spawn …`, `:send …`, `:theme …` command-mode parser.
- `theme.ts` — 15 built-in themes + RGB resolution for the cell renderer.
- `ascii.ts` — figlet-based custom sidebar logos.
- `columns.ts` — sidebar column layout (status icon, name, model, mode).
- `modal-workflows.ts` / `modal-gates.ts` / `metrics-modal.ts` — modal screens for workflows, human gates, metrics rollups.
- `render.ts` — entry that orchestrates a single frame draw.
- `types.ts` — `Mode`, `AgentView`, `ModalState`, `InboxMessage`, `MetricsModalState`, etc.

## Modes

Modal UI. The current mode is one of:

`normal` · `log-focus` · `insert` · `command` · `inbox` · `presets` · `kill-confirm` · `shell` · `workflows` · `metrics` · `gates`

Mode determines which keybinds are active and how stdin is routed. `insert` forwards keystrokes directly to the selected agent's tmux pane; `command` drives the `:`-prefixed command line; `log-focus` runs vim-style scroll/search on the log buffer. New modes go in the `Mode` union in `types.ts` and an entry in the dispatch table in `app.ts`.

## Rendering loop

1. State change (status poll, key event, inbox arrival) triggers a re-layout.
2. `panels.ts` writes new cells into the back-buffer grid.
3. `screen.ts` diffs back vs front, emits the minimum SGR + cursor-positioning sequence to update changed cells, wraps the batch in `\e[?2026h … \e[?2026l` (synchronized output).
4. Front buffer becomes back buffer.

Don't bypass the cell grid by writing escape sequences directly to stdout — it desyncs the diff. If you need a new visual element, render it into cells through `panels.ts`.

## ANSI stream from agents

Each agent's pane is captured via `tmux capture-pane -e` and fed through `ansi-parser.ts` into a separate scrollback buffer per agent. OSC 8 hyperlinks are stripped (terminals re-emit them inconsistently). Agent log streams stay raw — search and scroll operate on the parsed cell grid, not on the stripped text.

## Read-only

The TUI is a pure reader of `~/.flt/state.json` and tmux. All mutations (spawn/send/kill) go through the controller via `src/commands/*` functions imported from `app.ts`. This is what makes it safe to close and reopen the TUI without affecting agents — there is no TUI-owned state to lose.

## Conventions

- **Vim-style by default.** `j/k` navigate, `g/G` jump, `/` searches, `Esc` leaves modes. Keep new bindings consistent or expose them through `~/.flt/keybinds.json`.
- **No frameworks.** Don't introduce Ink, blessed, or similar; the renderer's perf and correctness depend on owning the cell grid end-to-end.
- **Background = theme bg.** Always resolve cell `bg` through `theme.ts` so a transparent cell still paints the user's chosen background, not the terminal default.
- **Agent tree is sorted by parent → child.** `sortTreeOrder` in `app.ts` guarantees array index matches display row; sidebar selection logic relies on that invariant.
