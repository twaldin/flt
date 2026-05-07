# src/adapters/

Per-CLI adapters. One file per CLI; each exports a `<name>Adapter: CliAdapter`. The registry in `registry.ts` maps adapter name → adapter object and is the single source of truth for which CLIs flt supports.

## The CliAdapter interface

Defined in `types.ts`:

```ts
interface CliAdapter {
  name: string                // adapter id used by `--cli` flag, e.g. "claude-code"
  cliCommand: string          // actual binary, e.g. "claude"
  instructionFile: string     // where flt projects instructions, e.g. "CLAUDE.md"
  submitKeys: string[]        // tmux key sequence to submit input, e.g. ["Enter"]
  flattenOnPaste?: boolean    // collapse \n to spaces before paste (opencode quirk)

  spawnArgs(opts): string[]              // CLI argv built from {model, dir}
  detectReady(pane): ReadyState          // 'loading' | 'dialog' | 'ready'
  handleDialog(pane): string[] | null    // keys to dismiss a permission dialog, or null
  detectStatus(pane): AgentStatus        // 'running' | 'idle' | 'error' | 'rate-limited' | 'unknown' | 'exited'
  env?(): Record<string, string>         // extra env vars (API keys, base URLs)
}
```

The controller's poller calls `detectStatus(pane)` once per second; spawn calls `detectReady` until it returns `'ready'`, dismissing dialogs along the way via `handleDialog`. `submitKeys` and `flattenOnPaste` drive `src/delivery.ts` when sending text into a pane.

## The harness-ts delegation pattern

Most adapters are thin shells over `@twaldin/harness-ts`:

```ts
const harness = getHarnessAdapter('codex')
export const codexAdapter: CliAdapter = {
  name: 'codex',
  cliCommand: 'codex',
  instructionFile: harness.instructionsFilename,
  submitKeys: harness.submitKeys ?? ['Enter'],
  spawnArgs: (opts) => [...],            // flt-specific: dialog-bypass flags
  detectReady:  (p) => harness.detectReady?.(p)  ?? 'loading',
  handleDialog: (p) => harness.handleDialog?.(p) ?? null,
  detectStatus: (p) => (harness.detectStatus?.(p) ?? 'unknown') as AgentStatus,
}
```

When changing detection behavior, **fix it in `harness-ts` first** — flt and the harness sister project share these regexes. The adapters here only override what flt does differently (typically `spawnArgs` for permission/sandbox bypass and `env` for OAuth proxy wiring).

## Conventions

- **Spawn flags bypass dialogs.** Each `spawnArgs` adds the CLI's "I authorize automation" flag (`--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`, `--yolo`, etc.). This is what makes cron-driven unattended agents work; don't drop it.
- **Don't store adapter state.** Adapters are singletons exported as `const`. State (status, last-detected-dialog) lives on the agent record in `state.ts`, not on the adapter.
- **Custom instruction files are allowed but rare.** OpenCode points `instructionFile` at `.opencode/agents/flt.md` because OpenCode auto-loads project `AGENTS.md` and we want a flt-specific agent file. Most adapters use `harness.instructionsFilename`.
- **Env vars belong in `env()`.** OAuth proxy URLs, API keys read from dotenv, base-URL overrides — return them from the optional `env()` method so spawn can pass them via tmux `-e`. Don't read process env in `spawnArgs`.
- **Submit-key quirks matter.** Some CLIs need `["Escape", "Enter"]`, some treat newlines in pastes as submit. Get this from the harness adapter; if you must override, comment why.

## Adding a new adapter

1. Confirm the CLI has an autonomous shell tool (not REPL-only). aider was removed for failing this test.
2. Add (or reuse) a harness-ts adapter for shared detection.
3. Create `src/adapters/<name>.ts` exporting `<name>Adapter: CliAdapter`.
4. Register it in `registry.ts` (import + add to the `adapters` map).
5. Add fixtures under `tests/adapters/` covering ready detection, dialog auto-approval, idle/running transitions.
6. Update `docs/adapters.md` (end-user table) and any README adapter listing.

## Currently registered

`claude-code`, `codex`, `gemini`, `opencode`, `swe-agent`, `pi`, `continue-cli`, `crush`, `droid`, `openclaude`, `qwen`, `kilo`. See `registry.ts` for the canonical list.
