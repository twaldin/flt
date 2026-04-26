# Spec: Track A — TUI Metrics Modal

## Goal

Add a `t`-triggered full-screen modal to the flt TUI that shows per-model/workflow/agent token + cost rollups over selectable time periods, with a 24-hour sparkline and a recent-runs list. Data source: `~/.flt/runs/<name>-<ts>.json` archive files.

---

## Data Source

Archive file shape (confirmed from live files):
```ts
{
  name: string        // agent name
  cli: string
  model: string       // configured model (e.g. "sonnet")
  dir: string
  spawnedAt: string   // ISO timestamp
  killedAt: string    // ISO timestamp
  cost_usd: number
  tokens_in: number
  tokens_out: number
  actualModel: string // resolved model string (e.g. "claude-sonnet-4-6")
}
```

Files that are directories (e.g. `~/.flt/runs/idea-to-pr/`) are skipped; only `*.json` files are read.

---

## A1 — Aggregator (`src/metrics.ts`)

### Public API

```ts
export type Period = 'today' | 'week' | 'month' | 'all'
export type GroupBy = 'model' | 'workflow' | 'agent'

export interface AggRow {
  label: string
  cost: number
  tokensIn: number
  tokensOut: number
  runs: number
  avgCost: number
}

export interface AggResult {
  rows: AggRow[]          // sorted by cost desc
  total: AggRow
  sparkline24h: number[]  // length 24, index 0 = oldest hour, raw cost per bucket
}

export function aggregateRuns(
  archives: ArchiveEntry[],
  opts: { period: Period; groupBy: GroupBy },
): AggResult
```

`ArchiveEntry` mirrors the JSON shape above.

### Grouping

- `model`: group by `actualModel` (fall back to `model` if empty).
- `workflow`: group by extracting workflow name from `name` using the pattern `<workflow>-<step>-<ts>`. Strip the `-<step>-<ts>` suffix. If no match, use `"(unknown)"`.
- `agent`: flat per-name grouping (each `name` is one row). Spawn-tree nesting (A3) is a rendering concern, not an aggregation concern.

### Period filtering

Filter by `spawnedAt` relative to `Date.now()` at call time:
- `today`: same calendar day in local time.
- `week`: last 7 × 24 h.
- `month`: last 30 × 24 h.
- `all`: no filter.

### Sparkline

24 hourly buckets covering the 24 h ending at call time. Each bucket is the sum of `cost_usd` for runs whose `spawnedAt` falls in that hour.

### Unit tests

`tests/unit/metrics-aggregator.test.ts` — pure function tests, no filesystem I/O:
- period filtering (today/week/month/all)
- groupBy model, workflow, agent
- roll-up totals correct
- sparkline bucket assignment
- empty input returns zero-filled result

---

## A2 — Modal (`src/tui/metrics-modal.ts`)

### Mode

Add `'metrics'` to the `Mode` union in `src/tui/types.ts`. Add `MetricsModalState` to `AppState`:

```ts
export type Mode = 'normal' | 'log-focus' | 'insert' | 'command' | 'inbox' | 'presets' | 'kill-confirm' | 'shell' | 'metrics'

export interface MetricsModalState {
  period: Period
  groupBy: GroupBy
  runsListFocused: boolean
  runsScrollOffset: number
}
```

### Trigger key conflict

`t` currently maps to `openShell` in `DEFAULT_KEYBINDS` (`src/tui/keybinds.ts:224`). Reassign:
- `t` → `openMetrics` (new `KeybindAction`)
- Shell moves to `T` (uppercase) in the default normal-mode binds

Update `MODE_ACTION_SET['normal']` and `ACTION_LABELS` accordingly. This is a breaking change to the default shell keybind; document in CONTRIBUTING.md or a CHANGELOG note.

### Layout

Full-screen (overwrite the entire terminal), rendered using the existing `Screen` buffer + damage tracking (`screen.flush()`). Box-drawing with `screen.box()` using `'single'` style.

