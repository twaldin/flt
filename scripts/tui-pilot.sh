#!/usr/bin/env bash
# tui-pilot.sh — isolated flt TUI verification harness
#
# Subcommands:
#   up [--link <dir>...]   Start isolated controller (private HOME + tmux server)
#   tui [--record]         Launch TUI under tuistory via tctl
#   snapshot               Print current TUI snapshot (trimmed)
#   down [--rm]            Tear down session, controller, isolated tmux server
#   smoke                  Full up→tui→wait-idle→snapshot→assert→down cycle
#
# Isolation model:
#   HOME        → $ISO (a temp dir, or $FLT_PILOT_HOME if set)
#   TMUX_TMPDIR → $ISO/tmux  (separate tmux server — no overlap with user sessions)
#   TMUX        → unset       (prevents inheriting the user's tmux server connection)
#
# The script never touches the default tmux server or real ~/.flt.
set -euo pipefail

# Locate repo root relative to this script
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TCTL="$HOME/.factory/plugins/marketplaces/factory-plugins/plugins/droid-control/bin/tctl"
FLT="bun $REPO_ROOT/src/cli.ts"

# Allow FLT_PILOT_HOME to pin the ISO dir across subcommand calls (e.g.
# `FLT_PILOT_HOME=/tmp/flt-pilot.XYZ tui-pilot.sh tui` after a prior `up`).
# If unset, each subcommand creates its own temp dir (useful for `smoke`).
ISO="${FLT_PILOT_HOME:-}"

TCTL_SESSION="flt-pilot"

# ---------------------------------------------------------------------------
# Safety guard: never run if ISO resolves to the real HOME.
# ---------------------------------------------------------------------------
assert_not_real_home() {
  local iso="$1"
  if [ "$iso" = "$HOME" ]; then
    echo "tui-pilot: REFUSING — ISO resolved to real \$HOME ($HOME). Aborting." >&2
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Wrap every flt/tmux call with the isolation env.
# ---------------------------------------------------------------------------
iso_env() {
  env -u TMUX HOME="$ISO" TMUX_TMPDIR="$ISO/tmux" "$@"
}

# ---------------------------------------------------------------------------
# Resolve or create ISO dir.
# ---------------------------------------------------------------------------
ensure_iso() {
  if [ -z "$ISO" ]; then
    ISO="$(mktemp -d /tmp/flt-pilot.XXXXXX)"
  fi
  assert_not_real_home "$ISO"
  mkdir -p "$ISO/tmux" "$ISO/.flt"
}

# ---------------------------------------------------------------------------
# Subcommand: up
# Usage: up [--link <host-dir>...]
# Starts the isolated controller and prints the ISO path.
# ---------------------------------------------------------------------------
cmd_up() {
  ensure_iso

  # Parse --link args to symlink auth dirs into ISO HOME.
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --link)
        shift
        local src="$1"
        local name
        name="$(basename "$src")"
        if [ -e "$src" ]; then
          ln -sf "$src" "$ISO/$name"
        else
          echo "tui-pilot: warning: --link source not found: $src" >&2
        fi
        shift
        ;;
      *)
        echo "tui-pilot up: unknown option: $1" >&2
        exit 1
        ;;
    esac
  done

  echo "tui-pilot: starting isolated controller at $ISO" >&2
  iso_env $FLT controller start

  # Wait up to 10s for socket.
  local deadline=$(( $(date +%s) + 10 ))
  while [ ! -S "$ISO/.flt/controller.sock" ]; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "tui-pilot: controller socket did not appear within 10s" >&2
      exit 1
    fi
    sleep 0.2
  done

  echo "$ISO"
}

# ---------------------------------------------------------------------------
# Subcommand: tui
# Usage: tui [--record]
# Launches the TUI under tctl (tuistory backend).
# ---------------------------------------------------------------------------
cmd_tui() {
  [ -n "$ISO" ] || { echo "tui-pilot: tui: FLT_PILOT_HOME not set — run 'up' first" >&2; exit 1; }
  assert_not_real_home "$ISO"

  # tctl requires tuistory on PATH.
  if ! command -v tuistory >/dev/null 2>&1; then
    echo "tui-pilot: tuistory not found — run: bun add -g tuistory" >&2
    exit 1
  fi
  if [ ! -x "$TCTL" ]; then
    echo "tui-pilot: tctl not found at $TCTL" >&2
    exit 1
  fi

  local record_arg=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --record)
        record_arg="--record $ISO/tui.cast"
        shift
        ;;
      *)
        echo "tui-pilot tui: unknown option: $1" >&2
        exit 1
        ;;
    esac
  done

  # Build the child command string.  We embed HOME and TMUX_TMPDIR directly
  # in the command string so they survive the tctl runner's bash -lc wrapper.
  # FORCE_COLOR/COLORTERM are delivered via tctl --env flags (they are applied
  # as exports before exec in write_session_runner; see tctl source).
  #
  # TMUX is set to a dummy socket path to satisfy flt's `process.env.TMUX`
  # guard (src/commands/init.ts:328) without pointing at a real tmux server.
  # It is NOT unset here because the TUI refuses to start without it; the
  # dummy value prevents any real tmux server interaction (tmuxNoThrow calls
  # are best-effort and fail silently if the socket path is invalid).
  local dummy_tmux="$ISO/tmux/fake-socket,0,0"
  local child_cmd="env HOME=$(printf '%q' "$ISO") TMUX_TMPDIR=$(printf '%q' "$ISO/tmux") TMUX=$(printf '%q' "$dummy_tmux") $FLT tui"

  # shellcheck disable=SC2086
  "$TCTL" launch "$child_cmd" \
    -s "$TCTL_SESSION" \
    --backend tuistory \
    --cols 120 \
    --rows 36 \
    --env "FORCE_COLOR=3" \
    --env "COLORTERM=truecolor" \
    $record_arg
}

