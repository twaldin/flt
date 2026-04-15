# flt Launch Posts (v3)

---

## 1. Hacker News — Show HN

**Title:** `Show HN: flt – Manage AI coding agents across Claude Code, Codex, Gemini CLI from one terminal`

**Body:**

I'm Tim, a CS student at Purdue. I've been running Claude Code, Codex, Gemini CLI, Aider, OpenCode, and SWE-agent side by side since January. I wanted them to coordinate, so I built flt.

The core problem: each CLI is good at different things, but they all pretend they're the only tool in the room. Claude Code is best at complex refactors, Codex is fastest for straightforward fixes, Gemini has the largest context window. Choosing one means giving up the others. Running them in parallel means managing separate terminal sessions with no shared state.

flt is a tmux-native CLI that gives agents fleet awareness. Three commands: `flt spawn`, `flt send`, `flt kill`. Works the same whether a human types it, an agent runs it, or a cron job fires it. Agents message each other across CLIs. A Claude Code orchestrator can spawn a Codex coder to fix a bug and a Gemini researcher to pull docs, and they all report back through the same inbox.

The interesting engineering was in the adapters. Each CLI has completely different behavior that flt has to handle transparently:

- Claude Code signals activity through rotating star icons (✽✳✢✻✶·) in the status bar, plus a timer pattern showing elapsed seconds. Ready state is detected by checking for the prompt character and status bar simultaneously.
- Codex takes over 60 seconds to start cold. The spawn logic has to poll until ready instead of assuming a timeout means failure.
- Gemini CLI shows "Allow execution of [tool]?" prompts as numbered menus during tool calls. flt's poller detects these and sends the right keystrokes to approve, so agents spawned from cron at 3 AM don't block on human input.
- Each CLI writes its own instruction file format (CLAUDE.md, AGENTS.md, GEMINI.md). flt injects agent identity into whichever file the CLI reads, and removes it on kill.

There's a TUI built from scratch as a raw ANSI screen buffer with double-buffered damage tracking. Vim keybinds, 15 themes, agent hierarchy in a sidebar, live log streaming. DEC 2026 synchronized output so it doesn't flicker on modern terminals.

I use this daily. I have a persistent Opus orchestrator that manages my fleet, spawns task agents using different CLIs based on the job, reviews their work, and runs overnight cron jobs. It's how I build everything now.

`bun install -g @twaldin/flt-cli`
github.com/twaldin/flt

Curious if anyone else has noticed how much the CLI scaffold around a model changes agent behavior compared to just swapping the model itself.

**First comment (post within 15 min):**

Some context on the adapter work: the hardest part was detecting whether an agent is working, idle, or stuck. Every CLI does it differently. Claude Code has star icons that rotate when thinking. Gemini uses braille spinners (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏). Codex prints "esc to interrupt." OpenCode has its own braille pattern. I ended up writing a separate state machine for each one, plus a universal fallback that watches for pane content changes over a 60-second window.

The permission auto-approval was the other hard piece. Without it, any agent spawned from cron will eventually hit a dialog and sit there forever. Claude Code has `(y)` prompts, Gemini has numbered menus, Codex has a bypass flag. flt's controller polls every second and handles all of these.

Happy to answer questions about any of the adapter quirks.

---

## 2. X/Twitter — Launch Thread

**Tweet 1:**
I use Claude Code, Codex, and Gemini CLI daily. They're all good at different things, but they don't know about each other.

Built a tool so they can coordinate. Agents spawn agents, message each other across CLIs, and report back to one inbox.

[demo GIF]

**Tweet 2:**
The hard part wasn't the orchestration. It was the adapters.

Claude Code uses rotating star icons (✽✳✢✻) to show it's thinking. Gemini pops up numbered menus asking "Allow execution of [tool]?" Codex takes 60+ seconds to even boot.

Each one needed its own state machine just for "is this agent done yet?"

**Tweet 3:**
So now I run a persistent fleet from my terminal:

```
flt spawn coder --cli codex "fix the parser"
flt send coder "add tests too"
flt kill coder
```

Same commands whether I type them, an agent runs them from its session, or a cron fires them at 3 AM.

**Tweet 4:**
The TUI is raw ANSI with double-buffered damage tracking. Vim keybinds. 15 themes. Agent hierarchy in a sidebar.

I'm a college student at Purdue and this is genuinely how I build all my projects now. Persistent orchestrator + task agents + overnight crons.

[TUI screenshot]

**Tweet 5:**
Open source. MIT.

`bun install -g @twaldin/flt-cli`
github.com/twaldin/flt

If you're running agents across multiple CLIs I want to hear what harness quirks you've hit. That's the least-discussed part of this space.

---

## 3. Reddit — r/LocalLLaMA

**Title:** `Built a CLI to orchestrate AI coding agents across different harnesses — works with aider, local models, and cloud CLIs`

**Body:**

