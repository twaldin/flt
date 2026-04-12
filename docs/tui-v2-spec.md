# flt TUI v2 — Raw ANSI Rewrite

## Why

Ink (React for CLIs) is fundamentally too slow for a terminal multiplexer UI.
React reconciliation + full-screen line-by-line rewriting takes 100-200ms per
frame, causing visible progressive redraw flicker. Insert mode typing is laggy
because keystrokes go through React's event loop.

## Architecture

Replace Ink entirely with a **raw ANSI screen buffer with damage tracking** —
the same approach used by lazygit, btop, and htop. Maintain two screen grids
(front/back), diff them, write only changed cells in a single `process.stdout.write()`.

### Performance targets
- Render diff: <1ms for a 200x60 terminal
- Output per frame: 200-2000 bytes (changed cells only) vs 24000 (full screen)
- Input latency: <1ms (raw stdin, no React event loop)
- Zero visible flicker on Ghostty (GPU-accelerated, supports DEC 2026 synchronized output)

## File Structure

All new code replaces `src/tui/`. Keep the same layout/keybindings design.

```
src/tui/
  screen.ts         # Screen class — double-buffered cell grid + damage-tracking flush
  ansi-parser.ts    # Parse raw ANSI text (from tmux capture-pane -e) into Cell grid
  input.ts          # Raw stdin handler — key parsing, mode dispatch
  panels.ts         # Layout: sidebar, log pane, banner, status bar, command bar
  theme.ts          # Color/style constants
  app.ts            # Main loop: poll, render, handle input (replaces app.tsx)
  render.ts         # Entry point: setup terminal, start app loop, cleanup on exit
  command-parser.ts # KEEP existing — parse :commands (already pure, no Ink deps)
```

Remove all `.tsx` files, `ink` and `react` dependencies.

## Core: screen.ts

```typescript
interface Cell {
  char: string       // single character
  fg: string         // ANSI color code or '' for default
  bg: string         // ANSI color code or '' for default
  attrs: number      // bitmask: 1=bold, 2=dim, 4=italic, 8=underline, 16=inverse
}

class Screen {
  rows: number
  cols: number
  front: Cell[][]    // what's currently on the terminal
  back: Cell[][]     // what we want to show next

  constructor(cols: number, rows: number)

  // Write plain text at position with attributes
  put(row: number, col: number, text: string, fg?: string, bg?: string, attrs?: number): void

  // Write raw ANSI text (from tmux capture-pane) into a rectangular region
  // Uses ansi-parser to decode escape sequences into cells
  putAnsi(row: number, col: number, width: number, height: number, ansiText: string): void

  // Draw box border (single/double/round line-drawing characters)
  box(row: number, col: number, width: number, height: number, style: 'single' | 'double' | 'round', color?: string): void

  // Clear a rectangular region to empty cells
  clear(row: number, col: number, width: number, height: number): void

  // Diff front vs back, emit minimal escape sequences, single stdout.write
  flush(): void

  // Resize grids, mark everything dirty
  resize(cols: number, rows: number): void
}
```

### flush() algorithm

```
1. Build output string:
   - For each cell where back[r][c] !== front[r][c]:
     - Move cursor: \x1b[{r+1};{c+1}H (skip if cursor is already there)
     - Set attributes: only emit SGR if changed from last written cell
     - Write the character
     - Copy back[r][c] to front[r][c]
2. Single process.stdout.write(output)
3. Optional: wrap with \x1b[?2026h ... \x1b[?2026l for synchronized output
```

Key optimization: consecutive changed cells on the same row don't need cursor
repositioning — the cursor advances automatically. Build runs of consecutive
dirty cells and write them as strings, not char-by-char.

## Core: ansi-parser.ts

Parse the output of `tmux capture-pane -p -e` into cells.

```typescript
// Parse ANSI text and write cells into a target grid region
function parseAnsi(text: string, grid: Cell[][], startRow: number, startCol: number, maxWidth: number, maxHeight: number): void

// The parser tracks:
// - Current SGR state (fg, bg, bold, dim, etc.)
// - Current cursor position within the region
// - Handles: SGR (m), cursor movement (H), erase (J/K), newlines
// - Ignores: other CSI sequences
```

SGR codes to handle:
- 0: reset all
- 1: bold, 2: dim, 3: italic, 4: underline, 7: inverse
- 22: normal intensity, 23: no italic, 24: no underline, 27: no inverse
- 30-37: standard fg colors
- 38;5;N: 256-color fg
- 38;2;R;G;B: truecolor fg
- 39: default fg
- 40-47: standard bg colors
- 48;5;N: 256-color bg
- 48;2;R;G;B: truecolor bg
- 49: default bg
- 90-97: bright fg colors
- 100-107: bright bg colors