# ---------------------------------------------------------------------------
# Subcommand: snapshot
# Prints the current TUI snapshot (trimmed).
# ---------------------------------------------------------------------------
cmd_snapshot() {
  if [ ! -x "$TCTL" ]; then
    echo "tui-pilot: tctl not found at $TCTL" >&2
    exit 1
  fi
  "$TCTL" -s "$TCTL_SESSION" snapshot --trim
}

# ---------------------------------------------------------------------------
# Subcommand: down
# Usage: down [--rm]
# Tears down the tctl session, isolated controller, and isolated tmux server.
# ---------------------------------------------------------------------------
cmd_down() {
  local remove=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --rm) remove=1; shift ;;
      *)
        echo "tui-pilot down: unknown option: $1" >&2
        exit 1
        ;;
    esac
  done

  # Close tctl session (quits the tuistory PTY).
  "$TCTL" -s "$TCTL_SESSION" close 2>/dev/null || true

  if [ -n "$ISO" ]; then
    assert_not_real_home "$ISO"

    # Stop the isolated controller.
    iso_env $FLT controller stop 2>/dev/null || true

    # Kill the isolated tmux server (TMUX_TMPDIR-scoped).
    iso_env tmux kill-server 2>/dev/null || true

    if [ "$remove" -eq 1 ]; then
      rm -rf "$ISO"
      echo "tui-pilot: removed $ISO" >&2
    else
      echo "tui-pilot: ISO dir preserved at $ISO (pass --rm to delete)" >&2
    fi
  fi
}

# ---------------------------------------------------------------------------
# Subcommand: smoke
# Full cycle: up → tui → wait-idle → snapshot → assert → down --rm
# Expected TUI chrome: "No agents running." (panels.ts:191)
# ---------------------------------------------------------------------------
cmd_smoke() {
  if ! command -v tuistory >/dev/null 2>&1; then
    echo "tui-pilot smoke: SKIP — tuistory not on PATH (run: bun add -g tuistory)" >&2
    exit 0
  fi
  if [ ! -x "$TCTL" ]; then
    echo "tui-pilot smoke: SKIP — tctl not found at $TCTL" >&2
    exit 0
  fi

  ensure_iso
  local iso_path="$ISO"
  echo "tui-pilot smoke: ISO=$iso_path" >&2

  # Always clean up on exit (pass --rm; errors in cleanup are non-fatal).
  trap 'FLT_PILOT_HOME='"$iso_path"' ISO='"$iso_path"' cmd_down --rm 2>/dev/null || true' EXIT

  # 1. Start isolated controller.
  FLT_PILOT_HOME="$iso_path" ISO="$iso_path" cmd_up

  # 2. Launch TUI under tctl.
  FLT_PILOT_HOME="$iso_path" ISO="$iso_path" cmd_tui

  # 3. Wait for TUI output to stabilize.
  "$TCTL" -s "$TCTL_SESSION" wait-idle --timeout 15000

  # 4. Snapshot.
  local snap
  snap="$("$TCTL" -s "$TCTL_SESSION" snapshot --trim)"

  echo "tui-pilot smoke: snapshot:" >&2
  echo "$snap" >&2

  # 5. Assert expected TUI chrome is present.
  # "No agents running." is the stable string emitted by panels.ts:191
  # when the sidebar is empty.
  if echo "$snap" | grep -qF "No agents running."; then
    echo "tui-pilot smoke: PASS — found 'No agents running.' in snapshot" >&2
  else
    echo "tui-pilot smoke: FAIL — expected 'No agents running.' not found in snapshot" >&2
    echo "--- snapshot ---" >&2
    echo "$snap" >&2
    echo "--- end ---" >&2
    exit 1
  fi

  # down --rm fires via EXIT trap above.
  echo "tui-pilot smoke: OK" >&2
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
usage() {
  cat >&2 <<'EOF'
usage:
  tui-pilot.sh up [--link <host-dir>...]
  tui-pilot.sh tui [--record]
  tui-pilot.sh snapshot
  tui-pilot.sh down [--rm]
  tui-pilot.sh smoke
EOF
  exit 2
}

mode="${1:-}"
shift || true
case "$mode" in
  up)       cmd_up       "$@" ;;
  tui)      cmd_tui      "$@" ;;
  snapshot) cmd_snapshot "$@" ;;
  down)     cmd_down     "$@" ;;
  smoke)    cmd_smoke    "$@" ;;
  *)        usage ;;
esac
