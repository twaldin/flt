# flt Architecture

Deep dive into flt's internals. For a high-level overview see the README; for per-adapter details see `docs/adapters.md`.

---

## Controller daemon

### Lifecycle

The controller is a Bun HTTP server running on a Unix domain socket (`~/.flt/controller.sock`). It is the only process that writes to `state.json`.

```
~/.flt/controller.sock   — HTTP server (Bun.serve)
~/.flt/controller.pid    — PID of the controller process
```

**Startup sequence** (`src/controller/server.ts`):

1. Delete stale socket file (if the previous run crashed)
2. Write `controller.pid`
3. `reconcileAgents()` — scan live tmux sessions for `flt-*` sessions not in state, restore them
4. `startPolling(1000)` — begin 1-second poll loop
5. Register `setStatusChangeCallback` for workflow advancement
6. Start `Bun.serve` on the Unix socket

**Shutdown:** SIGTERM/SIGINT → stop polling, delete socket and PID file, close server.

**Auto-start:** Any `flt spawn`, `flt send`, or `flt kill` command that runs outside the controller checks `isControllerRunning()` (synchronous curl to `/ping`). If the controller is not running, `ensureController()` spawns it in a detached tmux session named `flt-controller` before sending the RPC request.

### RPC protocol

The controller exposes a single `/rpc` POST endpoint. All commands are serialized through it when called from outside the controller process.

```typescript
type ControllerRequest =
  | { action: 'spawn'; args: SpawnRequestArgs }
  | { action: 'kill';  args: { name: string } }
  | { action: 'send';  args: { target: string; message: string; _caller?: CallerContext } }
  | { action: 'list' | 'status' | 'ping' }
```

Responses:
```typescript
interface ControllerResponse {
  ok: boolean
  data?: unknown   // string | object depending on action
  error?: string
}
```

Timeout: 120 seconds (for slow operations like spawn with a 60s readiness poll).

### Reconciliation

On startup, the controller calls `reconcileAgents()` which:

1. Lists all tmux sessions matching `flt-*` (excluding `flt-shell` and `flt-controller`)
2. For each session not already in state, reads `tmux show-environment` to find `FLT_AGENT_NAME`
3. Detects `cli` and `model` from the pane's process args via `ps`
4. Infers `worktreePath`/`worktreeBranch` if the working directory contains `flt-wt-`
5. Registers the agent in state with `spawnedAt = now`

This lets you restart the controller without losing track of running agents.

---

## State file format

`~/.flt/state.json` is the single source of truth for fleet state.

```typescript
interface FleetState {
  orchestrator?: {
    tmuxSession: string    // tmux session name of the human's terminal
    tmuxWindow: string     // TMUX_PANE value
    type: 'human' | 'agent'
    initAt: string         // ISO timestamp
  }
  agents: Record<string, AgentState>
  config: {
    maxDepth: number       // default 3
  }
}

interface AgentState {
  cli: string              // adapter name, e.g. 'claude-code'
  model: string            // model string or 'default'
  tmuxSession: string      // e.g. 'flt-mycoder'
  parentName: string       // 'human', 'cron', or another agent name
  dir: string              // working directory (worktree path when worktrees are used)
  worktreePath?: string    // absolute path to git worktree
  worktreeBranch?: string  // branch name, e.g. 'flt/mycoder'
  spawnedAt: string        // ISO timestamp
  status?: AgentStatus     // current status as set by the poller
  statusAt?: string        // ISO timestamp of last status change
  persistent?: boolean     // if true, TUI shows ⟳ when dead instead of ○
}
```

### Locking

State writes use a file lock (`state.json.lock`) with a 5-second timeout. Lock acquisition is a spin loop using `O_EXCL` (exclusive create). All writes use atomic rename: write to `state.json.tmp`, then rename to `state.json`. This prevents partial reads.

Reads do **not** acquire the lock — they read the current file directly. The rename-swap guarantees readers never see a partial write.

---

## Poller design

`src/controller/poller.ts` runs at 1-second intervals. Each tick:

1. Load state (single read)
2. Get live tmux sessions (`tmux list-sessions`)
3. For each agent whose session is live:
   - Capture last 50 lines of pane (`tmux capture-pane -S -50 -e`)
   - Compute `simpleHash(pane)` — djb2 hash
   - Call `detectAgentStatusFromPane(name, agent, pane, hash)`
   - Apply `applyContentStableTimeout`
   - If status changed, update `agent.status` and `agent.statusAt`, mark dirty
4. If any agent changed status, write state once (single batched write)

### Spinner detection (Claude Code)

Per-agent state in module scope:
- `lastIcons[name]` — icon seen on previous poll
- `iconStableCount[name]` — consecutive polls with same icon

```
icon changed → running, reset stableCount = 0
icon same, stableCount < ICON_IDLE_THRESHOLD(3) → running
icon same, stableCount >= 3 → idle
no icon → idle
```