## Core: input.ts

```typescript
type Mode = 'normal' | 'log-focus' | 'insert' | 'command' | 'inbox'

interface InputHandler {
  mode: Mode
  onKey(key: string, raw: Buffer): void
  onResize(): void
}
```

Raw stdin setup:
```typescript
process.stdin.setRawMode(true)
process.stdin.resume()
process.stdin.on('data', (buf: Buffer) => {
  // Parse raw bytes into key events
  // Single byte: regular char or ctrl+char
  // \x1b: escape (wait 50ms for more bytes — could be escape sequence)
  // \x1b[A/B/C/D: arrow keys
  // \x1b[Z: shift-tab
  // \r or \n: enter
  // \x7f: backspace
  // \t: tab
})
```

Key parsing must handle:
- Escape ambiguity: bare \x1b (50ms timeout) vs \x1b[ (escape sequence start)
- Paste detection: rapid multi-byte input (don't interpret as separate keys)
- UTF-8: multi-byte characters

## Layout: panels.ts

```typescript
function renderLayout(screen: Screen, state: AppState): void {
  const { cols, rows } = screen

  // Calculate layout
  const sidebarWidth = Math.floor(cols * 0.28)
  const logWidth = cols - sidebarWidth
  const statusHeight = 2  // command bar + status bar
  const bannerHeight = 10 // DOS Rebel flt banner + border
  const contentHeight = rows - statusHeight

  // 1. Sidebar (left panel)
  screen.box(0, 0, sidebarWidth, contentHeight, 'round', 'cyan')
  renderSidebar(screen, state, 1, 1, sidebarWidth - 2, contentHeight - 2)

  // 2. Banner (top-right)
  screen.box(0, sidebarWidth, logWidth, bannerHeight, 'round', 'red')
  renderBanner(screen, 1, sidebarWidth + 1, logWidth - 2)

  // 3. Log pane (right, below banner)
  const logTop = bannerHeight
  const logHeight = contentHeight - bannerHeight
  const borderColor = state.mode === 'insert' ? 'yellow' : state.mode === 'log-focus' ? 'green' : 'gray'
  screen.box(logTop, sidebarWidth, logWidth, logHeight, state.mode === 'log-focus' ? 'double' : 'round', borderColor)
  renderLogPane(screen, state, logTop + 1, sidebarWidth + 1, logWidth - 2, logHeight - 2)

  // 4. Command bar (always visible, bottom - 1)
  renderCommandBar(screen, state, rows - 2, 0, cols)

  // 5. Status bar (bottom)
  renderStatusBar(screen, state, rows - 1, 0, cols)
}
```

### renderSidebar
- For each agent: status icon (colored), name, age on line 1; cli/model on line 2; dir on line 3
- Selected agent: highlighted with ▸ prefix and cyan color
- Use `screen.put()` for each line

### renderLogPane
- Take the `logContent` string (raw ANSI from tmux capture-pane -e)
- Split by newlines, apply scroll offset
- Use `screen.putAnsi()` to write the visible lines into the log region
- Scroll indicator at bottom: "XX% FOLLOW"

### renderBanner
- Static DOS Rebel "flt" text in red bold
- Centered in the banner region

### renderCommandBar
- When active: `:` prefix + input text + cursor + completion hint
- When inactive: dim `:command...`
- Single line, no wrapping

### renderStatusBar
- Mode indicator [MODE] in color + key hints + agent info

## Main Loop: app.ts

```typescript
interface AppState {
  mode: Mode
  agents: AgentView[]
  selectedIndex: number
  logContent: string
  logScrollOffset: number
  autoFollow: boolean
  commandInput: string
  commandCursor: number
  inboxMessages: InboxMessage[]
  banner: { text: string; color: string } | null
}

class App {
  screen: Screen
  state: AppState
  pollTimer: ReturnType<typeof setInterval> | null

  start(): void {
    // Enter alternate screen, hide cursor
    process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[2J')

    // Initial render
    this.render()

    // Start poll timer
    this.startPolling()

    // Setup input handler
    setupInput(this.state, {
      onStateChange: () => this.render(),
      onInsertKey: (session, key) => { /* sendKeys/sendLiteral to tmux */ },
    })
  }

  render(): void {
    renderLayout(this.screen, this.state)
    this.screen.flush()
  }

  poll(): void {
    // Same logic as current poller:
    // 1. Read state.json for agent list
    // 2. For each agent: hasSession + detectStatus
    // 3. For selected agent: capturePane
    // 4. Diff and only call render() if something changed

    // In insert mode: skip status detection, skip resize
    // Just capture pane for selected agent
  }

  startPolling(): void {
    const ms = this.state.mode === 'insert' ? 500 : 1000
    this.pollTimer = setInterval(() => this.poll(), ms)
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    process.stdout.write('\x1b[?25h\x1b[?1049l') // show cursor, exit alt screen
    process.stdin.setRawMode(false)
  }
}
```

## Entry Point: render.ts

```typescript
export async function renderTui(): Promise<void> {
  const app = new App()
  app.start()

  process.on('SIGINT', () => {
    app.stop()
    process.exit(0)
  })

  process.on('SIGWINCH', () => {
    app.screen.resize(process.stdout.columns, process.stdout.rows)
    app.render()
  })

  // Block until quit
  await new Promise(() => {})
}
```

## Keybinding Map (unchanged from v1)

| Mode | Key | Action |
|---|---|---|
| normal | j/k | Move selection up/down |
| normal | Enter/Tab | Focus log pane |
| normal | : | Open command bar |
| normal | s | Open spawn wizard (or just :spawn) |
| normal | K (shift) | Kill confirm |
| normal | m | Open inbox |
| normal | r | Reply to selected agent |
| normal | q | Quit |
| log-focus | j/k | Scroll up/down |
| log-focus | Ctrl-d/u | Half-page scroll |
| log-focus | G | Jump to bottom (auto-follow) |
| log-focus | g | Jump to top |
| log-focus | i | Enter insert mode |
| log-focus | / | Search |
| log-focus | Esc | Back to normal |
| insert | (any) | Forward to tmux via sendKeys/sendLiteral |
| insert | Esc | Back to log-focus |
| command | Tab | Complete command/agent/model/cli |
| command | Enter | Execute |
| command | Esc | Cancel |

## Command Bar (reuse existing logic)

Keep `command-parser.ts` as-is. Tab completion for:
- Command names: send, logs, spawn, kill, theme, help
- Agent names after :send/:logs/:kill
- CLI adapters after :spawn --cli
- Model suggestions after :spawn --model (context-aware per CLI)

## What to Reuse from v1

These modules have NO Ink dependencies and are reused directly:
- `src/state.ts` — loadState, allAgents, etc.
- `src/tmux.ts` — capturePane, sendKeys, sendLiteral, resizeWindow, etc.
- `src/adapters/registry.ts` — resolveAdapter, listAdapters
- `src/adapters/*.ts` — all adapter implementations
- `src/commands/spawn.ts` — spawn()
- `src/commands/kill.ts` — kill()
- `src/commands/send.ts` — send()
- `src/commands/init.ts` — appendInbox, getInboxPath (entry point modified)
- `src/tui/command-parser.ts` — parseCommand, enrichMessageWithFiles
- `src/detect.ts` — detectCaller
- `src/skills.ts` — loadSkills

## What to Delete

All `.tsx` files, Ink components, store, poller, keybindings (replaced by raw versions):
- `src/tui/app.tsx`
- `src/tui/layout.tsx`
- `src/tui/store.ts`
- `src/tui/poller.ts`
- `src/tui/keybindings.ts`
- `src/tui/types.ts` (rewrite as plain types, no React)
- `src/tui/components/*.tsx` (all of them)
- `src/tui/ansi.ts` (replaced by ansi-parser.ts)

Remove from package.json: `ink`, `react`, `@types/react`, `ink-text-input`
Remove from tsconfig.json: `"jsx": "react-jsx"`

## Testing

Unit tests for pure logic:
- `tests/unit/tui/screen.test.ts` — cell diffing, flush output
- `tests/unit/tui/ansi-parser.test.ts` — SGR parsing, cursor movement
- `tests/unit/tui/input.test.ts` — key parsing from raw bytes
- `tests/unit/tui/command-parser.test.ts` — already exists, keep

## Implementation Order

1. **screen.ts + ansi-parser.ts** — the rendering engine. Test: write cells, flush, verify output.
2. **input.ts** — raw stdin key parsing. Test: parse escape sequences.
3. **panels.ts** — layout rendering. Test: renders correct cells at correct positions.
4. **app.ts** — main loop with polling. Wire everything together.
5. **render.ts** — entry point, replace init.ts call.
6. **Remove Ink** — delete .tsx files, remove deps from package.json/tsconfig.
7. **Verify** — `bun test` passes, `flt init` launches the new TUI.
