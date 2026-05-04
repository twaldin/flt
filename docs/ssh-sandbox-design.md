# `--ssh` and `--sandbox` Design

Status: design locked 2026-05-04, awaiting implementation.

flt currently spawns agents as local tmux sessions (`flt-<name>`) in worktrees on the host filesystem, with parent→child IPC via `tmux send-keys`. This document specifies two new orthogonal capabilities — running agents on remote hosts via SSH (`--ssh`) and running them inside containers (`--sandbox`) — that compose with each other and with all existing flt CLI surface.

## Orthogonality

`--ssh` and `--sandbox` are independent, composable flags. Any of: local-bare, local-sandbox, remote-bare, remote-sandbox.

| Flags | Where agent runs | Worktree lives on |
|---|---|---|
| (neither) | host tmux | host FS |
| `--sandbox` | container on host, tmux inside | host FS, bind-mounted into container |
| `--ssh <host>` | tmux on remote host | remote FS |
| `--ssh <host> --sandbox` | container on remote host, tmux inside | remote FS, bind-mounted into container |

Both flags also expressible as preset fields: `preset.ssh = {...}` and `preset.sandbox = {...}`.

## `--ssh`

### State location: remote-only

When `--ssh` is set, all agent state (`~/.flt/agents/<name>`, run logs, skill projection at `<workdir>/.claude/skills/`, `bootstrap.md`) lives on the **remote** machine. The local flt binary acts as a control-plane proxy. `flt list` on the local host queries each known remote via ssh and aggregates output. No state is mirrored locally.

### Bootstrap: `flt add remote`

New subcommand:

```
flt add remote <alias> <host>
  [--user <u>]
  [--identity-file <path>]
  [--port <p>]
```

- Validates ssh key auth works (ssh -o BatchMode=yes <host> true; fail fast otherwise)
- Detects remote arch (`uname -m`)
- Downloads matching flt binary, installs to `~/.flt/bin/flt` on remote, ensures `~/.flt/bin` is on PATH
- Rsyncs `~/.flt/skills/` to remote `~/.flt/skills/`
- Writes `~/.flt/remotes.json` locally with the alias → host/user/port mapping
- Prompts user to run any required CLI auth on remote (`claude /login`, etc.) — flt does not store or proxy CLI credentials; the user authenticates each CLI on each remote once, just like they would locally

`flt remote list` and `flt remote remove <alias>` for management.

### Auth model

flt assumes pre-existing ssh key auth. Users configure ssh keys/aliases in `~/.ssh/config` themselves. flt does not manage keypairs.

If ssh prompts for a password mid-spawn (no key, or key requires unlock):
- **Inside TUI**: detect "password:" prompt on stderr → pop a password modal → write to ssh stdin
- **Outside TUI** (`FLT_TUI_ACTIVE != 1`): pass through to the calling terminal — user types password directly. No flt-side caching
- flt never stores passwords. Users wanting to script remote spawns must use passwordless keys

### Connection lifetime: TUI-tied ControlMaster

When the flt TUI starts, open one ssh ControlMaster per known-active remote at `~/.flt/ssh/cm-<alias>.sock`. Reuse for all `flt send/list/logs/kill` calls during the TUI session. Close all ControlMasters on TUI exit.

Outside TUI (one-shot CLI invocations, cron, controller daemon): use fresh ssh per call. ssh handshake (~300-1000ms) is acceptable for non-interactive use.

ControlMaster handles dead sockets via `ssh -o ControlPersist=10m -O check`; on failure, rebuild.

## `--sandbox`

### Runtimes

Native support for **Docker, Apple `container`, and Podman**. All three are accessed via their CLI:

| Runtime | Spawn primitive | Exec primitive | Stop+rm |
|---|---|---|---|
| Docker | `docker run -d` | `docker exec` | `docker rm -f` |
| Apple `container` | `container run -d` | `container exec` | `container delete -f` |
| Podman | `podman run -d` | `podman exec` | `podman rm -f` |

`--runtime <name>` selects; default = auto-detect (in order: Apple `container` on macOS, then Docker, then Podman).

### Image selection

Default: pre-baked `flt/agent-runtime:<version>` (built and published from `flt` repo). Contains:
- tmux 3.x
- bash, coreutils, git, curl, jq, rsync
- Node 20+ (for claude-code, codex, opencode)
- Python 3.12 (for pi)
- All CLI adapters preinstalled at expected paths

Override via preset:
- `preset.sandbox.image: <ref>` — use the named image as-is. flt does not modify it. The image must include tmux + the target CLI binary, OR the user accepts that adapter readiness detection will time out
- `preset.sandbox.dockerfile: <path>` — flt builds the Dockerfile on first spawn (cached by content hash), then runs the resulting image. Path resolved relative to the workdir

### Workdir mode: bind by default, trust-image opt-in

