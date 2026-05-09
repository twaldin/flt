#!/usr/bin/env bash
# bughunt-sandbox.sh — sandbox lifecycle for the flt bug-hunt mission.
#
# Modes:
#   create                   Create a fresh sandbox under /tmp/flt-bughunt-XXXX,
#                            symlink adapter auth dirs from the host, and print
#                            the sandbox root path on stdout.
#                            REFUSES if $TMUX is set on the invoker (defense in
#                            depth: flt's src/tmux.ts inherits $TMUX and would
#                            connect to the user's default tmux server, killing
#                            the user's flt-controller). Caller must
#                            `unset TMUX` first.
#   destroy <path>           Kill the sandbox tmux server and rm -rf the path.
#                            Refuses to operate on paths outside /tmp/flt-bughunt-*.
#   verify <path>            Sanity-check that the sandbox directory layout is
#                            intact (`.flt/`, `tmux/`, the host symlinks).
#   verify-tmux-isolation    Self-test: create a fresh sandbox, ensure that
#                            after `unset TMUX` a bare `tmux list-sessions`
#                            does NOT see the user's flt-orchestrator/flt-*
#                            sessions, then tear the sandbox back down.
#                            Exits non-zero on any leak.
#
# The sandbox contract is:
#   $SBX/.flt/                empty per-sandbox flt state dir
#   $SBX/tmux/                directory used as $TMUX_TMPDIR (separate tmux server)
#   $SBX/.claude    -> /Users/twaldin/.claude         (read-only auth source)
#   $SBX/.codex     -> /Users/twaldin/.codex          (read-only auth source)
#   $SBX/.config    -> /Users/twaldin/.config         (read-only auth source)
#
# Workers MUST `export HOME=$SBX TMUX_TMPDIR=$SBX/tmux` before any flt or tmux
# command. The mission boundary is: never touch the user's real ~/.flt.
set -euo pipefail

SANDBOX_PREFIX="/tmp/flt-bughunt-"

# Host paths to symlink into a sandbox HOME for adapter authentication. Each is
# optional; missing host paths are simply skipped (worker reports auth gap).
HOST_HOME="${BUGHUNT_HOST_HOME:-/Users/twaldin}"
HOST_SYMLINK_SOURCES=(
  ".claude"
  ".codex"
  ".config"
)

usage() {
  cat >&2 <<'EOF'
usage:
  bughunt-sandbox.sh create
  bughunt-sandbox.sh destroy <path>
  bughunt-sandbox.sh verify  <path>
  bughunt-sandbox.sh verify-tmux-isolation
EOF
  exit 2
}

# Refuse paths that are not under the sandbox prefix. This is the *only*
# guard between this script and `rm -rf` of arbitrary paths.
assert_sandbox_path() {
  local p="$1"
  case "$p" in
    "${SANDBOX_PREFIX}"*) ;;
    *)
      echo "bughunt-sandbox: refusing path outside ${SANDBOX_PREFIX}*: $p" >&2
      exit 1
      ;;
  esac
  # Reject path traversal that escapes the prefix.
  case "$p" in
    */..*|*/.*/..*)
      echo "bughunt-sandbox: refusing path with .. component: $p" >&2
      exit 1
      ;;
  esac
}

cmd_create() {
  # Defense in depth: refuse if $TMUX is set on the invoker. flt's
  # src/tmux.ts shells out to bare `tmux` and inherits $TMUX from env;
  # an inherited $TMUX overrides $TMUX_TMPDIR and points flt at the
  # user's default tmux server, where `flt controller start`/`flt init`
  # call `tmux kill-session -t flt-controller` unconditionally and
  # killed the user's live flt-controller (see hunt-c1-lifecycle).
  # Callers MUST `unset TMUX` before invoking this script.
  if [ -n "${TMUX:-}" ]; then
    cat >&2 <<'EOF'
bughunt-sandbox: REFUSING to create — $TMUX is set on the invoker.
# IMPORTANT: caller must `unset TMUX` before calling create, otherwise
# flt's child tmux processes inherit the user's tmux server connection
# and `flt controller start`/`flt init` will kill the user's
# flt-controller. Run:
#   unset TMUX
# then re-invoke this script.
EOF
    exit 1
  fi

  local sbx
  sbx=$(mktemp -d "${SANDBOX_PREFIX}XXXXXX")
  mkdir -p "$sbx/.flt" "$sbx/tmux"

  for src in "${HOST_SYMLINK_SOURCES[@]}"; do
    if [ -e "$HOST_HOME/$src" ]; then
      ln -s "$HOST_HOME/$src" "$sbx/$src"
    fi
  done

  # Reminder for path-form callers (`SBX=$(... create)`): they must run
  # `unset TMUX` themselves. For shell-init callers using
  # `eval "$(... create)"`, the line below is a no-op script line that
  # also detaches their shell from the user's tmux server.
  echo "unset TMUX" >&2
  echo "$sbx"
}

