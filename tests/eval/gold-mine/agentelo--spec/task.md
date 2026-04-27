# AgentElo — Spec v1

## Context
AgentElo is an ELO-ranked AI agent benchmarking platform. Users run their AI coding agents against real GitHub bug-fix challenges, scored objectively, ranked via Glicko-2. The platform answers: "which agent SETUP (model + harness + config) is actually the best?"

Unlike SWE-bench (which benchmarks models), AgentElo benchmarks the full agent — model + instructions + skills + harness. A well-configured Haiku can outrank a vanilla Opus.

## Core Architecture

### How it works
1. User installs `agentelo` CLI
2. Runs `agentelo play --harness claude-code` (or opencode, codex, etc)
3. CLI fetches a challenge from the AgentElo API
4. Clones the challenge repo at the buggy commit to a temp dir
5. Spawns the user's harness CLI as a subprocess with stdin closed (`/dev/null`)
6. Injects the challenge prompt via the harness's non-interactive mode:
   - Claude Code: `claude -p "<prompt>" --dangerously-skip-permissions`
   - OpenCode: `opencode run "<prompt>"`
   - Codex: `codex -m <model> --full-auto "<prompt>"`
7. Opens a live viewer (tmux pane showing `tail -f` of output) — user watches but can't type
8. When the agent completes (or times out at 30 min):
   - Collects `git diff` from the challenge repo
   - Checksums repo files to detect external tampering
   - Signs the result with a session key
   - Submits: diff + session transcript + timing + token count to AgentElo API
9. API scores the submission by running the test suite against the patch
10. Glicko-2 rating updated based on performance vs other agents on the same challenge

### Challenge Prompt Template
```
You are being evaluated by AgentElo. This is an autonomous challenge — no human will respond. Do not ask questions. Fix the following issue using only the codebase and issue description provided. Work until you have a complete solution, then stop.

Issue: <issue-title>
<issue-body>

The repo is in your current working directory. Run tests with: <test-command>.
When done, your git diff will be collected and scored.
```

## Components

### 1. Challenge Miner (`bin/mine`)
- Mines GitHub issues from popular repos that have merged fix PRs
- Rolling 90-day window (only recent issues to prevent training data contamination)
- Target repos: Node.js ecosystem (express, fastify, next.js), Python (flask, django, fastapi), Go, Rust, Frontend (react, vue, svelte)
- Stores per challenge:
  - Repo URL + buggy commit SHA
  - Issue title + body
  - Known fix diff (the merged PR)
  - Test command
  - Difficulty estimate (based on lines changed, files touched)
- Challenge format: JSON manifest + git ref
- Initial target: 50-100 challenges for MVP, scale to 1000+
- Difficulty emerges naturally from agent success rates

### 2. CLI (`bin/agentelo`)
Subcommands:
- `agentelo play --harness <name>` — run a challenge
- `agentelo play --harness <name> --challenge <id>` — run specific challenge
- `agentelo leaderboard` — show rankings
- `agentelo profile` — show your agent's stats
- `agentelo challenges` — list available challenges
- `agentelo register` — register agent config (auto-hash)

Agent identity = hash of (harness + model + all config files). Changing any config file = new agent variant on the leaderboard.

### 3. Scorer (`core/scorer.js`)
- Receives: agent's git diff + challenge manifest
- Applies the patch to a clean checkout
- Runs the test suite
- Scores:
  - Tests passing: primary metric (binary — fixed or not)
  - Partial credit: % of failing tests now passing
  - Time taken: seconds
  - Token count: from session transcript
- At same accuracy, lower cost ranks higher (tiebreaker, not penalty)

### 4. Rating Engine (`core/rating.js`)
- Glicko-2 rating system
- "Games" = two agents who both attempted the same challenge
- Better score on shared challenge = win
- Equal score = draw
- More challenges attempted = lower rating deviation (more confident)
- Seeded with baselines: every model+harness combo with zero config
- Baselines run in parallel on Mac + thinkpad + VPS

### 5. API (`bin/api`)
- `POST /challenges/next` — get next challenge for an agent
- `POST /submissions` — submit a solution (diff + transcript + metadata)
- `GET /leaderboard` — ranked agents with Glicko-2 ratings
- `GET /agents/:hash` — agent profile (config, challenges attempted, rating history)
- `GET /challenges` — list challenges with difficulty stats
- `GET /challenges/:id` — challenge details

### 6. Website
- Full web app (no auth needed for MVP)
- Pages: landing/explainer, leaderboard, challenge browser, agent profiles
- Leaderboard: filterable by harness, model, language
- Agent profiles: config (public by default), rating history chart, per-challenge scores
- Responsive, clean design

## Anti-Cheat
1. **No stdin** — CLI subprocess has no input channel
2. **Live viewer only** — tmux pane shows output, no input possible
3. **Repo checksum** — files checksummed at start, compared at end, external modifications flagged
4. **Session transcript** — full log of every tool call, response, timing
5. **Statistical detection** — suspiciously fast completions or perfect scores flagged
6. **Network** — future: restrict to LLM API domains only (Docker layer)

## Agent Config
- Configs are PUBLIC on the leaderboard by default
- Agent hash = deterministic hash of all config files
- Config changes = new agent variant
- Users can have multiple variants competing
- Community can clone top-ranked configs

## Seeding / Baselines
- Run all available model+harness combos with zero config against all challenges
- Models: Claude Opus/Sonnet/Haiku, GPT-5.4/4o/mini, local models (via OpenCode)
- Harnesses: Claude Code, OpenCode, Codex
- Use Tim's subscriptions (monthly, not per-token) for Claude/GPT
- Local models are free
- Run in parallel on Mac + thinkpad-1 + VPS
- Baseline agents anchor the Glicko-2 scale

## Tech Stack
- Node.js (same as OpenFleet)
- Separate repo: ~/agentelo
- API: Express or raw http
- Database: SQLite for MVP (challenges, submissions, ratings)
- Website: static or simple React
- CLI: single binary via npm

## MVP Scope (this week)
1. Challenge miner — mine 50 issues from 5 popular repos
2. CLI — `agentelo play` with Claude Code + OpenCode support
3. Scorer — apply patch, run tests, binary pass/fail
4. Rating — Glicko-2 implementation
5. API — submissions + leaderboard endpoints
6. Website — leaderboard page + landing page
7. Baseline seeding — 5 models × 50 challenges = 250 runs

## Future (post-MVP)
- More challenge types: code review, test writing, refactoring
- Docker network isolation for stronger anti-cheat
- More harnesses: Cursor, Aider, Windsurf, Roo Code, OpenClaw
- Challenge submissions from community
- Assisted league (human+agent teams)
- API key marketplace / agent rental
- Tournament mode
