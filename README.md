# flt

Spawn and manage AI coding agents across multiple CLI harnesses, using tmux.

flt gives you a terminal multiplexer for AI agents. Spawn agents in any supported CLI (Claude Code, Codex, Gemini CLI, Aider, OpenCode, SWE-agent), send them tasks, watch their output, and manage the fleet from a single TUI.

## Install

```bash
bun install -g flt
```

Requires: [tmux](https://github.com/tmux/tmux), [Bun](https://bun.sh)

## Quick start

```bash
# Launch the TUI
flt init

# Spawn an agent
flt spawn mycoder --cli claude-code --model sonnet --dir ~/project "fix the parser bug"

# Or use a preset
flt presets add coder --cli codex --model gpt-5.3-codex
flt spawn mycoder --preset coder --dir ~/project "fix the parser bug"

# Send a message to an agent
flt send mycoder "also add tests"

# View output
flt logs mycoder

# Kill when done
flt kill mycoder
```

## TUI

The TUI shows all agents in a sidebar with live terminal output in the main pane.

### Keybindings

| Mode | Key | Action |
|------|-----|--------|
| Normal | `j/k` | Select agent |
| Normal | `Enter` | Focus log pane |
| Normal | `i` | Insert mode (type to agent) |
| Normal | `m` | Inbox |
| Normal | `t` | Shell |
| Normal | `K` | Kill agent |
| Normal | `:` | Command bar |
| Normal | `q` | Quit |
| Log focus | `j/k` | Scroll |
| Log focus | `Ctrl-d/u` | Page scroll |
| Log focus | `G/g` | Bottom/top |
| Log focus | `i` | Insert mode |
| Insert | `Esc` | Exit insert |

### Commands

```
:spawn name --cli claude-code --model sonnet --dir ~/project "task"
:spawn name --preset coder --dir ~/project "task"
:send name message
:kill name
:logs name
:presets list
:presets add name --cli claude-code --model sonnet
:theme dracula
```

## CLI adapters

| CLI | Command | Models |
|-----|---------|--------|
| `claude-code` | `claude` | haiku, sonnet, opus |
| `codex` | `codex` | gpt-5.3-codex, gpt-5.4, o3 |
| `gemini` | `gemini` | gemini-2.5-pro, gemini-2.5-flash |
| `aider` | `aider` | Any (via OpenRouter, Anthropic, OpenAI) |
| `opencode` | `opencode` | Any (via OpenRouter) |
| `swe-agent` | mini-swe-agent | Any (via OpenRouter) |

Each adapter handles:
- Spawning with the right flags (`--dangerously-skip-permissions`, `--yes`, etc.)
- Detecting ready state (prompt visible, dialogs auto-approved)
- Status detection (working vs idle)
- Correct submit keys

## Presets

Save CLI/model combos for quick spawning:

```bash
flt presets add reviewer --cli claude-code --model opus --description "Thorough code review"
flt spawn rev --preset reviewer --dir ~/project "review the auth module"
```

Presets stored in `~/.flt/presets.json`.

## Skills

Skills are markdown files that get injected into agents' instruction files. Global skills go in `~/.flt/skills/`, per-agent skills in `~/.flt/agents/<name>/skills/`.

```markdown
---
name: my-skill
description: What this skill does
cli-support: ['*']
---

Instructions for the agent...
```

For Claude Code agents, skills become slash commands. For all other CLIs, skills are appended to the instruction file (AGENTS.md, GEMINI.md, etc.).

## Agent identity

Each agent can have a `SOUL.md` file at `~/.flt/agents/<name>/SOUL.md` defining its identity, responsibilities, and hard rules. This gets injected into the agent's instruction file on spawn.

## Messaging

Agents communicate via `flt send`:

```bash
# Agent → parent
flt send parent "task complete"

# Agent → sibling
flt send other-agent "check my PR"

# Human → agent (from TUI command bar)
:send mycoder "also handle edge case X"
```

Messages are tagged with `[SENDER]:` for clear attribution. The inbox (`m` in TUI) shows messages grouped by sender.

## Themes

8 built-in themes: `dark`, `light`, `minimal`, `catppuccin`, `gruvbox`, `tokyo-night`, `nord`, `dracula`.

```
:theme dracula
```

Persisted in `~/.flt/config.json`.

## Model suggestions

Autocomplete suggestions are configurable in `~/.flt/models.json`:

```json
{
  "aider": ["sonnet", "opus", "deepseek/deepseek-chat"],
  "opencode": ["gpt-5.3", "openrouter/qwen/qwen3-coder"]
}
```

## Architecture

```
~/.flt/
  state.json          # Fleet state (agents, orchestrator)
  config.json         # Theme, settings
  presets.json         # Spawn presets
  models.json         # Model autocomplete suggestions
  inbox.log           # Agent messages
  skills/             # Global skills (injected into all agents)
  agents/
    <name>/
      SOUL.md          # Agent identity
      state.md         # Agent state (for compaction/resume)
      skills/          # Per-agent skills
```

Each agent runs in its own tmux session (`flt-<name>`). The TUI captures pane output, resizes panes to match the log view, and forwards keystrokes in insert mode.

Git worktrees are created by default for code-working agents, giving each agent an isolated branch. Use `--no-worktree` for agents that don't need code isolation.

## Status detection

The TUI shows agent status with icons:
- `▶` working — actively generating output
- `⏸` idle — waiting at prompt
- `○` exited — tmux session died
- `?` unknown

Detection is per-CLI:
- **Claude Code**: spinner icon cycles (✽✳✢✻✶·) every second when active, freezes when done
- **Codex**: "esc to interrupt" text present when working
- **Gemini/OpenCode**: braille spinner characters when active
- **All CLIs**: fallback pane-content-delta (content changing = working, static = idle)

## License

MIT