Default (`workdir_mode: bind`): flt creates the worktree on the host as today, then bind-mounts it into the container at `/work`. tmux session inside container starts in `/work`. Edits in the container are visible on host immediately; no extraction step.

Alternative (`workdir_mode: trust-image`): no bind-mount. flt assumes the image's `WORKDIR` already contains the source the user wants. tmux starts in the image's WORKDIR. Used for users who pre-populate their workdir via Dockerfile (e.g. `git clone ... /work`).

### Network

- **Default**: full outbound, no inbound listening ports. Agent can reach Anthropic/OpenAI/etc APIs. Sufficient for almost all use
- **Per-preset `ports: ["3000:3000", ...]`**: forward host:container ports for dev-server scenarios
- **Per-preset `network: outbound|allowlist|none`**: switch egress policy. `allowlist` requires `network_allowlist: ["api.anthropic.com", ...]` (implemented via per-runtime network/firewall rules)

flt's parent→child control plane does NOT use the network — see [Control plane](#control-plane) below.

### Lifecycle

| `lifecycle` value | Container scope | Use case |
|---|---|---|
| `per-agent` (default) | One container per agent. flt spawn = `<runtime> run`. flt kill = `<runtime> rm -f` | Highest isolation. Mirrors current per-agent tmux model |
| `per-run` | One container per workflow run. First step opens it, all step agents run inside via `<runtime> exec`. Worktrees mounted at `/work/<step-id>`. Container torn down at run terminal state | Single workflow run sees a consistent FS; cheaper than per-agent for multi-step workflows |
| `shared-host` | One long-lived container shared by all agents on this host (or this preset). Each agent is a separate tmux session inside | Lowest overhead; loses isolation between agents |

### Cleanup on `flt kill`

Default: stop + remove container, delete bind-mounted worktree. Mirrors current `flt kill` worktree behavior.

`flt kill --preserve` keeps the container (stopped state) and worktree for post-mortem inspection. Existing `--preserve` flag — same semantics, extended to apply to the container too.

### Secrets / credentials

Per-CLI adapter sane defaults:

| CLI | Default secret strategy |
|---|---|
| claude-code | Bind-mount `~/.claude:ro` (OAuth state in `.credentials.json`) |
| codex | `-e OPENAI_API_KEY` (env passthrough) |
| pi | `-e PI_API_KEY` |
| gemini | `-e GEMINI_API_KEY` |
| opencode | `-e ANTHROPIC_API_KEY -e OPENAI_API_KEY` |

User override:
```jsonc
"secrets": {
  "mount": ["~/.claude", "~/.config/gh"],     // read-only bind mounts
  "env": ["ANTHROPIC_API_KEY", "GH_TOKEN"]    // env passthrough from host process
}
```

Adapter defaults are merged with user override (user values win on conflict).

## Composition: `--ssh` + `--sandbox`

When both are set:
- `--ssh <host>` selects the host
- `--sandbox` runs the container on that host
- Image, dockerfile, workdir mode, network, lifecycle, cleanup, secrets all apply on the remote
- `flt add remote` should optionally install the chosen runtime (`docker` or `podman`) on the remote if not present, OR fail with clear instructions

## Preset schema (additive)

Existing `Preset` interface in `src/presets.ts`:

```ts
interface Preset {
  cli: string
  model: string
  description?: string
  soul?: string
  dir?: string
  parent?: string
  worktree?: boolean
  persistent?: boolean
  skills?: string[]
  allSkills?: boolean
  env?: Record<string, string>
  // ADD:
  ssh?: SshConfig
  sandbox?: SandboxConfig
}

interface SshConfig {
  host: string
  user?: string
  identityFile?: string
  port?: number
}

interface SandboxConfig {
  runtime?: 'docker' | 'apple' | 'podman' | 'auto'  // default 'auto'
  image?: string                                     // default = flt's pre-baked image
  dockerfile?: string                                // alternative to image
  workdir_mode?: 'bind' | 'trust-image'              // default 'bind'
  network?: 'outbound' | 'allowlist' | 'none'        // default 'outbound'
  network_allowlist?: string[]                       // when network='allowlist'
  ports?: string[]                                   // ["3000:3000", ...]
  lifecycle?: 'per-agent' | 'per-run' | 'shared-host'  // default 'per-agent'
  on_kill?: 'rm' | 'keep'                            // default 'rm'
  secrets?: { mount?: string[]; env?: string[] }
}
```

Both top-level fields optional. Existing presets unchanged. `validatePresetValue` extended to type-check the new objects.

## CLI flag overrides

Precedence (highest first): explicit CLI flag > preset field > default.

