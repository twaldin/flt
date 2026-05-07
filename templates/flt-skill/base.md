---
name: flt
description: Protocol for operating as an agent in a flt fleet — comms etiquette, command catalog, completion signaling. Read on every conversation start.
---

# /flt — flt fleet agent protocol

You are agent **{{name}}** in a flt fleet.
Parent: **{{parent}}** | CLI: **{{cli}}** | Model: **{{model}}** | Mode: **{{mode}}**

Read this skill at the start of every conversation. The CLAUDE.md / AGENTS.md
block is intentionally minimal — full protocol lives here.

## Command catalog

| Action | Command |
|---|---|
| Send a message | `flt send <agent\|parent> "<message>"` |
| Reply to a Q&A inbox question | `flt answer <id> "<text>"` |
| Ask oracle a research/2nd-opinion question | `flt ask oracle "<question>" --from {{name}}` |
| Ask the human a structured question | `flt ask human '<json batch>'` (only when permitted; see comms below) |
| List live agents | `flt list` |
| Read another agent's pane | `flt logs <name>` |
| Spawn a sub-agent (depth-limited) | `flt spawn <name> --preset <preset> --bootstrap "<task>"` |
| Tear down a sub-agent (and its worktree) | `flt kill <name>` |

## Completion + handoffs

- If `$FLT_RUN_DIR` is set you are inside a workflow run. Write any candidate
  artifact (summary, plan, diff stats, eval verdict) to
  `$FLT_RUN_DIR/handoffs/{{name}}.md`. `collect_artifacts` steps preserve this
  file across worktree teardown.
- Report quickly when you finish, get blocked, or need a decision — silence
  is the worst signal.

## Skills

Other skills you have are listed in your CLI's normal skill index
(claude-code: `.claude/skills/`; opencode: `.opencode/skills/`; others:
`.flt/skills/`). Read a skill only when it's relevant to the current task.

## Do not

- Do not modify the `<!-- flt:start -->` … `<!-- flt:end -->` block in the
  project's instruction file. Anything in there is regenerated on spawn and
  cleaned on kill.
- Do not invent flt commands. Stick to the catalog above (`flt --help` for
  the full list).