`extractSpinnerIcon()` greps for the **last** line-starting occurrence of any spinner character (`/^[·∗✢✳✶✻✽]/gm`). Using the last match avoids false positives from "Cooked for Xs" display lines that retain a frozen spinner from a previous turn.

### Content-delta fallback

Used when the adapter's `detectStatus()` returns `'unknown'`:

Per-agent state:
- `lastHashes[name]` — hash of pane on previous poll
- `hashStableSince[name]` — timestamp when content stopped changing

```
hash changed → running, delete hashStableSince
hash stable, age < CONTENT_IDLE_GRACE_MS(5000) → keep current status
hash stable, age >= 5000ms → idle
```

A typing-agent guard prevents content-delta from flipping status when the user is actively typing into the agent from the TUI (detected via `~/.flt/typing` file written by the TUI and deleted on exit).

### Content-stable timeout

Applied after adapter detection and delta fallback. Tracks per-agent `stableTracker[name] = { hash, since }`. If content hasn't changed for `CONTENT_STABLE_TIMEOUT_MS = 60_000ms` and status is `'running'` or `'unknown'`, forces `'idle'`. This catches stuck agents.

### Watchdog

The poller tracks two additional failure conditions beyond normal status detection:

**Dead session detection:** After all live agents are polled, a second pass checks agents whose tmux session is no longer in the live session list. These agents get status `'exited'`, and the watchdog appends an inbox message: `[WATCHDOG]: Agent <name> died (session gone)`. The `onStatusChange` callback fires with the `'exited'` status, which the workflow engine can act on.

**Stuck detection:** Per-agent `runningSince[name]` tracks the timestamp when status entered `'running'`. If the agent has been continuously `running` for 30+ minutes (`STUCK_THRESHOLD_MS = 30 * 60 * 1000`), the watchdog appends: `[WATCHDOG]: Agent <name> has been running for 30+ minutes — may be stuck`. The warning is sent once per continuous run (`stuckWarned[name]` guards against repeats).

### Workflow hook

The controller registers a `StatusChangeCallback`. When any agent transitions `running → idle`, the callback checks if the agent belongs to a running workflow via `getWorkflowForAgent(name)`. If yes, `advanceWorkflow(workflowName)` is called asynchronously.

`advanceWorkflow` reads `run.stepResult` (set by `flt workflow pass/fail`) to determine routing: `'pass'` → `on_complete`, `'fail'` → `on_fail`. If `stepResult` is unset, the default path is `on_complete`.

---

## Spawn flow

`src/commands/spawn.ts`:

1. If not in controller, route via RPC with caller context (`FLT_AGENT_NAME`, `FLT_DEPTH`)
2. Resolve preset → cli, model
3. Validate name uniqueness and format (`[a-zA-Z0-9_-]+`)
4. Check depth limit (`callerDepth < config.maxDepth`)
5. Create git worktree at `/tmp/flt-wt-<name>` on branch `flt/<name>` (unless `--no-worktree`)
6. Resolve parent: `--parent` flag > `FLT_AGENT_NAME` env > `'human'`
7. `projectInstructions(workDir, adapter.instructionFile, opts)` — writes flt system block + SOUL.md into workspace
8. `projectSkills(workDir, adapter, name)` — injects skills
9. `tmux.createSession(sessionName, workDir, command, env)` — starts `flt-<name>` session
10. `waitForReady(session, adapter, 60_000)` — polls with dialog auto-approval
11. `setAgent(name, ...)` — register in state (single state write)
12. Send bootstrap message if provided (paste buffer for >200 chars or multi-line, send-literal otherwise)

Environment variables set in the tmux session:
- `FLT_AGENT_NAME=<name>`
- `FLT_PARENT_SESSION=<session>`
- `FLT_PARENT_NAME=<parentName>`
- `FLT_DEPTH=<callerDepth + 1>`
- `PATH=<inherited PATH>`

### Readiness polling

Loop every 500ms for up to 60 seconds:

```
pane = capturePane(session)
state = adapter.detectReady(pane)

if state == 'dialog':
  keys = adapter.handleDialog(pane)
  if keys: sendKeys(session, keys); continue

if state == 'ready':
  if pane == lastContent: stableCount++
  else: stableCount = 0
  if stableCount >= 2: return  // two consecutive stable reads

if session died: throw
```

On timeout, logs a warning but does NOT throw — the agent is registered and bootstrapped regardless. This handles CLIs (like codex) that take longer than 60 seconds to start.

---

## Kill flow

`src/commands/kill.ts`:

