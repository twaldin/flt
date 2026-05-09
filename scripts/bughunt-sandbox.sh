#!/usr/bin/env bash
# bughunt-sandbox.sh — sandbox lifecycle for the flt bug-hunt mission.
#
# Modes:
#   create                   Create a fresh sandbox under /tmp/flt-bughunt-XXXX,
#                            symlink adapter auth dirs from the host, and print
#                            the sandbox root path on stdout.
#   destroy <path>           Kill the sandbox tmux server and rm -rf the path.
#                            Refuses to operate on paths outside /tmp/flt-bughunt-*.
#   verify <path>            Sanity-check that the sandbox directory layout is
#                            intact (`.flt/`, `tmux/`, the host symlinks).
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
  local sbx
  sbx=$(mktemp -d "${SANDBOX_PREFIX}XXXXXX")
  mkdir -p "$sbx/.flt" "$sbx/tmux"

  for src in "${HOST_SYMLINK_SOURCES[@]}"; do
    if [ -e "$HOST_HOME/$src" ]; then
      ln -s "$HOST_HOME/$src" "$sbx/$src"
    fi
  done

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

mode="${1:-}"
shift || true
case "$mode" in
  create)  cmd_create  "$@" ;;
  destroy) cmd_destroy "$@" ;;
  verify)  cmd_verify  "$@" ;;
  *)       usage ;;
esac
