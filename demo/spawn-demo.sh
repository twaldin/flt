#!/bin/bash
# Spawn 4 demo agents as cairn's children across different harnesses
# Usage: ./demo/spawn-demo.sh

export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20 2>/dev/null

cd ~/flt

flt spawn demo-claude --cli claude-code --model sonnet --parent cairn -W -d ~/flt \
  "Run this exact shell command: flt send parent \"hi from claude-code/sonnet!\"" &

flt spawn demo-codex --cli codex --model gpt-5.3-codex --no-worktree --parent cairn -d ~/flt \
  "Run this exact shell command: flt send parent \"hi from codex/gpt-5.3-codex!\"" &

flt spawn demo-gemini --cli gemini --model gemini-2.5-flash --parent cairn -W -d ~/flt \
  "Send a greeting to your parent agent. Run a shell command like this: flt send parent followed by your greeting in quotes. Your greeting should say hi from gemini-2.5-flash." &

flt spawn demo-oc --cli opencode --model openai/gpt-5.4-mini --parent cairn -W -d ~/flt \
  "Run this exact shell command: flt send parent \"hi from opencode/gpt-5.4-mini!\"" &

wait
echo "4 demo agents spawned as cairn children"
