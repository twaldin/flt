#!/usr/bin/env bash
set -euo pipefail

# Refresh adapter telemetry fixtures:
#   ./scripts/capture-fixture.sh <adapter>
# Required CLIs must be installed locally. SQLite adapters also use:
#   OPENCODE_DB, CRUSH_DATA_DIR, KILO_DB
# SWE Agent wrapper path can be set with:
#   SWE_WRAPPER

adapter="${1:-}"
if [[ -z "$adapter" ]]; then
  echo "usage: $0 <adapter>" >&2
  exit 1
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
fixtures="$root/tests/fixtures/session-logs/$adapter"
mkdir -p "$fixtures"
workdir="$(mktemp -d /tmp/flt-fixture-${adapter}-XXXXXX)"

cleanup() {
  rm -rf "$workdir"
}
trap cleanup EXIT

case "$adapter" in
  claude-code)
    claude -p "say hi" --output-format json --dangerously-skip-permissions >/dev/null
    src=$(find "$HOME/.claude/projects" -name '*.jsonl' -type f -print0 | xargs -0 ls -t | head -n1)
    cp "$src" "$fixtures/session.jsonl"
    ;;
  codex)
    codex exec --json -m gpt-5.3-codex -C "$workdir" "say hi" >/dev/null
    src=$(find "$HOME/.codex/sessions" -name '*.jsonl' -type f -print0 | xargs -0 ls -t | head -n1)
    cp "$src" "$fixtures/session.jsonl"
    ;;
  opencode)
    export OPENCODE_DB="$workdir/opencode.db"
    opencode run --dir "$workdir" --model gpt-5.4 "say hi" >/dev/null
    cp "$OPENCODE_DB" "$fixtures/session.db"
    ;;
  swe-agent)
    mini --model gpt-5.4 --task "say hi" --cwd "$workdir" --output "$fixtures/trajectory.json" >/dev/null
    ;;
  pi)
    pi --mode json --no-session --model sonnet "say hi" >/dev/null
    src=$(find "$HOME/.pi/agent/sessions" -name '*.jsonl' -type f -print0 | xargs -0 ls -t | head -n1)
    cp "$src" "$fixtures/session.jsonl"
    ;;
  gemini)
    gemini -p "say hi" -m gemini-2.5-pro --output-format json > "$fixtures/headless.json"
    ;;
  openclaude)
    openclaude -p "say hi" --output-format json --dangerously-skip-permissions >/dev/null
    src=$(find "$HOME/.claude/projects" -name '*.jsonl' -type f -print0 | xargs -0 ls -t | head -n1)
    cp "$src" "$fixtures/session.jsonl"
    ;;
  qwen)
    qwen -p "say hi" -m qwen3-coder --output-format json > "$fixtures/headless.json"
    ;;
  continue-cli)
    cn -p "say hi" --model gpt-5.4 --json > "$fixtures/session.json"
    ;;
  crush)
    export CRUSH_DATA_DIR="$workdir/crush-data"
    crush run --data-dir "$CRUSH_DATA_DIR" --model gpt-5.4 --small-model gpt-5.4 "say hi" >/dev/null
    cp "$CRUSH_DATA_DIR/crush.db" "$fixtures/session.db"
    ;;
  factory-droid)
    droid exec --output-format json --skip-permissions-unsafe --model gpt-5.4 --spec-model gpt-5.4 "say hi" > "$fixtures/session.json"
    ;;
  kilo)
    export KILO_DB="$workdir/kilo.db"
    kilo run --auto --format json --dir "$workdir" --model gpt-5.4 "say hi" >/dev/null
    cp "$KILO_DB" "$fixtures/session.db"
    ;;
  *)
    echo "unsupported adapter: $adapter" >&2
    exit 1
    ;;
esac

echo "fixture refreshed: $fixtures"
