# flt

One fleet. Any agent. Your terminal.

flt is a CLI that spawns, messages, and manages AI coding agents across any harness — Claude Code, Codex, Gemini CLI, Aider, OpenCode, SWE-agent — from one place.

The same commands work whether you type them, an agent runs them from its tmux session, or a cron job fires them. `flt spawn`, `flt send`, `flt kill`. That's the whole API. Humans, agents, and automation all speak the same language.

## Why flt

Every AI coding CLI is good at working alone. None of them know about each other. flt gives them fleet awareness — agents know they're part of a team, who spawned them, how to message siblings, and what skills they have.

```bash
# You spawn an agent
flt spawn coder -p coder -d ~/project "fix the parser bug"

# That agent spawns a reviewer
flt spawn reviewer -p evaluator -d ~/project "review PR #5"

# A cron spawns a monitor every 30 minutes
*/30 * * * * flt spawn monitor -p monitor -d ~/project "run health checks"

# Same CLI. Human, agent, or cron. No difference.
```

## Install

```bash
bun install -g flt
```

Requires [Bun](https://bun.sh) (runtime) and [tmux](https://github.com/tmux/tmux) (session management). Node.js is not supported — flt is Bun-native.

You also need at least one AI coding CLI installed: `claude` (Claude Code), `codex` (OpenAI Codex), `gemini` (Gemini CLI), `aider`, `opencode`, or a SWE-agent setup. `git` is required for worktree-based agent isolation.

## Quick start

```bash
# Initialize the fleet
flt init

# Open the TUI
flt tui

# Spawn your first agent
flt spawn mycoder -c claude-code -m sonnet -d ~/project "fix the login bug"

# Or use presets for quick spawning
flt presets add coder -c codex -m gpt-5.3-codex
flt spawn mycoder -p coder -d ~/project "fix the login bug"

# Talk to it
flt send mycoder "also add tests for the edge case"

# Watch it work (from TUI or CLI)
flt logs mycoder

# Kill when done
flt kill mycoder
```

Use `--no-worktree` (`-W`) if your working directory isn't a git repo. By default, flt creates an isolated git worktree per agent.

## The fleet pattern

flt shines when agents manage other agents. Here's a real example — a VPS monitor that automatically fixes bugs it finds:

**1. Set up a monitor agent with a SOUL.md identity:**

```markdown
# ~/.flt/agents/monitor/SOUL.md
## Role
You monitor the production VPS every 30 minutes.

## When you find a bug
1. Open a GitHub issue: `gh issue create --title "..." --body "..."`
2. Spawn a coder: `flt spawn fix-123 -p coder -d ~/project "fix issue #123"`
3. Wait for the coder to report back
4. Spawn an evaluator: `flt spawn eval-123 -p evaluator -d ~/project "review PR #45"`
5. If evaluator says PASS: `flt send parent "PR #45 ready for merge"`
6. If FAIL: the coder loops automatically
7. Clean up: `flt kill fix-123 && flt kill eval-123`
```

**2. Set up a cron to spawn the monitor every 30 minutes:**

```bash
*/30 * * * * flt spawn monitor -p monitor -d ~/project "run health checks"
```

**3. The monitor runs, finds a pricing bug, opens an issue, spawns a coder, the coder makes a PR, spawns an evaluator, the evaluator passes it, and you get a message in your inbox:**

```
[MONITOR]: PR #45 ready for merge — fixed KNN pricing regression
```

You approve. The agent fleet handled everything else.

## TUI

Launch with `flt tui`. The sidebar shows all agents in a tree hierarchy with live status. The main pane shows the selected agent's terminal output. You can type directly to agents in insert mode.

### Keybindings

| Mode | Key | Action |
|------|-----|--------|
| Normal | `j/k` | Select agent |
| Normal | `Enter` | Focus log pane |
| Normal | `m` | Inbox |
| Normal | `t` | Shell |
| Normal | `K` | Kill agent |
| Normal | `:` | Command bar |
| Normal | `q` | Quit |
| Log focus | `j/k` | Scroll |
| Log focus | `i` | Insert mode (type to agent) |
| Log focus | `Ctrl-d/u` | Page scroll |
| Insert | any key | Forwarded to agent |
| Insert | `Esc` | Exit insert mode |

### TUI Commands

```
:spawn name -c claude-code -m sonnet -d ~/project "task"
:spawn name -p coder -d ~/project "task"
:send name message
:kill name
:presets list
:theme dracula
```

## CLI Reference

```
flt init [-o name]           # Initialize fleet (optionally spawn orchestrator)
flt tui                      # Open TUI dashboard
flt spawn <name> [options]   # Spawn an agent
flt send <target> <message>  # Send message to agent or parent
flt kill <name>              # Kill an agent
flt list                     # List all agents with status
flt logs <name> [-n lines]   # View agent terminal output
flt presets list|add|remove   # Manage spawn presets
flt skills list              # List available skills
flt tail                     # Tail inbox (lightweight, no TUI)
```

### Spawn flags

| Flag | Short | Description |
|------|-------|-------------|
| `--cli <cli>` | `-c` | CLI adapter (claude-code, codex, gemini, aider, opencode, swe-agent) |
| `--model <model>` | `-m` | Model to use |
| `--preset <name>` | `-p` | Use a saved preset |
| `--dir <path>` | `-d` | Working directory |
| `--no-worktree` | `-W` | Skip git worktree creation |

## Adapters

| CLI | Adapter | Example Models |
|-----|---------|----------------|
| Claude Code | `claude-code` | haiku, sonnet, opus |
| Codex | `codex` | gpt-5.3-codex, gpt-5.4, o3 |
| Gemini CLI | `gemini` | gemini-2.5-pro, gemini-2.5-flash |
| Aider | `aider` | Any via OpenRouter/Anthropic/OpenAI |
| OpenCode | `opencode` | Any via OpenRouter |
| SWE-agent | `swe-agent` | Any via OpenRouter |

Each adapter handles spawning with the right flags, detecting ready state, auto-approving permission dialogs, and detecting working vs idle status.

## Presets

Save CLI/model combos:

```bash
flt presets add coder -c codex -m gpt-5.3-codex -D "Fast coder"
flt presets add reviewer -c codex -m gpt-5.4 -D "Thorough review"
flt presets add researcher -c claude-code -m haiku -D "Web research"
```

Stored in `~/.flt/presets.json`.

## Agent Identity (SOUL.md)

Each agent can have a `~/.flt/agents/<name>/SOUL.md` defining its role, responsibilities, and hard rules. This gets injected into the agent's instruction file on spawn. Keep it short — identity and values, not reference material.

## Skills

Skills are markdown files injected into agents. Global skills in `~/.flt/skills/`, per-agent skills in `~/.flt/agents/<name>/skills/`.

```markdown
---
name: health-check
description: VPS health check procedure
cli-support: ['*']
---

SSH into the VPS and run these commands...
```

For Claude Code agents, skills become slash commands. For all other CLIs, skills are appended to the instruction file (AGENTS.md, GEMINI.md, etc.).

## Messaging

```bash
flt send mycoder "also add tests"      # human → agent
flt send parent "task complete"         # agent → parent (from inside agent)
flt send sibling "check my PR"          # agent → agent
```

Messages are tagged with `[SENDER]:` for attribution. The inbox (`m` in TUI) groups messages by sender in card-style boxes.

## Themes

9 built-in themes: `dark`, `light`, `minimal`, `catppuccin`, `gruvbox`, `tokyo-night`, `nord`, `dracula`, `one-dark`.

```
:theme dracula
```

## Model Suggestions

Autocomplete is configurable in `~/.flt/models.json`:

```json
{
  "aider": ["sonnet", "opus", "deepseek/deepseek-chat"],
  "opencode": ["gpt-5.3", "openrouter/qwen/qwen3-coder"]
}
```

## Architecture

```
~/.flt/
  state.json         # Fleet state
  config.json        # Settings, theme
  presets.json       # Spawn presets
  models.json        # Model autocomplete
  inbox.log          # Agent messages
  skills/            # Global skills
  agents/<name>/
    SOUL.md          # Agent identity
    state.md         # Agent state (for compaction)
    skills/          # Per-agent skills
```

Each agent runs in its own tmux session (`flt-<name>`). Git worktrees provide branch isolation by default.

## Status Detection

| Icon | Meaning |
|------|---------|
| `▶` | Working — actively generating |
| `⏸` | Idle — waiting at prompt |
| `○` | Exited — session died |
| `?` | Unknown |

Detection is per-CLI: spinner icon cycling for Claude Code, "esc to interrupt" for Codex, braille spinners for Gemini/OpenCode, pane-content-delta as universal fallback.

## License

MIT