cmd_destroy() {
  local sbx="${1:-}"
  [ -n "$sbx" ] || usage
  assert_sandbox_path "$sbx"

  if [ ! -d "$sbx" ]; then
    # Nothing to do; idempotent.
    return 0
  fi

  # Kill the tmux server scoped to this sandbox.
  #
  # We use BOTH `-L <label>` (named socket) and `TMUX_TMPDIR` to make
  # absolutely sure we never touch the user's default tmux server / the
  # `flt-orchestrator` session that the user is sitting inside. NEVER use a
  # bare `tmux kill-server` here — it would kill the user's session.
  #
  # Errors are non-fatal: the server may not have been started.
  local label
  label="bughunt-$(basename "$sbx")"
  if [ -d "$sbx/tmux" ]; then
    TMUX_TMPDIR="$sbx/tmux" tmux -L "$label" kill-server >/dev/null 2>&1 || true
  fi

  rm -rf "$sbx"
}

cmd_verify() {
  local sbx="${1:-}"
  [ -n "$sbx" ] || usage
  assert_sandbox_path "$sbx"
  [ -d "$sbx" ]       || { echo "verify: missing sandbox dir: $sbx"  >&2; exit 1; }
  [ -d "$sbx/.flt" ]  || { echo "verify: missing $sbx/.flt"          >&2; exit 1; }
  [ -d "$sbx/tmux" ]  || { echo "verify: missing $sbx/tmux"          >&2; exit 1; }
  for src in "${HOST_SYMLINK_SOURCES[@]}"; do
    if [ -e "$HOST_HOME/$src" ]; then
      [ -L "$sbx/$src" ] || { echo "verify: missing symlink $sbx/$src" >&2; exit 1; }
    fi
  done
  echo "ok"
}

# verify-tmux-isolation — self-test that the sandbox correctly detaches
# from the user's tmux server. Steps:
#   1. `unset TMUX` (defense in depth — also matches the create-mode contract).
#   2. Create a fresh sandbox.
#   3. Assert $TMUX is empty after unset.
#   4. Assert that a bare `tmux list-sessions` does NOT see the user's
#      `flt-orchestrator` / `flt-*` sessions (i.e. the sandbox's
#      $TMUX_TMPDIR points at a different server).
#   5. Tear down the sandbox.
# Any failure exits non-zero with a diagnostic on stderr. The user's
# default tmux server is left untouched.
cmd_verify_tmux_isolation() {
  # Step 1: detach from any inherited tmux server. The literal `unset TMUX`
  # below is what we contract callers to run before `create`; running it
  # here makes the self-test runnable from inside an interactive shell
  # that may itself be in a tmux session.
  unset TMUX

  # Step 2: create.
  local sbx
  sbx=$(cmd_create)
  # Cleanup hook: always destroy the sandbox we just created. Substitute
  # the value into the trap body now so it survives function teardown
  # under `set -u`.
  trap "cmd_destroy '$sbx' >/dev/null 2>&1 || true" EXIT

  export HOME="$sbx"
  export TMUX_TMPDIR="$sbx/tmux"

  # Step 3: $TMUX must be empty.
  if [ -n "${TMUX:-}" ]; then
    echo "verify-tmux-isolation: FAIL — \$TMUX is still set after unset TMUX" >&2
    exit 1
  fi
  [ -z "${TMUX:-}" ] || exit 1

  # Step 4: bare `tmux list-sessions` must not see the user's sessions.
  # The sandbox's $TMUX_TMPDIR points at a fresh dir with no socket, so
  # `tmux list-sessions` should print nothing (or "no server running").
  if tmux list-sessions 2>/dev/null | grep -E '^flt-orchestrator|^flt-controller' >/dev/null; then
    echo "verify-tmux-isolation: FAIL — sandbox tmux still sees the user's flt-orchestrator/flt-controller sessions" >&2
    tmux list-sessions 2>/dev/null >&2 || true
    exit 1
  fi
  if ! tmux list-sessions 2>/dev/null | grep -E '^flt-orchestrator' >/dev/null; then
    : # OK, refutation matched our assertion (no flt-orchestrator visible)
  fi

  echo "verify-tmux-isolation: ok ($sbx)"
}

mode="${1:-}"
shift || true
case "$mode" in
  create)                cmd_create  "$@" ;;
  destroy)               cmd_destroy "$@" ;;
  verify)                cmd_verify  "$@" ;;
  verify-tmux-isolation) cmd_verify_tmux_isolation "$@" ;;
  *)                     usage ;;
esac
