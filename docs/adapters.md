# flt Adapter Reference

Each CLI adapter implements the `CliAdapter` interface, which covers four concerns: building spawn arguments, detecting readiness, handling dialogs, and detecting ongoing status. All adapters strip ANSI escape codes before applying regex patterns.

```typescript
interface CliAdapter {
  name: string            // adapter id
  cliCommand: string      // binary name
  instructionFile: string // where agent instructions land in the workspace
  submitKeys: string[]    // tmux key sequence to submit a message

  spawnArgs(opts: SpawnOpts): string[]
  detectReady(pane: string): 'loading' | 'dialog' | 'ready'
  handleDialog(pane: string): string[] | null
  detectStatus(pane: string): 'running' | 'idle' | 'error' | 'rate-limited' | 'unknown'
}
```

---

## claude-code

**Binary:** `claude`  
**Instruction file:** `CLAUDE.md`  
**Submit keys:** `['Enter']`

### Spawn args

```
claude --dangerously-skip-permissions [--model <model>]
```

`--dangerously-skip-permissions` lets the agent act without asking permission per tool use, which is required for unattended operation.

### Ready detection

Scans the full pane after stripping ANSI. Two conditions must both be true:

1. **Prompt visible** — a line that is exactly `>` or `❯` (with optional surrounding whitespace): `/^\s*[>❯]\s*$/`
2. **Status bar present** — anywhere in the pane: `/bypass permissions/i` or `/Claude Code/i`

Ready check runs before dialog check so that informational text that matches dialog patterns doesn't block startup once the prompt is live.

If neither condition holds, the adapter checks the **last 15 lines only** for dialogs:
- `/bypass.?permissions/i` + `/Yes, I accept/i` → `'dialog'`
- `/trust this folder/i` or `/Do you trust the files/i` → `'dialog'`

Otherwise → `'loading'`

### Dialog handling

| Pattern | Keys sent |
|---------|-----------|
| Bypass permissions dialog (`bypass.?permissions` + `Yes, I accept`) | `['2', 'Enter']` — selects option 2 "Yes, I accept" |
| Workspace trust dialog (`trust this folder` or `Do you trust the files`) | `['Enter']` — accepts default |

### Status detection (controller poller)

Claude Code uses **spinner icon delta** detection, not text pattern matching. This runs only inside the controller poller (`src/controller/poller.ts`), which has inter-poll memory.

The spinner cycles through these Unicode characters at roughly 1 Hz while generating:

```
· (U+00B7)  ∗ (U+2217)  ✢ (U+2722)  ✳ (U+2733)  ✶ (U+2736)  ✻ (U+273B)  ✽ (U+273D)
```

The poller uses `extractSpinnerIcon()` which greps for the **last** occurrence of any of these on a line start (`/^[these chars]/gm`), to avoid stale "Cooked for" display lines confusing the delta.

Logic:
- Icon **changed** since last poll → `'running'`, reset stable count
- Icon **same** for N consecutive polls → `'idle'` only after `ICON_IDLE_THRESHOLD = 3` polls (3 seconds)
- **No icon** → `'idle'`
- `/rate.?limit|hit your limit/i` in last 2 lines → `'rate-limited'` (checked first)

The `detectStatus()` method on the adapter object itself (used outside the poller) falls back to checking for a timer pattern `/\((?:\d+m\s+)?\d+s[\s·)]/` to guess `running`, otherwise returns `'unknown'`.

---

## codex

**Binary:** `codex`  
**Instruction file:** `AGENTS.md`  
**Submit keys:** `['Enter']`

### Spawn args

```
codex --dangerously-bypass-approvals-and-sandbox [--model <model>]
```

`--dangerously-bypass-approvals-and-sandbox` disables approval prompts and the sandbox, required for unattended operation.

### Ready detection

Checks full pane after ANSI strip:

1. **Prompt visible** — a line matching `/^\s*[❯›]\s+\S/` (prompt with text after it) or `/^\s*[❯›]\s*$/` (empty prompt)
2. **Status bar present** — `/\d+%\s+left/i` (budget display) or `/model:/i`

If both → `'ready'` (skips dialog check even if update banners are present).

Dialog check (only when prompt is **not** visible):
- `/Press enter to continue/i` → `'dialog'`
- `/›\s+\d+\./m` (numbered menu, no prompt) → `'dialog'`

Otherwise → `'loading'`

### Dialog handling

Checks last 20 lines:

| Pattern | Keys sent |
|---------|-----------|
| `/Update available/i` | `['Down', 'Enter']` — skips to option 2 (skip update) |
| `/Press enter/i` | `['Enter']` |
| `/›\s+\d+\./m` (numbered menu) | `['Enter']` — accepts default |

### Status detection

Checks last 5 lines:

| Pattern | Status |
|---------|--------|
| `/esc to interrupt/i` | `'running'` |
| `/background terminal running/i` | `'running'` |
| Empty prompt (`/^\s*[❯›]\s*$/`) in last 5 | `'idle'` |
| `/\d+%\s+left/i` without `/working/i` | `'idle'` |
| (none) | `'unknown'` |

Note: codex typically takes 60–90 seconds to start. The readiness timeout (60s) will warn but not fail — the controller continues and the agent is registered once polling detects it later.

---

## gemini

