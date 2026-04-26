# Spec: Track A — TUI Metrics Modal (P3-A1..A4)

## Goal

Ship a full-screen TUI modal (`t` key) showing per-model + per-period token/cost rollups, a 24h sparkline, and a recent-runs list. Grouped-by-agent view renders the workflow → agent → child-agent spawn tree with roll-up totals.

---

## A1 — Aggregator (pure functions)

**File**: `src/metrics/aggregator.ts`

**Input**: flat archive files at `~/.flt/runs/<name>-<ts>.json`. Shape per file:

```ts
{ name, cli, model, actualModel, dir, spawnedAt, killedAt,
  cost_usd, tokens_in, tokens_out }
```

**Output**:

```ts
interface AggregateResult {
  rows: Array<{
    label: string;          // model name, workflow name, or agent name
    cost: number;           // USD
    tokensIn: number;
    tokensOut: number;
    runs: number;
    avgCost: number;
  }>;
  total: { cost: number; tokensIn: number; tokensOut: number; runs: number };
  sparkline24h: number[];   // length 24, values are cost_usd per hour bucket
}
```

**API**:

```ts
function aggregateRuns(
  archives: RunArchive[],
  opts: { period: 'today' | 'week' | 'month' | 'all'; groupBy: 'model' | 'workflow' | 'agent' }
): AggregateResult
```

- Filter archives by `spawnedAt` falling in the period window (UTC day boundary for `today`; rolling 7d/30d for week/month).
- Group by `actualModel ?? model`, `workflow` field (from state.json agent record), or agent `name`.
- `sparkline24h` is always the last 24 h regardless of period, bucketed by `Math.floor((now - spawnedAt) / 3_600_000)`.
- Pure: no FS I/O, no side effects. Unit-testable with fixture arrays.

**Tests**: `tests/unit/metrics/aggregator.test.ts` — cover empty input, period filtering, groupBy modes, sparkline bucket alignment.

---

## A2 — Modal rendering + key bindings

**Files**: `src/tui/metrics-modal.ts`, wired into `src/tui/tui.ts`.

**Trigger**: `t` key in the main TUI loop opens the modal full-screen. ESC closes.

**Layout** (raw ANSI, no Ink/React — matches existing TUI renderer):

```
┌─ flt metrics ──────────────────────────[m]odel | [t]ime | [r]uns─┐
│ Period: today | week | month | all                               │
│                                                                  │
│  by model         cost     tokens (in/out)   runs   avg cost    │
│  ───────────────  ───────  ───────────────   ────   ─────────   │
│  <label>         $X.XX    XXXk / XXXk         N     $X.XX       │
│  ████████████████████                                            │
│  ...                                                             │
│                                                                  │
│  cost over last 24h (1 bar = 1h)                                 │
│  ▁▂▃▄▅▆▇█ (24 chars, 8-step ASCII)                               │
│                                                                  │
│  recent runs (by cost desc)                                      │
│  ts       agent             model       cost     tokens          │
│  HH:MM    <name>            <model>     $X.XX    XX/XXX          │
│  ...                                                             │
└──────────────────────────────────────────────────────────────────┘
```

**Cycle keys** (active only while modal is open):
- `m` — cycles groupBy: `model` → `workflow` → `agent` → `model`
- `t` — cycles period: `today` → `week` → `month` → `all` → `today`
- `r` — moves focus to runs list; `j`/`k` scrolls; any other key returns focus to table

**Bar rendering**: proportional to max-row cost; 8-step chars `▁▂▃▄▅▆▇█`; full-block `█` for max row.

**Damage tracking**: modal redraws on state change (key press or period tick). Reuse existing `writeAt(row, col, str)` + `clearScreen()` primitives from `src/tui/screen.ts`.

---

## A3 — Spawn-tree grouping

Activated when `groupBy === 'agent'`.

**Data source**: `~/.flt/state.json` agents map supplies `parentName` and `workflow` fields alongside the archive cost/token data.

**Tree structure**:

```
workflow-run-name          $X.XX  (roll-up)
├─ child-agent-a           $X.XX
│  └─ grandchild-agent     $X.XX
└─ child-agent-b           $X.XX
```

Box-drawing chars: `├─`, `└─`, `│ ` for indentation. Root nodes = agents with no `parentName` or whose `parentName` is not in the current period's archive set.

**Roll-up**: each tree node's displayed cost/tokens = sum of its own archives + all descendants. Runs count = leaf runs only (avoid double-counting). `avgCost = totalCost / totalRuns`.

**Render**: flatten tree to ordered row list with an `indent: number` field; renderer prepends the appropriate box-drawing prefix per indent level.

---

## A4 — Search (stretch)

Only implement if the layout remains clean with the search bar added.

`/` enters search mode: renders a one-line input at the bottom of the modal. Backspace edits; Enter confirms; ESC cancels (clears filter, stays in modal).

Filter: substring match (case-insensitive) against `label` (agent name, model, or workflow). Sparkline and total row are always shown unfiltered; only the breakdown table rows are filtered.

---

## Implementation constraints

- **No React/Ink** — raw ANSI only, consistent with existing TUI.
- **8-step bars only** — `▁▂▃▄▅▆▇█`. No braille.
- **Read archive files once per modal open** — no live-reload inside modal; re-read on next open.
- `aggregateRuns` must be unit-tested before the modal is wired (TDD order: A1 tests → A1 impl → A2 → A3 → A4).
- `actualModel` takes precedence over `model` for groupBy-model display (reflects the model that actually ran).

## Out of scope

Track B (GEPA data plumbing) is a separate track and separate PR.
