# Spec: TUI Workflow Modal (Track D)

## Summary

Add a read-only TUI modal triggered by `w` in normal mode that displays current and past workflow runs with per-row drilldown.

---

## Deliverables

| File | Purpose |
|------|---------|
| `src/metrics-workflows.ts` | Pure aggregator: list, filter, format workflow runs |
| `src/tui/modal-workflows.ts` | TUI rendering for the workflow modal |
| `src/tui/keybinds.ts` | Add `w: 'openWorkflows'` to normal-mode defaults |
| `src/tui/app.ts` | Wire `openWorkflows` binding → modal open method |
| `tests/unit/metrics-workflows.test.ts` | Unit tests for the aggregator |

---

## Data Sources

- `listWorkflowRuns()` from `src/workflow/engine.ts` returns all `WorkflowRun[]` from `~/.flt/runs/*/run.json`.
- Active runs: `.filter(r => r.status === 'running')`
- Past runs: `.filter(r => r.status !== 'running')`
- Step history: `run.history: WorkflowStepResult[]` (each entry: `step`, `result`, `at`, `agent?`)

---

## Aggregator: `src/metrics-workflows.ts`

```typescript
export type WorkflowFilter = 'all' | 'running' | 'completed' | 'failed'

export interface WorkflowRow {
  id: string
  workflow: string
  currentStep: string
  status: WorkflowRun['status']
  startedAt: string          // ISO → formatted "HH:MM:SS" or relative
  parentName: string
}

export interface WorkflowStepRow {
  name: string
  agent: string | undefined
  status: 'completed' | 'failed' | 'skipped'
  at: string
  duration: string           // diff from previous step or run start
}

export function listWorkflows(filter: WorkflowFilter): WorkflowRow[]
export function getWorkflowHistory(id: string): WorkflowStepRow[]
export function formatDuration(ms: number): string  // "1m 32s", "45s"
```

`listWorkflows` calls `listWorkflowRuns()`, applies filter, sorts by `startedAt` descending.  
`getWorkflowHistory` finds the run by id, maps `run.history` into `WorkflowStepRow[]`.

---

## TUI Modal: `src/tui/modal-workflows.ts`

### Layout

```
┌─ Workflows ──────────────────────────────────────────────────┐
│ ● RUNNING                                                    │
│   abc123  spec       2026-04-26 14:01  parent: tim           │
│   def456  coder      2026-04-26 13:55  parent: tim           │
│                                                              │
│ ─ PAST ───────────────────────────────────────────────────── │
│   ghi789  completed  2026-04-26 13:40  parent: tim           │
│   jkl012  failed     2026-04-26 12:10  parent: tim           │
│                                                              │
│ [a] all  [r] running  [c] completed  [f] failed     ESC close│
└──────────────────────────────────────────────────────────────┘
```

Drilldown (Enter on a row):
```
┌─ Workflows › abc123 ─────────────────────────────────────────┐
│   spec     sonnet   pass   14:01:02   0m 45s                 │
│   coder    sonnet   fail   14:01:48   0m 30s                 │
│                                                              │
│                                           ESC back           │
└──────────────────────────────────────────────────────────────┘
```

### State

```typescript
export interface WorkflowModalState {
  filter: WorkflowFilter
  rows: WorkflowRow[]
  selectedIndex: number
  drilldown: WorkflowStepRow[] | null  // null = list view, set = detail view
  drilldownId: string | null
}
```

### Key Handlers (normal mode, modal open)

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate rows |
| `Enter` | Open drilldown for selected row |
| `ESC` | Close drilldown → list; or close modal |
| `a` | Filter: all |
| `r` | Filter: running |
| `c` | Filter: completed |
| `f` | Filter: failed |

### Rendering

Export `renderWorkflowModal(state: WorkflowModalState, screen: Screen): void`.  
Uses `screen.drawBox(...)` with `'round'` border, matching existing modal conventions in `panels.ts`.  
Running section header uses accent color; past section uses dim. Selected row is inverted.

---

## Keybinding

In `src/tui/keybinds.ts`, add to `DEFAULT_KEYBINDS.normal`:
```
w: 'openWorkflows'
```

Add `'openWorkflows'` to the `KeybindAction` union type.

In `src/tui/app.ts`, add handler:
```typescript
openWorkflows: () => this.openWorkflowsModal()
```

`openWorkflowsModal()` sets app mode to `'workflows'`, initializes `WorkflowModalState` with filter `'all'`, loads rows.

---

## Tests: `tests/unit/metrics-workflows.test.ts`

- `listWorkflows('all')` returns all runs sorted newest-first
- `listWorkflows('running')` excludes non-running
- `listWorkflows('completed')` / `'failed'` filter correctly
- `getWorkflowHistory(id)` maps history entries, computes step durations
- `formatDuration` handles sub-minute and multi-minute values
- Empty runs dir returns `[]`

---

## Out of Scope

- Mutation (cancel/retry from modal) — read-only display only
- Real-time auto-refresh — data loaded on modal open
- Pagination beyond scroll — standard TUI scroll sufficient

---

## Human Gate

Blocking on TUI taste: layout of running/past split, drilldown UX, key cycle (`a/r/c/f`) confirmation before implementation.