New flags on `flt spawn`:
```
--ssh <host>              equivalent to ssh.host=<host>
--ssh-user <u>            equivalent to ssh.user=<u>
--ssh-identity-file <p>
--ssh-port <p>
--no-ssh                  force-disable ssh even if preset declares it
--sandbox                 turn on with default config
--no-sandbox              force-disable
--runtime <name>          equivalent to sandbox.runtime=<name>
--image <ref>             equivalent to sandbox.image=<ref>
--dockerfile <path>       equivalent to sandbox.dockerfile=<path>
--ports <p:p>             repeatable; each adds to sandbox.ports
--lifecycle <mode>
--network <mode>
--preserve                already exists; extended to skip container rm
```

## State.json schema migration: zero-cost

Add optional field:

```ts
interface AgentState {
  // ...existing...
  location?: Location
}

type Location =
  | { type: 'local' }
  | { type: 'ssh'; host: string }
  | { type: 'sandbox'; runtime: string; container: string }
  | { type: 'ssh+sandbox'; host: string; runtime: string; container: string }
```

Read access: `const loc = agent.location ?? { type: 'local' }`. Legacy entries without `location` keep working as local. New spawns write the field. No migration script. Old flt CLIs reading newer state.json will see unknown fields (ignored); they cannot control non-local agents but won't corrupt the file.

## Control plane: `deliver(agent, ...)` wrapper

Currently `flt send`, bootstrap, and the controller poller call `tmux.sendLiteral` and `tmux.sendKeys` directly with `tmuxSession = "flt-<name>"`. Replace these direct calls with a `deliver(agent, message)` function in `src/delivery.ts` that branches on `agent.location.type`:

```ts
function deliver(agent: AgentState, message: string): void {
  const loc = agent.location ?? { type: 'local' }
  switch (loc.type) {
    case 'local':
      sendLocalTmux(agent.tmuxSession, message)
      return
    case 'ssh':
      sendOverSsh(loc.host, agent.tmuxSession, message)
      return
    case 'sandbox':
      sendViaRuntimeExec(loc.runtime, loc.container, agent.tmuxSession, message)
      return
    case 'ssh+sandbox':
      sendOverSsh(loc.host, /* into runtime exec */ ...)
      return
  }
}
```

Same wrapper used by `flt list` (status/last-activity polling), `flt logs` (tmux capture-pane), and `flt kill`.

## Workflow engine: `per-run` lifecycle handling

When a workflow run begins and `lifecycle: per-run` is set on the preset of the first spawning step:

1. Engine creates one container at run-start. Container ID stored in `run.json` under `run.sandboxContainer`
2. Worktree base dir (host: `/var/folders/.../flt-wt-<run-id>-*`) bind-mounted into container at `/work`
3. Each step's spawn becomes `<runtime> exec <container> tmux new-session -d -s flt-<step-agent>` instead of `<runtime> run`
4. Step agents see worktrees at `/work/<step-id>`; the workflow template `{steps.X.worktree}` resolves to in-container paths
5. On run terminal state (completed/cancelled/failed), engine stops + removes container. Bind-mounted worktree handled per existing rules

Crash recovery: a restarted controller reads `run.sandboxContainer` from `run.json`. If the container is still running, reattach. If gone, mark run as orphaned and report.

## Implementation order

Suggested phasing for the implementing dynamic_dag:

1. **delivery layer** — add `Location` type + `deliver()` wrapper + state.json optional field. Refactor existing direct `tmux.send*` callsites to go through `deliver(agent)`. All existing tests pass with `location` defaulting to local.
2. **sandbox: per-agent + Docker only** — minimal `--sandbox` + `--runtime docker` + bind-mount workdir + outbound network + per-CLI secret defaults. Tests cover spawn → bootstrap → send → kill cycle.
3. **sandbox: Apple container + Podman** — adapter pattern over runtime CLIs. Auto-detect.
4. **sandbox: lifecycle + network + ports** — `per-run` lifecycle, allowlist/none network modes, port forwarding.
5. **ssh: `flt add remote` + `flt remote list/remove`** — bootstrap subcommand, remotes.json, ControlMaster setup outside TUI.
6. **ssh: spawn + send** — `--ssh` flag on spawn, deliver() ssh branch, fresh-ssh-per-call mode.
7. **ssh: TUI ControlMaster** — open on TUI start, close on exit. Password modal in TUI.
8. **ssh + sandbox composition** — runtime exec inside ssh, full integration tests.
9. **flt list/logs/kill cross-location** — surface all locations in flt list output, proxy logs and kill correctly.
10. **docs + examples** — update SPEC.md, README, add example presets.

Each phase = one PR. Each PR ships behind tests; nothing breaks for users not using `--ssh`/`--sandbox`.

## Out of scope

- Migrating existing local agents to remote/sandbox after spawn (no live migration)
- Multi-host workflow runs (a single run still pinned to one host)
- Agent-to-agent direct messaging across hosts (still routed through orchestrator)
- Container build caching across distinct dockerfiles (use docker's native build cache; no flt-side cache layer)
- ssh agent forwarding (user configures in their own ssh config)
