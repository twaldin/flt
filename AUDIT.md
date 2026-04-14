# flt Public-Facing Audit

Audited: 2026-04-14  
Package: `@twaldin/flt-cli@0.1.1` (npm)  
Repo: `github.com/twaldin/flt`  
Tests: `bun test` — **182 pass, 0 fail**

---

## FAIL — Must fix before launch

### 1. Hardcoded `/Users/twaldin/` path in published source (`src/commands/cron.ts:81`)

```typescript
const pathVal = opts.binPath ?? '/Users/twaldin/.bun/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'
```

When any other user reads the shipped source (or calls `generateScript` without passing `binPath`), they see your home directory hardcoded. In practice the CLI path (`flt cron add`) correctly passes `process.env.PATH` (line 304), so runtime behavior is fine — but the fallback is your personal path and it ships in the package. Any user who inspects the source, hits an edge case, or uses `generateScript` directly gets a broken PATH. Must change to a reasonable system default (e.g. `process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin'`).

### 2. `flt --version` reports `0.1.0`, package is `0.1.1` (`src/cli.ts:19`)

```typescript
.version('0.1.0')   // hardcoded — doesn't track package.json
```

`flt --version` prints `0.1.0`. The published package is `0.1.1`. The version string is stale. Should read from package.json (e.g. `import pkg from '../package.json'` or `Bun.file('../package.json')`), or at minimum be kept in sync manually.

---

## WARN — Should fix before launch

### 3. Internal spec docs ship in the npm package

`package.json` `files` includes `docs/`, so these three internal planning documents are published to npm:

- `docs/tui-v2-spec.md` — implementation design doc for the raw ANSI rewrite
- `docs/v0.3-spec.md` — feature spec for presets/TUI phases
- `docs/v1-spec.md` — future roadmap / v1 design proposals

These are development artifacts, not user documentation. They make the package look unfinished, expose the internal roadmap, and add 28 kB to the published tarball. The user-facing docs (`adapters.md`, `architecture.md`, `workflows.md`) are genuinely useful and should stay. The spec files should be excluded via `.npmignore` or by narrowing the `files` glob.

### 4. README keybindings table is incomplete

`Shift-Enter` (toggle subtree collapse) is implemented (`keybinds.ts:217`, `input.ts:438`) but absent from the README's keybinding table. The architecture doc mentions it; the README doesn't. A first-time user reading the README has no way to discover this feature.

### 5. Empty integration test directory

`tests/integration/` is an empty directory. All 182 tests are unit tests. For a tool that orchestrates tmux sessions, spawns agents, and routes messages through a Unix socket, the absence of integration tests is a real gap. Not a blocker, but worth noting for contributors who expect to find coverage there.

### 6. No `prepublishOnly` script

There is no `prepare` or `prepublishOnly` hook in `package.json`. CI runs `bun test` before publish, but a local `npm publish` skips tests entirely. Low risk (you control the repo), but worth adding for safety.

### 7. README `flt activity` reference omits `--since` flag

The CLI reference section shows:
```
flt activity [-n lines] [--type type]
```

But `--since <iso>` is implemented and documented in `docs/architecture.md`. Minor gap — the flag is just undocumented in the primary user-facing reference.

### 8. Codex adapter model names may confuse users

The adapter table lists `gpt-5.3-codex`, `gpt-5.4`, `o3` as example Codex models. These are currently real but the naming is OpenAI-specific and may not match what users see in their version of `codex`. Not wrong, but consider noting that any model string supported by the installed CLI is valid.

---

## PASS — Looks good

### README
- Accurate and comprehensive. Install instructions, quick start, fleet pattern example, TUI keybindings, CLI reference, spawn flags, adapter table, presets, SOUL.md, skills, orchestrator mode, unattended operation, messaging, themes, workflows, architecture diagram — all present and match implementation.
- The agent hierarchy tree IS implemented (`treeOrder` in `src/tui/panels.ts:86`). The earlier memory note about it being lost was stale.
- No broken links (all links are internal or to github.com/twaldin/flt).
- Install instructions work: `bun install -g @twaldin/flt-cli` with `#!/usr/bin/env bun` shebang is correct for the Bun-native architecture.

### package.json
- Name, description, keywords, homepage, repository, bugs, author, license all present.
- Keywords cover the main use cases: `ai`, `agents`, `tmux`, `orchestration`, `claude`, `codex`, `gemini`, `aider`.
- `engines.bun >= 1.0.0` is set. `os` restricts to `darwin`/`linux` (correct — tmux).
- `bin` field points to `./src/cli.ts` which has `#!/usr/bin/env bun`. Correct.

### LICENSE
- MIT, present, year 2026. Correct.

### .gitignore
- `node_modules/`, `dist/`, `.DS_Store`, `*.log`, `.aider*` all ignored.
- `LAUNCH-RESEARCH.md`, `AGENTS.md`, `GEMINI.md`, `CLAUDE.md` ignored (sensitive/environment-specific).
- `dist/` binaries are not tracked by git and not in `files` — they exist locally but won't ship.

### No secrets or debug logs
- No API keys, passwords, or tokens hardcoded (only the PATH fallback issue noted above).
- All `console.log`/`console.error` in `src/` are legitimate CLI output, not debug instrumentation.
- No `TODO`, `FIXME`, `HACK`, or `XXX` comments in source.

### Tests
- 182 tests, 0 failures, 448 assertions, runs in 78ms.
- Coverage spans: adapters (claude-code, registry, swe-agent), TUI (ANSI parser, ascii, command parser, input, keybinds, screen, themes), unit tests for cron, detect, instructions, poller/watchdog, presets, skills, state.
- CI workflow (`.github/workflows/publish.yml`) runs `bun test` before `npm publish` on tag push.

### Code quality
- TypeScript throughout, no `as any` casts visible.
- Shell injection was addressed (git log: "shell injection fix" in recent publish prep commit).
- `shellQuote()` function in `cron.ts` properly escapes single quotes in shell strings.
- Worktree cleanup, instruction file backup/restore, skill cleanup on kill — lifecycle management is thorough.

### npm package contents (103 kB packed, 370 kB unpacked)
- Source ships TypeScript (Bun executes `.ts` directly — this is correct and intentional).
- Templates, README, LICENSE all included.
- `node_modules/` excluded. `dist/` excluded. `tests/` excluded. `bun.lock` excluded.
- The three spec docs (WARN #3) are the only clutter.

### User experience (first-time install)
- `bun install -g @twaldin/flt-cli` → `flt init` → `flt tui` → `flt spawn` is the documented flow and matches the implementation.
- Prerequisites (Bun, tmux, at least one AI CLI) are clearly stated in the README.
- The `--no-worktree` escape hatch for non-git directories is documented.
- Controller auto-start means users don't need to manage the daemon manually.

---

## Summary

| # | Severity | Issue |
|---|----------|-------|
| 1 | FAIL | `/Users/twaldin/` hardcoded in `src/commands/cron.ts:81` |
| 2 | FAIL | `flt --version` reports `0.1.0`, package is `0.1.1` |
| 3 | WARN | Internal spec docs (`tui-v2-spec.md`, `v0.3-spec.md`, `v1-spec.md`) ship in npm |
| 4 | WARN | `Shift-Enter` (collapse subtree) missing from README keybindings table |
| 5 | WARN | `tests/integration/` is empty — no integration test coverage |
| 6 | WARN | No `prepublishOnly` script for local safety |
| 7 | WARN | `--since` flag undocumented in README activity reference |
| 8 | WARN | Codex example models may be confusing |