```
┌─ flt metrics ─────────────────────────[m]odel | [t]ime | [r]uns─┐
│ Period: today                                                    │
│                                                                  │
│  by model           cost      tokens (in/out)   runs   avg cost  │
│  ────────────────  ────────  ─────────────────  ────  ────────── │
│  <label>           $X.XX    XXXk / XXXk           N    $X.XX     │
│  ████░░░░░░░░░░░                                                  │
│  ...                                                              │
│                                                                   │
│  cost over last 24h (1 bar = 1h)                                  │
│  ▁▁▂▂▃▅▇█▇▅▄▃▂▁▁▁▂▂▃▄▆██▆▃                                       │
│                                                                   │
│  recent runs (by cost desc)                                       │
│  ts        agent             model       cost     tokens          │
│  HH:MM     <name>            <model>     $X.XX    Xk/Xk           │
│  ...                                                              │
└───────────────────────────────────────────────────────────────────┘
  ESC close
```

Bar encoding: `▁▂▃▄▅▆▇█` (8 steps). Scale each model bar to terminal width minus column padding. Scale sparkline bars to max bucket value.

Tokens display: values ≥ 1000 rendered as `Xk` (round to 1 decimal if < 10k, else integer k).

### Cycle keys (inside metrics mode)

| Key | Action |
|-----|--------|
| `m` | cycle groupBy: model → workflow → agent → model |
| `t` | cycle period: today → week → month → all → today |
| `r` | toggle runs-list focus (enables j/k scroll) |
| `j` | scroll runs list down (when focused) |
| `k` | scroll runs list up (when focused) |
| `Escape` | close modal, return to `normal` |

Reads archives fresh from disk each time groupBy or period changes (synchronous `fs.readdirSync` + `fs.readFileSync` on `~/.flt/runs/*.json`, skipping non-files).

### Rendering

Implement `renderMetricsModal(screen: Screen, state: MetricsModalState, term: { width: number; height: number })`. Called from `App`'s render loop when `appState.mode === 'metrics'`. Modal occupies full terminal dimensions.

---

## A3 — Spawn-tree grouping (`src/tui/metrics-modal.ts`)

When `groupBy === 'agent'`, render rows as a tree instead of a flat list:
- Read `state.json` files from `~/.flt/runs/<id>/run.json` to resolve `parentName` and `workflow` per agent.
- Build parent → children map. Roots are agents with no `parentName` (or whose parent is not in the run set).
- Render using box-drawing indentation:

```
  workflow-name                $X.XX   (roll-up)
  ├─ step-agent-a              $X.XX
  │  └─ child-agent            $X.XX
  └─ step-agent-b              $X.XX
```

Roll-up totals at each subtree node = sum of all descendants' costs/tokens.

If `run.json` is absent for an archive entry, treat agent as a root with no children.

---

## A4 — Search (stretch, omit if layout is crowded)

`/` in metrics mode opens a one-line search bar at the bottom of the modal. Substring match against `label` (case-insensitive). Filters rows in the active view. `Escape` clears search and exits search sub-mode. Only implement if it fits without crowding the bar/sparkline rows.

---

## Files Touched

| Path | Change |
|------|--------|
| `src/metrics.ts` | new — aggregator |
| `src/tui/types.ts` | add `'metrics'` to `Mode`, add `MetricsModalState` |
| `src/tui/keybinds.ts` | add `openMetrics` action, rebind `t`→openMetrics, `T`→openShell |
| `src/tui/metrics-modal.ts` | new — renderer + input handler |
| `src/tui/app.ts` | wire `openMetrics` key → enter metrics mode; render dispatch |
| `tests/unit/metrics-aggregator.test.ts` | new — unit tests for A1 |

---

## Acceptance Criteria

1. `flt` TUI: pressing `t` in normal mode opens the metrics modal full-screen.
2. `m` cycles groupBy; `t` cycles period; header reflects current values.
3. Cost bars use 8-step `▁▂▃▄▅▆▇█`; max-cost row fills ~50% of inner width.
4. Sparkline shows 24 hourly buckets for cost.
5. Runs list shows recent runs sorted by cost desc; `r`+`j`/`k` scrolls.
6. `Escape` closes modal and returns to normal mode without disrupting the agent list.
7. A1 unit tests pass (`bun test tests/unit/metrics-aggregator.test.ts`).
8. Shell still accessible via `T` after the keybind move.
9. Modal renders cleanly at 80×24 and 220×50 terminal sizes.
10. No React/Ink dependency introduced.

---

## Hypothesis note

Track A is expected to require human approval at `human_gate` — the modal layout (bar widths, color choices, info density) requires visual inspection that an evaluator cannot machine-check.
