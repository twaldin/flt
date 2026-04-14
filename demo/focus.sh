#!/bin/bash
# Focus an agent by name in the flt TUI
# Usage: ./demo/focus.sh <agent-name> [tmux-target]
# Reads agent order from flt list, calculates j/k presses needed

NAME="$1"
TARGET="${2:-twaldin:1}"

if [ -z "$NAME" ]; then
  echo "Usage: focus.sh <agent-name> [tmux-target]"
  exit 1
fi

# Get ordered agent list from flt list output
AGENTS=$(cd ~/flt && bun run src/cli.ts list 2>/dev/null | grep -E '├|└' | sed 's/\x1b\[[0-9;]*m//g' | awk '{print $2}')

# Find target index (0-based)
TARGET_IDX=-1
IDX=0
while IFS= read -r agent; do
  if [ "$agent" = "$NAME" ]; then
    TARGET_IDX=$IDX
    break
  fi
  IDX=$((IDX + 1))
done <<< "$AGENTS"

if [ "$TARGET_IDX" -lt 0 ]; then
  echo "Agent '$NAME' not found in fleet"
  exit 1
fi

# Go to top first (press k many times)
TOTAL=$(echo "$AGENTS" | wc -l | tr -d ' ')
for (( i=0; i<TOTAL; i++ )); do
  tmux send-keys -t "$TARGET" k
  sleep 0.05
done
sleep 0.2

# Now press j to reach target
for (( i=0; i<TARGET_IDX; i++ )); do
  tmux send-keys -t "$TARGET" j
  sleep 0.1
done
sleep 0.2

echo "Focused: $NAME (index $TARGET_IDX)"