1. Route via RPC if not in controller
2. Find agent in state
3. `killProcessTree(panePid)` — SIGTERM children depth-first, then parent; SIGKILL after 2s if any alive
4. `tmux.killSession(session)`
5. `removeWorktree(repoDir, worktreePath, branch)` if worktree exists
6. `restoreInstructions(workDir, instructionFile)` — restore backup of instruction file
7. `cleanupSkills(workDir, adapter, name)` — remove projected skills
8. `removeAgent(name)` — remove from state
9. `cleanupAgent(name)` — clear poller tracking maps

---

## Parent routing

`flt send parent` routing (`src/commands/send.ts`):

```
caller.parentName == 'human' or 'cron' → appendInbox(sender, message)
caller.parentName == '<agent>'
  → parent agent alive in tmux → sendLiteral(session, '[SENDER]: msg') + submitKeys
  → parent agent dead → appendInbox(sender, message) (fallback)
```

Caller context is detected from `FLT_AGENT_NAME` / `FLT_PARENT_NAME` env vars. For CLIs that don't propagate tmux session environment to subprocesses (codex), `detect.ts` reads the vars from `tmux show-environment` as fallback.

**Parent resolution at spawn time** (`src/commands/spawn.ts`):

```
--parent <name> flag          → use that name
FLT_AGENT_NAME env is set
  and not 'cron'              → use that agent name
otherwise                     → 'human'
```

`cron` callers (where `FLT_AGENT_NAME=cron`) are treated as `human` — their spawned agents report to inbox, not back to the cron script.

Messages longer than 200 characters or containing newlines use `tmux.pasteBuffer()` (writes to a temp file, loads as a named buffer, pastes) to avoid tmux argument length limits and semicolon interpretation issues.

---

## Activity log

`~/.flt/activity.log` — append-only JSONL event stream. Written by the poller on status changes, and by spawn/kill/workflow operations.

```typescript
interface FleetEvent {
  type: 'spawn' | 'kill' | 'status' | 'workflow' | 'message' | 'error'
  agent?: string   // agent name, if applicable
  detail: string   // human-readable description
  at: string       // ISO timestamp
}
```

Example lines:

```jsonl
{"type":"spawn","agent":"coder","detail":"cli=claude-code model=sonnet preset=coder dir=/tmp/flt-wt-coder","at":"2026-04-14T10:00:00Z"}
{"type":"status","agent":"coder","detail":"unknown -> running","at":"2026-04-14T10:00:05Z"}
{"type":"workflow","detail":"started pr-review","at":"2026-04-14T10:00:01Z"}
{"type":"workflow","detail":"advanced pr-review-implement step review","at":"2026-04-14T10:05:00Z"}
{"type":"workflow","detail":"completed pr-review","at":"2026-04-14T10:08:00Z"}
```

View with `flt activity` (`-n` for count, `--type` to filter, `--since <iso>` for time window).

---

## Inbox format

`~/.flt/inbox.log` — append-only, one message per line:

```
[HH:MM:SS] [SENDER]: message text
```

Legacy format also supported by the parser:
```
[HH:MM:SS] sender: message text
```

The TUI parses inbox on every poll tick and compares raw content to detect new messages. New messages trigger a `'message'` notification badge on the inbox entry in the sidebar.

---

## Instruction injection

`src/instructions.ts` writes a system block into the agent's instruction file:

```
<!-- flt:start -->
<system block from templates/system-block.md with {{name}}/{{parentName}}/{{cli}}/{{model}} substituted>

<SOUL.md content if ~/.flt/agents/<name>/SOUL.md exists>
<!-- flt:end -->
```

If the instruction file already exists:
- Contains `<!-- flt:start -->` → replace the existing flt block in-place
- No flt block → backup the file to `.flt-backup-<filename>`, prepend the flt block

`flt kill` calls `restoreInstructions()` which copies the backup back and deletes it.

---

## Skills injection

`src/skills.ts`:

Skills are Markdown files with optional YAML-like frontmatter:

```markdown
---
name: health-check
description: VPS health check procedure
cli-support: ['*']
---

<skill body>
```

`cli-support` is an array of adapter names, or `['*']` for all CLIs.

Load order: global skills (`~/.flt/skills/`) then agent-local (`~/.flt/agents/<name>/skills/`). Agent-local wins on name collision.

**Injection — Claude Code:** Each skill is written to `~/.claude/commands/<name>.md` with a `<!-- flt-managed -->` comment. On kill, any command file containing that marker is deleted.

**Injection — all other CLIs:** Skills are appended to the instruction file as a fenced block:

```
<!-- flt:skills:start -->

## Skill: <name>
_description_

<skill body>
<!-- flt:skills:end -->
```

If a skills block already exists, it is replaced in-place. On kill, the block is removed.

---

## TUI rendering pipeline

`src/tui/` implements a double-buffered terminal renderer without React/Ink.

### Screen (`src/tui/screen.ts`)

