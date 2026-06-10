# flt

flt is a multi-CLI agent orchestrator: it makes Claude Code, Codex, Gemini CLI, OpenCode, SWE-agent, and ~7 other AI coding CLIs feel like one tool. A single controller daemon manages tmux-hosted agents across CLIs, normalizes per-CLI quirks behind a `CliAdapter` interface, and routes messaging, status, worktrees, presets, and YAML workflows through one Unix-socket RPC.

## The soul of the project: primitives, not a monolith

flt is a **set of primitives a user can compose however they want.** `spawn`, `kill`, `send`, `list`, `logs` are the primitives. Everything else — presets, workflows, the dynamic DAG, parallel candidates with treatment matrices, the TUI itself — is a composition over those primitives. When designing a new feature, ask first: "is this just a new way to compose spawn/send/kill?" If yes, build it as a composition (a YAML workflow step, a preset field, a TUI command). Only carve out a new primitive when no composition can express it. This is the lens for every non-trivial change here.

## Architecture

- **Single-writer controller.** A daemon (`src/controller/server.ts`) is the only writer to `~/.flt/state.json`. Every CLI command (`flt spawn`, `flt send`, …) and the TUI talk to it over a Unix socket at `~/.flt/controller.sock`. The TUI is a pure reader; closing/reopening it never affects running agents.
- **tmux as the agent host.** Each agent runs in its own detached tmux session. `src/tmux.ts` wraps `new-session`, `pipe-pane` logging, key delivery, and pane capture. ANSI output from agents is captured raw and re-parsed in the TUI.
- **Worktree-per-agent isolation.** `src/worktree.ts` creates a `flt/<name>` branch and worktree under `tmpdir()` so concurrent agents don't trample each other's git state. `--no-worktree` opts out.
- **Per-CLI adapters.** `src/adapters/` defines `CliAdapter` (spawn args, instruction filename, ready-state detection, dialog auto-approval, status detection). Most adapters delegate to `@twaldin/harness-ts` for shared detection logic; flt adds the spawn/lifecycle/dialog-bypass on top.
- **Status by polling pane content.** No agent SDKs are wired up. `src/controller/poller.ts` runs `tmux capture-pane`, feeds the buffer to `adapter.detectStatus`, and writes status transitions back to state. Workflow advancement, ephemeral cleanup, and TUI status colors all hang off this single transition signal.
- **Instructions are projected, not owned.** `src/instructions.ts` (delegating to `@twaldin/harness-ts`) prepends an `` block to the project's native instruction file (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, etc.) and restores the original on kill. flt never owns the file outside its markers.

## Repo map

```
src/
  cli.ts                    Commander entrypoint; routes subcommands
  state.ts                  ~/.flt/state.json reader/writer (single-writer rule)
  tmux.ts                   tmux session lifecycle + key delivery
  worktree.ts               git worktree creation under tmpdir()
  instructions.ts           project instruction file projection (flt:start/end)
  presets.ts                preset CRUD (~/.flt/presets.json)
  skills.ts                 skill discovery + projection per CLI
  harness.ts                @twaldin/harness-ts wrapper bits
  delivery.ts               key/text delivery to a pane (paste vs send-keys)
  detect.ts                 caller-context detection (which agent invoked us)
  gates.ts                  human_gate scan/cleanup (workflow gates surface in TUI)
  qna.ts                    flt ask oracle / Q&A inbox
  remotes.ts ssh.ts         SSH-remote spawn target alias support
  redact.ts                 secret redaction in logs
  metrics.ts                token/cost rollups
  model-resolution.ts       resolve `opus`/`sonnet`/`haiku` etc. per CLI
  activity.ts               JSONL event stream (~/.flt/activity.log)
  routing/resolver.ts       message target resolution (parent/agent/role)

  adapters/                 per-CLI adapters — see src/adapters/CLAUDE.md
  commands/                 one file per `flt <cmd>` (init/spawn/send/kill/…)
  controller/               daemon: server.ts + client.ts + poller.ts
  workflow/                 YAML workflow engine — see src/workflow/CLAUDE.md
  tui/                      raw-ANSI TUI — see src/tui/CLAUDE.md
  pr-adapters/              gh / gt / manual PR creation backends
  hooks/                    git hook installers
  types/                    ambient module declarations (e.g. harness-ts.d.ts)
  utils/                    stripAnsi etc.

templates/                  instruction-file templates (system-block-*.md, workflow-block.md)
docs/                       design docs (droid-oauth-proxy.md, ssh-sandbox-design.md)
demo/                       demo gif assets and scripts
examples/                   example workflows + presets
scripts/                    release + smoke-test scripts
tests/
  unit/                     bun test — pure functions, parsers
  integration/              bun test — end-to-end flows (real tmux/git)
  adapters/                 adapter behavior fixtures
  eval/                     evaluation harness for workflow runs
  fixtures/                 shared test data
```

