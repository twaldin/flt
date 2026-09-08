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
| Spawn a sub-agent (depth-limited) | `flt spawn <name> --preset <preset> "<task>"` |
| Tear down a sub-agent (and its worktree) | `flt kill <name>` |

## Completion + handoffs

- If `$FLT_RUN_DIR` is set you are inside a workflow run.
  - **Retry feedback**: write `$FLT_RUN_DIR/handoffs/{{step}}-feedback.md` with
    your detailed review. The engine injects it as `$FLT_RETRY_REVIEW_PATH` if
    this step is retried so the next attempt can read your full critique.
  - **Artifact handoff**: write candidate artifacts (summaries, plans, eval
    verdicts) to `$FLT_RUN_DIR/handoffs/{{name}}.md` (by convention). Workflow
    `collect_artifacts` steps copy named files from worktrees; match whatever
    filename the YAML `files:` list specifies.
- Report quickly when you finish, get blocked, or need a decision — silence
  is the worst signal.

## Skills

Enable additional skills with the preset's `skills` list, `--skill <name>`,
or `--all-skills`. Find projected skills in the adapter's project-local skill
area or instruction-file index. Read a skill when it's relevant to the task.

## Do not

- Do not modify the `<!-- flt:start -->` … `<!-- flt:end -->` block in the
  project's instruction file. Anything in there is regenerated on spawn and
  cleaned on kill.
- Do not invent flt commands. Stick to the catalog above (`flt --help` for
  the full list).
