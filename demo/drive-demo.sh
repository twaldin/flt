#!/bin/bash
# flt demo driver — full live demo with 3 spawn methods
#
# Pre-reqs:
#   - TUI visible in target pane, normal mode
#   - Inbox cleared
#   - Only cairn + trader running (clean fleet)
#   - Screen recording running
#
# Storyboard (~60s):
#   1. Insert mode: cairn types intro message to trader
#   2. CLI spawn: cairn spawns a codex agent from this terminal
#   3. TUI :spawn: script types :spawn in TUI command bar
#   4. Shell spawn: press t, type flt spawn in shell mode
#   5. Messages arrive — agents send hellos to inbox
#   6. Check inbox
#   7. Theme switch
#   8. End on fleet view

TARGET="${1:-66:1}"

type_slow() {
  local text="$1"
  local spd="${2:-0.04}"
  for (( i=0; i<${#text}; i++ )); do
    local char="${text:$i:1}"
    if [ "$char" = ";" ]; then
      printf '%s' "$char" | tmux load-buffer -
      tmux paste-buffer -t "$TARGET"
    else
      tmux send-keys -t "$TARGET" -l "$char"
    fi
    sleep "$spd"
  done
}

send() { tmux send-keys -t "$TARGET" "$@"; }
pause() { sleep "${1:-1}"; }

echo "=== flt live demo ==="
echo "Target: $TARGET"
echo "Starting in 3..."; sleep 1; echo "2..."; sleep 1; echo "1..."; sleep 1
echo "GO"

# ── Scene 1: Insert mode — type to trader (5s) ──
# Select trader first
send j; pause 0.3
# Enter insert mode directly from normal
send i; pause 0.5
type_slow "hey trader, demo time. what's our portfolio at?" 0.05
send Enter; pause 2
send Escape; pause 0.5

# ── Scene 2: CLI spawn — cairn spawns codex agent (5s) ──
# This happens from THIS terminal, not the TUI
# The agent appears in the TUI sidebar live
echo "Spawning codex agent from CLI..."
cd ~/flt && bun run src/cli.ts spawn demo-codex --cli codex --model gpt-5.3-codex --no-worktree --dir ~/flt \
  "You are a demo agent. Run: flt send parent 'hello from codex/gpt-5.3! tests look good.'" &>/dev/null &
pause 4

# ── Scene 3: TUI :spawn — spawn from command bar (6s) ──
send :; pause 0.3
type_slow "spawn demo-claude -c claude-code -m haiku -W -d ~/flt \"Run: flt send parent 'hello from claude-code/haiku!'\"" 0.03
pause 0.3
send Enter; pause 5

# ── Scene 4: Shell spawn — press t, type flt spawn (8s) ──
send t; pause 0.8
type_slow "flt spawn demo-aider --cli aider --model gpt-5.4-mini --no-worktree --dir ~/flt \"Run: flt send parent 'hello from aider/gpt-5.4-mini!'\"" 0.03
pause 0.3
send Enter; pause 5
send Escape; pause 0.5

# ── Scene 5: Browse the fleet (4s) ──
# Now we have cairn, trader, demo-codex, demo-claude, demo-aider
send k; pause 0.3
send k; pause 0.3
send j; pause 0.3
send j; pause 0.3
send j; pause 0.3
send j; pause 0.5

# ── Scene 6: Check inbox — hello messages (4s) ──
send m; pause 1.5
send j; pause 0.3
send j; pause 0.3
send k; pause 0.5
send Escape; pause 0.5

# ── Scene 7: Focus an agent log (3s) ──
send Enter; pause 1
send G; pause 1
send Escape; pause 0.5

# ── Scene 8: Theme switch (4s) ──
send :; pause 0.2
type_slow "theme dracula" 0.04
send Enter; pause 1.5
send :; pause 0.2
type_slow "theme minimal" 0.04
send Enter; pause 1.5

echo ""
echo "=== Demo complete (~45s) ==="
echo "Stop recording. Kill demo agents with:"
echo "  flt kill demo-codex && flt kill demo-claude && flt kill demo-aider"