I've been running Claude Code, Codex, Gemini CLI, Aider, OpenCode, and SWE-agent side by side for a few months. The problem I kept hitting: each tool is good at something different, but switching between them means separate terminal sessions, no shared context, no coordination.

flt is a tmux-native CLI that manages agents across any of these harnesses. You spawn agents, they get their own tmux session and git worktree, and they can message each other. The same commands work whether a human types them, an agent runs them, or a cron fires them.

For local model setups specifically: aider is a first-class adapter. If you're running ollama or any OpenRouter-compatible model, flt can spawn and manage aider agents the same way it manages Claude Code or Codex agents. The orchestration layer doesn't care what model is underneath. You could have a local DeepSeek agent doing code generation while a cloud Opus agent reviews its output.

The part that took the most work was adapter-level differences. Each CLI signals idle/busy differently, handles permission prompts differently, and reads instructions from different files. Gemini uses braille spinners (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏) for activity detection. Claude Code uses rotating star icons in its status bar. Codex takes 60+ seconds to start. flt handles all of this so you don't have to.

There's a TUI with vim keybinds, 15 themes, live log streaming, and an agent sidebar showing the full hierarchy.

`bun install -g @twaldin/flt-cli`
github.com/twaldin/flt

Anyone running multi-agent setups with local models? Curious what harness-level issues you've run into.

---

## 4. Reddit — r/ClaudeAI

**Title:** `I automated Claude Code's permission prompts, status detection, and inter-agent messaging`

**Body:**

I run multiple Claude Code agents simultaneously and needed them to not stall on permission dialogs, to reliably detect when they're done working, and to be able to talk to each other.

I built flt to solve this. It manages Claude Code agents (and 5 other CLIs) through tmux. Here's what I figured out about Claude Code's internals that might be useful:

**Status detection.** Claude Code shows rotating star icons (✽✳✢✻✶·) in the status bar when thinking, plus a timer showing elapsed time like `(45s)` or `(2m 30s)`. flt checks for the prompt character plus the status bar to detect ready state. When neither is present but the timer pattern is visible, the agent is running. ANSI escape codes have to be stripped first or the pattern matching breaks on the raw tmux pane capture.

**Permission auto-approval.** The controller polls every second for dialog patterns. When a `(y)` prompt or workspace trust dialog appears, it sends the right keystrokes automatically. This is what makes cron-spawned agents work at 3 AM without blocking on human input.

**Git worktrees.** Each agent gets its own worktree so parallel agents can't stomp on each other's files. The orchestrator reviews and merges work back.

**Instruction injection.** flt prepends a fleet identity block into CLAUDE.md (wrapped in HTML comment markers) that tells the agent its name, parent, and how to message siblings. The block gets removed cleanly on kill.

**Inter-agent messaging.** `flt send agent-name "message"` drops a tagged message into the target's tmux session. An orchestrator can spawn a coder, wait for completion, spawn a reviewer, and merge the result. I run a persistent Opus orchestrator that does this daily with haiku for cheap tasks, sonnet for normal work, opus for thorough review.

`bun install -g @twaldin/flt-cli`
github.com/twaldin/flt

---

## 5. Reddit — r/commandline

**Title:** `flt — tmux-native agent manager for AI coding CLIs`

**Body:**

[demo GIF]

Spawns AI coding agents in tmux sessions across 6 supported CLIs. Agents message each other, get git worktree isolation, and auto-approve permission prompts.

```bash
flt spawn coder --cli codex "fix the parser"
flt send coder "add tests"
flt logs coder
flt kill coder
```

TUI with vim keybinds, 15 themes, agent sidebar. Raw ANSI screen buffer, not a framework.

`bun install -g @twaldin/flt-cli`
github.com/twaldin/flt

---

## 6. Discord — Anthropic/Claude Server

**#showcase:**

I run multiple Claude Code agents from one terminal with flt. They can spawn each other, send messages, and report back.

Status detection watches for Claude Code's rotating star icons (✽✳✢✻✶·) and the timer pattern in the status bar. Permission prompts get auto-approved so cron-spawned agents don't block at 3 AM. Each agent gets a git worktree.

I have a persistent Opus orchestrator that manages my fleet. Haiku for cheap stuff, sonnet for normal tasks, opus for review. Overnight crons handle monitoring and compaction.

`bun install -g @twaldin/flt-cli` | github.com/twaldin/flt

---

## 7. Discord — OpenAI Server

**#projects:**

Built flt, a tmux-native CLI for managing AI coding agents across different harnesses. Codex is one of six supported CLIs.

Codex adapter quirks I solved:
- Takes 60+ seconds to start cold. flt polls until ready instead of timing out.
- Needs `--dangerously-bypass-approvals-and-sandbox` for unattended operation.
- "Update available" banner is cosmetic, not a blocking dialog.
- Status detection looks for "esc to interrupt" in the full pane, not just the last few lines.

Agents can message each other across CLIs, spawn children, and report back. TUI with vim keybinds shows everything.

`bun install -g @twaldin/flt-cli` | github.com/twaldin/flt