## Conventions

- **Bun-only.** Runtime is Bun (≥1.0.0). Tests use `bun test`. Don't introduce node-only APIs without checking; many `Bun.*` calls (`Bun.spawn`, `Bun.file`, fetch-over-unix-socket) appear by design.
- **TypeScript with no `any` casts.** No `as any` / `as unknown as` shortcuts. Add narrow types or fix the source type.
- **One command per file in `src/commands/`.** Each file exports a `<cmd>Direct(...)` function (callable in-process by tests and the controller) and a thin Commander wrapper in `cli.ts`. Don't fold multiple subcommands into one file.
- **One adapter per file in `src/adapters/`** following the `CliAdapter` interface (`src/adapters/types.ts`). Register the new adapter in `src/adapters/registry.ts` and add it to the `Record<string, CliAdapter>` map. See `src/adapters/CLAUDE.md`.
- **Workflow steps are typed by `type` field.** New step kinds add a discriminated union member in `src/workflow/types.ts` and a handler in `src/workflow/engine.ts`. See `src/workflow/CLAUDE.md`.
- **`flt:start`/`flt:end` markers are sacred.** Anything inside is regenerated on spawn and cleaned on kill. Never hand-edit content between those markers — edit the templates in `templates/` or the projection logic in `src/instructions.ts` instead.
- **Filenames for instructions: CLAUDE.md is canonical, AGENTS.md is a symlink.** Where a CLAUDE.md exists in this repo, an `AGENTS.md` symlink points to it so OpenCode/Codex/etc. pick up the same content. Don't divergently edit AGENTS.md.

## Gotchas

- **Adapter parity isn't perfect.** Each CLI has its own dialog phrasing, ready signal, and submit-key sequence. When you add behavior, exercise it on at least claude-code + codex + opencode; they cover the three main quirks (multi-line paste, slow startup, custom instruction file).
- **Aider was removed** from the registry — it's REPL-driven (`/run`, `/add`, `/edit`) with no autonomous shell tool, so it doesn't fit the autonomous-agent-with-tools model. The README still mentions it; don't re-add an aider adapter without revisiting that decision.
- **OpenCode uses a custom agent file** (`.opencode/agents/flt.md`), not the project's `AGENTS.md`. See `src/adapters/opencode.ts`.
- **Status polling, not push.** A change in the running agent's pane is observed at most ~1s late. Tests that race against status transitions need to wait, not assume.
- **`flt kill` nukes the worktree.** If you used the helper worktree to stash diffs, capture them before kill.
- **Workflow advancement fires on `running → idle`.** Steps that exit before going idle (instant errors, refusals to start) won't trigger `advanceWorkflow`. Add an explicit failure path if you introduce a new such case.
- **TUI is a separate process from the controller.** `flt controller stop && flt controller start` does NOT restart the TUI — the TUI process loaded `panels.ts` and other rendering code ONCE at launch and keeps using that snapshot. After syncing source changes into the install directory (or merging a fix that touches sidebar/render code), you have to quit the TUI (`q` or kill the `flt tui` process) AND restart it for the change to take effect. The controller restart only matters for spawn/kill/poller logic, not for what's painted on screen.
- **Two install paths exist for `flt`.** The `flt` binary on `$PATH` is typically `~/.bun/bin/flt`, which symlinks to `~/.bun/install/global/node_modules/@twaldin/flt-cli/src/cli.ts`. There is ALSO an `~/.nvm/versions/node/<v>/lib/node_modules/@twaldin/flt-cli/` install if `npm i -g` was used at any point. When syncing local source changes into the install directory for testing, copy into BOTH paths (or at least the one that backs `$(readlink "$(which flt)")`) — copying to only one means the running TUI/controller might still be on the stale code. `md5 ~/flt/src/foo.ts <each-install-path>/src/foo.ts` is the quickest verifier.

## Working in this repo

- Tests: `bun test`, `bun test:unit`, `bun test:integration`, or `bun test <path>` for one file.
- Local CLI run: `bun src/cli.ts <cmd>` (the `flt` bin in `package.json` points at the same).
- Don't `git add -A` blindly — untracked session artifacts (`AUDIT.md`, `HANDOFF.md`, `tree.md`, `plan.json`, `handoffs/`, etc.) live at the root and are gitignored; only `AGENTS.md` is a symlink (→ CLAUDE.md).
- For a feature that touches adapter behavior, read the corresponding `harness-ts` adapter first; many fields are inherited and shouldn't be overridden in flt.