**Binary:** `gemini`  
**Instruction file:** `GEMINI.md`  
**Submit keys:** `['Enter']`

### Spawn args

```
gemini [--model <model>]
```

No permission flags needed — Gemini CLI uses its own dialog system handled by `handleDialog`.

### Ready detection

Checks last 20 lines (non-empty, trimmed):

- `/Type your message/i` or `/[>❯]\s*$/` → `'ready'`
- Otherwise → `'loading'`

No dialog states at ready-detection time (dialogs are handled in the status poller).

### Dialog handling

Full pane check:

| Pattern | Keys sent |
|---------|-----------|
| `/Action Required/i` + `/Allow/i` | `['Down', 'Enter']` — selects "Allow for this session" |

### Status detection

Checks last 20/10 lines:

| Pattern | Status |
|---------|--------|
| `/Action Required/i` + `/Allow/i` (last 20) | `'dialog'` (treated as running — auto-approved by poller) |
| `/rate.?limit\|quota.?exceeded\|resource.?exhausted/i` (last 10) | `'rate-limited'` |
| `/error/i` + `/fatal\|crash/i` (last 10) | `'error'` |
| Braille spinners `[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⊶⊷]` (last 10) | `'running'` |
| `/Thinking\.\.\./i` (last 10) | `'running'` |
| `/Ready/i` or `/Type your message/i` (last 10) | `'idle'` |
| `[✓✔]` without spinners (last 10) | `'idle'` |
| (none) | `'unknown'` |

---

## aider

**Binary:** `aider`  
**Instruction file:** `.flt-instructions.md`  
**Submit keys:** `['Enter']`

### Spawn args

```
aider --yes --read .flt-instructions.md [--model <model>]
```

`--yes` auto-confirms aider's "add files to chat?" prompts. `--read` injects the flt system block without adding it to the editable file list.

### Ready detection

Checks last 20 lines:

- `/^>\s*$/m` (bare `>` prompt) or `/aider>/i` → `'ready'`
- Otherwise → `'loading'`

### Dialog handling

None — returns `null`. Aider's `--yes` flag handles file-add prompts.

### Status detection

Checks last 5 lines:

| Pattern | Status |
|---------|--------|
| `/Waiting for/i` or `/[░█]{2,}/` (block spinner) | `'running'` |
| `/Thinking\|Editing\|Applying/i` | `'running'` |
| `/^\s*(?:\w+\s+)?>\s*$/m` (prompt variants: `>`, `patch>`, `multi>`) | `'idle'` |
| (none) | `'unknown'` |

---

## opencode

**Binary:** `opencode`  
**Instruction file:** `.opencode/agents/flt.md`  
**Submit keys:** `['Enter']`

### Spawn args

```
opencode [--model <model>]
```

No permission flags — OpenCode doesn't have a sandbox bypass flag.

### Ready detection

Scans the **full pane** (not just last N lines, because "Ask anything" and the version string can be 30+ lines apart in a tall terminal):

- `/Ask anything/i` anywhere in pane + `/\d+\.\d+\.\d+/` in last 5 lines → `'ready'`
- Otherwise → `'loading'`

### Dialog handling

None — returns `null`.

### Status detection

Checks last 10 lines for running/error/rate-limited, full pane for idle:

| Pattern | Status |
|---------|--------|
| `/rate.?limit\|try again later/i` (last 10) | `'rate-limited'` |
| `/error/i` + `/fatal\|crash/i` (last 10) | `'error'` |
| Braille spinners `[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]` (last 10) | `'running'` |
| `/thinking\|running/i` (last 10) | `'running'` |
| `/Ask anything/i` in full pane (without spinners) | `'idle'` |
| (none) | `'unknown'` |

---

## swe-agent

**Binary:** `mini` (mini-swe-agent)  
**Instruction file:** *(none — uses prompt injection)*  
**Submit keys:** `['Escape', 'Enter']`

### Spawn args

```
mini -y [--model <model>]
```

`-y` auto-confirms. Two-key submit (`Escape` then `Enter`) is required by mini-swe-agent's TUI.

### Ready detection

Checks last 20 lines:

- `/What do you want to do/i` → `'ready'`
- Otherwise → `'loading'`

### Dialog handling

None — returns `null`.

### Status detection

Checks last 10 lines:

| Pattern | Status |
|---------|--------|
| `/rate.?limit\|quota/i` | `'rate-limited'` |
| `/error/i` + `/fatal\|crash/i` | `'error'` |
| `/What do you want to do/i` | `'idle'` |
| (none) | `'unknown'` |

---

## Universal fallback: content-delta

For CLIs where `detectStatus()` returns `'unknown'`, the controller poller applies a content-delta check:

1. Compute `simpleHash(pane)` each poll
2. If hash **changed** from last poll → `'running'`, reset stable timer
3. If hash **stable** for ≥ `CONTENT_IDLE_GRACE_MS = 5000ms` → `'idle'`
4. If user is typing into this agent (detected via `~/.flt/typing` file) → hold current status

On top of this, a global **content-stable timeout** (`CONTENT_STABLE_TIMEOUT_MS = 60_000ms`) forces any `running` or `unknown` status to `idle` if the pane content hasn't changed for 60 seconds. This catches agents that get stuck without producing any adapter-specific idle marker.