```
Screen {
  cols, rows
  front: Cell[][]   // last rendered state
  back:  Cell[][]   // next frame being composed
}

Cell { char, fg, bg, attrs }
attrs = ATTR_BOLD | ATTR_DIM | ATTR_ITALIC | ATTR_UNDERLINE | ATTR_INVERSE
```

`flush()` diffs `back` against `front`, emitting only changed cells. Output is batched into a single string and written with one `stdout.write()`. If the terminal supports DEC 2026 synchronized output (`\x1b[?2026h ... \x1b[?2026l`), the entire frame is wrapped — this eliminates flicker on Ghostty and other modern terminals.

`resize()` rebuilds both grids and sets `forceFullRedraw = true` for the next flush.

### ANSI parser (`src/tui/ansi-parser.ts`)

`parseAnsi(text, grid, row, col, width, height)` renders ANSI-colored text from a tmux pane capture directly into the cell grid. Handles SGR sequences (colors, bold, dim, italic, underline, inverse), cursor movement, and line wrapping within the clipping rectangle.

### Layout (`src/tui/panels.ts`)

`calculateLayout(cols, rows, agents, order)` computes all panel positions:

- **Sidebar width** — dynamically sized to fit the widest agent entry (name + tree connectors + cli/model string + dir) or the ASCII logo width, whichever is larger. Clamped between 18 and `cols - 24`.
- **Log pane** — takes remaining width
- Two rows at the bottom reserved for the command bar and status bar

`renderLayout()` calls `screen.clear()`, draws rounded (`╭`) box borders for sidebar and log pane, then calls the specific panel renderers.

### Agent tree (`treeOrder`)

Agents are sorted depth-first, parent before children. Each entry carries:
- `continuation` — vertical bar characters (`│ `) for each ancestor level still continuing
- `connector` — `├` (more siblings) or `└` (last child) for the name row
- `hasChildren` — whether this agent has children in the current list

Each agent occupies 5 rows in the sidebar: padding above, name+status+age, cli/model, dir, padding below.

### Sidebar scrolling

When the agent tree exceeds the available sidebar height, the sidebar scrolls. `sidebarScrollOffset` in `AppState` tracks the first visible entry. `selectNext` / `selectPrev` call `sidebarScrollSync()` which clamps the offset so the selected agent is always visible.

### Collapsible trees

`collapsedAgents: string[]` in `AppState` lists agents whose subtrees are hidden. Toggle with **Shift-Enter** in normal mode. A collapsed agent shows `[+N]` suffix in the name row (N = number of hidden descendants). `sortTreeOrder(agents, collapsedSet)` excludes descendants of collapsed agents from the display list and attaches `collapsedChildCount` to collapsed entries for the suffix label.

**Persistent agents:** If `agent.persistent === true` and `agent.status === 'exited'`, the TUI renders `⟳` instead of the normal `○` exit symbol, and prefixes the name with `P `. This signals to operators that the agent is expected to be respawned by its cron job.

### Inbox (`renderInbox`)

Splits the available height 35%/65% (list / detail). List shows timestamp + colored sender tag + message preview. Selected message fills the detail pane with word-wrapped body. Sender colors are derived from a djb2 hash of the sender name mapped to a 10-color palette.

### Input (`src/tui/input.ts`)

`RawKeyParser` runs `process.stdin` in raw mode, parsing byte-by-byte:

- ANSI CSI sequences (`\x1b[...`) → arrow keys, function keys, Kitty keyboard protocol (`\x1b[<cp>u`)
- Bracketed paste (`\x1b[200~...\x1b[201~`) → emitted as a single `text` event
- OSC sequences (`\x1b]...`) → silently skipped (avoids hanging on terminal file drop events)
- Escape with 50ms timeout → plain `escape` key if no sequence follows
- `\x03` (Ctrl-C) → `'ctrl-c'` key event

In **insert** mode, `Ctrl-c` sends tmux key `Escape` to the agent (interrupts generation) instead of SIGINT (which would kill the CLI process).

In insert mode, keystrokes are batched via `sendLiteralBatched()` — characters accumulate in a 16ms buffer then flush as a single `tmux send-keys -l` call, reducing process spawns from one per keystroke to ~one per frame.

A `~/.flt/typing` file is written when insert mode is active and deleted on exit, so the poller can suppress content-delta status changes while the user is actively typing.

### Modes

| Mode | Description |
|------|-------------|
| `normal` | Sidebar navigation, quick shortcuts |
| `log-focus` | Scroll/search agent output |
| `insert` | Type directly to selected agent |
| `command` | `:command` bar with Tab completion |
| `inbox` | Email-client message list + detail |
| `shell` | Embedded shell pane (`flt-shell` session) |
| `kill-confirm` | y/n confirmation before killing |
| `presets` | Preset list view |

The log pane border changes style to match the mode: `double` in log-focus, `round` in all other modes, and its color reflects the mode indicator color.
