#!/bin/bash
# flt demo driver — sends keys to TUI for screen recording
# Pre-req: demo agents already spawned, TUI in normal mode
#
# Usage: ./demo/drive-demo.sh [tmux-target]

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

echo "Demo starting in 2..."; sleep 1; echo "1..."; sleep 1; echo "GO"

# ── Beat 1: Browse the multi-harness fleet (4s) ──
pause 1
send j; pause 0.4      # cairn → demo-aider (aider/sonnet)
send j; pause 0.4      # → demo-codex (codex/gpt-5.3)
send j; pause 0.4      # → demo-claude (claude-code/haiku)
send j; pause 0.4      # → agentelo
send j; pause 0.4      # → trader
send k; pause 0.3
send k; pause 0.3
send k; pause 0.5

# ── Beat 2: Focus log — see agent output (3s) ──
send Enter; pause 1
send G; pause 1         # jump to bottom to see latest
send Escape; pause 0.5

# ── Beat 3: Check inbox — hello messages from all harnesses (3s) ──
send m; pause 1.5
send j; pause 0.3
send j; pause 0.3
send k; pause 0.5
send Escape; pause 0.5

# ── Beat 4: Reply to an agent (3s) ──
send r; pause 0.3
type_slow "send demo-codex what tests did you find?" 0.04
pause 0.3
send Enter; pause 1.5

# ── Beat 5: Theme switch (3s) ──
send :; pause 0.2
type_slow "theme dracula" 0.04
send Enter; pause 1.5
send :; pause 0.2
type_slow "theme minimal" 0.04
send Enter; pause 1

echo "Done (~17s). Stop recording."
