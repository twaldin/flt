tim: Research who and what (ideally, research actual papers/academic research, GitHub is second best I guess, stars etc) are actually building and shipping code with large agent swarms? Feels like a massive “hype” but also feels possible, especially if you use dspy and gepa to make each leg of the swarm fully optimized per task? How could I make a self evolving ever growing swarm where I kinda just throw ideas in, and it gets fully built from 0-100 (raising real blockers to me somehow?)

GPT: The honest read: **“large agent swarms building whole products 0→100” is still mostly hype**, but **small, structured teams of agents + strong eval loops + sandboxed execution + human review are very real**. The serious systems are not “100 chatbots debating.” They are closer to: planner → implementer(s) → reviewer/tester → verifier → PR, with parallel attempts and measured selection.

## Who is actually doing real work here?

### 1. OpenHands / OpenDevin — strongest open-source “real agent platform” signal

OpenHands is one of the most credible open-source software-agent platforms. The ICLR/OpenReview paper describes agents that work like human developers: write code, use a command line, browse the web, run in sandboxed environments, coordinate multiple agents, and plug into benchmarks. The project also reports broad community scale: the paper says it reached more than 2,000 contributions from 186+ contributors in under six months. ([arXiv][1])

The newer OpenHands Software Agent SDK paper is even more relevant to what you want: it explicitly frames itself as a production-ready SDK with local/remote execution portability, REST/WebSocket services, model-agnostic routing, sandboxing, lifecycle control, memory, and custom tools. It says OpenHands had 64k+ GitHub stars by then. ([arXiv][2])

Why it matters for you: **this is closest to “build a real platform, not just prompts.”** The valuable part is not swarm roleplay; it is execution isolation, lifecycle, logs, workspace control, and eval integration.

---

### 2. SWE-agent / mini-SWE-agent — proof that interface and tool design matter more than “swarm size”

SWE-agent’s paper argues that LLM agents need their own “agent-computer interface” for repo navigation, editing, testing, and command execution. It achieved strong results for its time on SWE-bench and HumanEvalFix, and the repo frames it as an agent that can autonomously use tools to fix real GitHub issues or perform custom tasks. ([arXiv][3])

SWE-bench’s current leaderboard also highlights mini-SWE-agent as a tiny but strong baseline, including claims of 65%+ and 74% on SWE-bench Verified depending on version/result. ([SWE-bench][4])

Why it matters: **a better harness can beat a bigger “team.”** Before building 50 agents, build the best terminal/editor/test interface for one agent.

---

### 3. MetaGPT and ChatDev — the canonical “software company as agents” research line

MetaGPT is the classic “software company as multi-agent system” paper/project: product manager, architect, project manager, engineers, SOPs, and structured artifacts. The paper says MetaGPT encodes standardized operating procedures into prompt sequences so agents verify intermediate results and reduce errors. ([arXiv][5])

ChatDev is similar: specialized agents communicate through a “chat chain” and “communicative dehallucination” across design, coding, and testing phases. Its GitHub project now says ChatDev 2.0 evolved from a software-development-specific framework into a more general multi-agent orchestration platform. ([ACL Anthology][6])

My read: these are important academically, but a lot of the “virtual software company” framing is too theatrical. The useful part is **artifact passing and phase gates**: PRD, design, implementation, test plan, review report.

---

### 4. AutoGen / CrewAI-style frameworks — useful orchestration, not necessarily best coding harnesses

AutoGen is a general multi-agent framework for conversable agents with tools and human input. It is widely adopted, but it is not specifically optimized around repo editing the way SWE-agent/OpenHands/Codex/Claude Code are. ([GitHub][7])

These are good when your agents are doing research, planning, support workflows, RAG, or business automation. For **shipping code**, I would treat them as orchestration inspiration, not the core execution layer.

---

### 5. Agentless — important counterexample: simpler pipelines can beat “agentic” complexity

Agentless is the paper/project you should keep taped to the wall. It deliberately avoids full agent autonomy and instead uses localization → repair → patch validation. The paper argues this simpler setup avoids some limitations of complex agent systems and reports strong SWE-bench Lite results at low cost. ([arXiv][8])

This is the anti-hype lesson: **sometimes the winning system is not a swarm; it is a tight deterministic pipeline with multiple samples and a verifier.**

---

### 6. AFlow, GEPA, Live-SWE-agent — the strongest evidence for “self-improving scaffolds”

AFlow is highly relevant to your “hone/GEPA but for workflows” idea. It automatically discovers and optimizes agentic workflows using Monte Carlo Tree Search over code-represented workflows, with execution feedback. The paper reports an average 5.7% improvement over state-of-the-art baselines and cases where smaller models beat GPT-4o at 4.55% of the inference cost. ([OpenReview][9])

GEPA is directly aligned with your intuition. The project describes optimizing textual parameters — prompts, code, agent architectures, configs — using LLM reflection, full execution traces, mutation, and Pareto-aware selection. DSPy’s GEPA docs call it an evolutionary optimizer for text components of complex systems. ([Gepa AI][10])

Live-SWE-agent is probably the closest paper to “self-evolving coding agent.” It claims the agent starts from a basic bash-only scaffold and evolves its own scaffold while solving real-world software problems, reporting 75.4% on SWE-bench Verified without test-time scaling and 45.8% on SWE-bench Pro. Treat those numbers as “needs reproduction,” but conceptually this is exactly the research direction you’re describing. ([arXiv][11])

My take: **this is where the real frontier is**. Not “more agents,” but **agents that mutate their own workflows/prompts/tools and keep the variants that score better.**

---

## What companies are actually shipping?

Cognition’s Devin is the clearest proprietary “agent as teammate” product. Cognition says Devin is used at thousands of companies, including Goldman Sachs, Santander, and Nubank, and claims it has merged hundreds of thousands of PRs. That is vendor-provided, but it is still a strong signal that long-running coding agents are no longer purely demos. ([Cognition][12])

Factory is another serious one. Its Code Droid technical report claims 19.27% on SWE-bench Full and 31.67% on SWE-bench Lite in 2024, and later Factory positioned itself around enterprise “Droids” for task-specific software work. ([Factory.ai][13])

Cursor, GitHub, and Google are all converging on the same product shape: **parallel/background agents in isolated workspaces, with plans, artifacts, review, and human approval**. Cursor’s long-running agents blog says they use a plan and multiple agents checking each other’s work. GitHub announced agent management directly inside GitHub with Codex, Claude, Jules, Devin, and others. Google’s Antigravity uses multiple agents with editor, terminal, browser access and “Artifacts” like plans, screenshots, task lists, and recordings. ([Cursor][14])

So yes: the market is validating the broad direction. But the production pattern is **not uncontrolled swarms**. It is **bounded delegation + isolated environments + observable artifacts + PR review**.

## The architecture I’d build for your “self-evolving ever-growing swarm”

I would not start with “swarm.” I would start with a **software factory runtime**:

```text
Idea Inbox
  ↓
Spec Agent
  ↓
Task Graph / Issue Splitter
  ↓
Parallel Worktrees / Containers
  ↓
Implementation Agents
  ↓
Test + Browser + Lint + Typecheck + Security Gates
  ↓
Reviewer / Critic Agents
  ↓
Patch Tournament / Merge Selector
  ↓
Human Blocker Escalation
  ↓
Memory + Trace Store
  ↓
GEPA/AFlow/Hone Optimizer
  ↓
Improved prompts, tools, workflows, skills, task splitters
```

The central insight: **the swarm should not be “agents talking.” The swarm should be “competing and cooperating attempts against objective gates.”**

For your stack, I’d map it like this:

```text
flt        = session/process orchestration
harness    = model/harness adapter + token/cost tracking + workdir management
hone       = evolutionary optimizer over prompts/configs/workflows/repos
agentelo   = pairwise evaluation / Bradley-Terry ranking of variants
terminal-bench/SWE-bench/custom evals = objective scoring
browser e2e tests = real app completion signal
```

## The minimum viable version

Your first version should be boring and powerful:

1. User gives idea.
2. Planner creates `spec.md`, `acceptance.md`, `tasks.json`.
3. System spawns 3–5 independent implementation agents in separate git worktrees.
4. Each agent must produce:

   * code diff
   * test results
   * browser screenshots or recordings if UI
   * blocker report
   * self-review
5. A judge agent compares outputs against acceptance tests.
6. Best patch gets merged into an integration branch.
7. A final verifier runs clean install, tests, lint, typecheck, e2e.
8. Anything ambiguous becomes a structured question to you.

That already beats most “swarm” projects.

The blocker report should be machine-readable:

```json
{
  "status": "blocked",
  "blocking_type": "missing_secret | product_decision | external_api | impossible_test | unclear_requirement | auth_needed",
  "question_for_human": "Should login support Google OAuth or email/password for v1?",
  "options": [
    {"id": "A", "label": "Google OAuth only", "impact": "fastest"},
    {"id": "B", "label": "Email/password", "impact": "more backend work"},
    {"id": "C", "label": "Both", "impact": "more complete but slower"}
  ],
  "recommended_option": "A",
  "current_progress": "Frontend shell and DB schema are done."
}
```

That is how it “raises real blockers” instead of silently failing.

## Where DSPy/GEPA fits

Do **not** GEPA-optimize the whole swarm at first. Optimize individual “legs” with measurable tasks.

Good targets:

```text
spec_writer_prompt
task_decomposer_prompt
implementation_agent_system_prompt
reviewer_prompt
test_writer_prompt
browser_verifier_prompt
blocker_classifier_prompt
merge_judge_prompt
```

Each optimizer needs a dataset. Your dataset can be your own historical tasks:

```text
input: idea/spec/repo state
candidate output: plan/diff/review/test
score:
  + tests pass
  + e2e pass
  + smaller diff
  + fewer human interventions
  + reviewer found no critical issue
  + no security regression
  - cost
  - time
  - flaky tests
  - ungrounded claims
```

This is where GEPA is perfect: let it read full traces — failed commands, test output, browser logs, diffs, review comments — and mutate the prompts/tools/workflow. GEPA’s own description emphasizes using execution traces rather than reducing everything to a scalar reward. ([GitHub][15])

## The “ever-growing” part: agent skill library, not infinite agents

The scalable version is not 1,000 persistent personalities. It is a growing library of **skills and workflows**:

```text
skills/
  nextjs-shadcn-dashboard/
  express-mongodb-api/
  stripe-subscription-flow/
  playwright-auth-test/
  chrome-debug-ui-bug/
  vite-deploy-vercel/
  discord-bot-command/
  github-action-ci-fix/
```

Each skill has:

```text
README.md          # when to use
procedure.md       # exact steps
tools.json         # allowed commands/APIs
evals/             # tests proving the skill works
examples/          # successful traces
failure_modes.md   # known traps
```

Then the planner routes tasks to skills. GEPA/hone improves the skills over time. This is much more useful than naming agents “Frontend Bob” and “QA Alice.”

## The hard truth

The 0→100 autonomous product builder is possible for **small, well-scoped apps**. It is not reliable yet for ambiguous startups, production auth/security/payments, unknown product taste, or weird deployment constraints without human intervention.

The systems that work all share five properties:

They use **sandboxed workspaces**.

They use **git branches/worktrees per attempt**.

They use **objective evals**: tests, e2e, lint, typecheck, benchmark scores.

They use **human approval at merge/deploy/product-decision boundaries**.

They store **full traces** and optimize from failures.

Your opportunity is not “make a swarm.” Your opportunity is:

> Build the harness/runtime that turns coding agents into an evaluated, self-improving software factory.

That is actually credible. It connects directly to SWE-agent/OpenHands/AFlow/GEPA/Live-SWE-agent instead of just copying the hype layer.

## My recommended build order

First, build **parallel worktree execution** in `flt`: spawn N agents against the same task, each isolated, each producing a diff and trace.

Second, build **artifact contracts**: every agent must output `plan.md`, `changes.md`, `test-results.json`, `blockers.json`, and `handoff.md`.

Third, build **automatic scoring**: tests pass, e2e pass, diff size, cost, runtime, reviewer score, merge conflicts.

Fourth, build **patch tournament selection** using your `agentelo` instincts: pairwise compare candidate diffs and rank them with Bradley-Terry or a simpler Elo-like model.

Fifth, add **hone/GEPA optimization** over prompts and workflows once you have 30–100 saved task traces.

Sixth, add **skill memory**: successful task traces become reusable procedures.

The big product wedge could be:

> “I don’t sell you another coding agent. I run all your coding agents in parallel, measure them, merge the best result, and improve the workflow over time.”

That is a much stronger thesis than “AI swarm.” It is measurable, benchmarkable, and directly useful to power users who already pay for Codex, Claude Code, opencode, Cursor, Devin, Factory, etc.

* [The Verge](https://www.theverge.com/news/808032/github-ai-agent-hq-coding-openai-anthropic?utm_source=chatgpt.com)
* [The Verge](https://www.theverge.com/news/822833/google-antigravity-ide-coding-agent-gemini-3-pro?utm_source=chatgpt.com)
* [businessinsider.com](https://www.businessinsider.com/google-ai-generated-code-75-gemini-agents-software-2026-4?utm_source=chatgpt.com)

[1]: https://arxiv.org/abs/2407.16741?utm_source=chatgpt.com "OpenHands: An Open Platform for AI Software Developers ..."
[2]: https://arxiv.org/abs/2511.03690?utm_source=chatgpt.com "The OpenHands Software Agent SDK: A Composable and Extensible Foundation for Production Agents"
[3]: https://arxiv.org/abs/2405.15793?utm_source=chatgpt.com "SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering"
[4]: https://www.swebench.com/?utm_source=chatgpt.com "SWE-bench Leaderboards"
[5]: https://arxiv.org/abs/2308.00352?utm_source=chatgpt.com "MetaGPT: Meta Programming for A Multi-Agent ..."
[6]: https://aclanthology.org/2024.acl-long.810.pdf?utm_source=chatgpt.com "ChatDev: Communicative Agents for Software Development"
[7]: https://github.com/aipengineer/awesome-opensource-ai-engineering/blob/main/libraries/autogen/README.md?utm_source=chatgpt.com "Autogen - aipengineer/awesome-opensource-ai-engineering"
[8]: https://arxiv.org/abs/2407.01489?utm_source=chatgpt.com "[2407.01489] Agentless: Demystifying LLM-based Software ..."
[9]: https://openreview.net/forum?id=z5uVAKwmjf&utm_source=chatgpt.com "AFlow: Automating Agentic Workflow Generation"
[10]: https://gepa-ai.github.io/gepa/?utm_source=chatgpt.com "GEPA: Optimize Anything with LLMs"
[11]: https://arxiv.org/abs/2511.13646?utm_source=chatgpt.com "Live-SWE-agent: Can Software Engineering Agents Self-Evolve on the Fly?"
[12]: https://cognition.ai/blog/devin-annual-performance-review-2025?utm_source=chatgpt.com "Devin's 2025 Performance Review: Learnings From 18 ..."
[13]: https://factory.ai/news/code-droid-technical-report?utm_source=chatgpt.com "Code Droid: A Technical Report"
[14]: https://cursor.com/blog/long-running-agents?utm_source=chatgpt.com "Expanding our long-running agents research preview"
[15]: https://github.com/gepa-ai/gepa?utm_source=chatgpt.com "gepa-ai/gepa: Optimize prompts, code, and more with AI- ..."

Tim: This is kinda interesting, the “parallel tries” could we even kinda do a/b testing? How to turn my own flt into gepa ready data so every file (every agent .md file, every skill file, etc) are all fully optimized?

GPT: Yes. The best framing is:

> `flt` should become an **experiment runner for agent workflows**, where every agent prompt, skill file, workflow graph, model, harness, and tool policy is a versioned treatment, and every task run produces training data for GEPA/hone.

This is much more concrete than “swarm.” You are basically building **Optuna/W&B/CI for coding agents**, except the optimizable artifacts are Markdown prompts, skill docs, routing policies, and workflow code.

GEPA is specifically designed around this kind of thing: DSPy describes GEPA as capturing full execution traces, reflecting on the parts tied to a predictor, and proposing improved instructions; the GEPA repo describes it as optimizing textual parameters against arbitrary metrics using full traces rather than just scalar rewards. ([DSPy][1])

## The core idea

Every file like this becomes an optimizable variable:

```text
agents/planner.md
agents/implementer.md
agents/reviewer.md
agents/tester.md
agents/browser-debugger.md
skills/nextjs-shadcn.md
skills/express-mongodb.md
skills/playwright-e2e.md
workflows/default-build.yaml
routing/model_policy.yaml
```

Each one gets a version hash:

```text
agents/implementer.md@sha256:abc123
skills/playwright-e2e.md@sha256:def456
workflow/default-build.yaml@sha256:999aaa
```

Then every `flt run` logs:

```text
task_id
repo_snapshot
idea/spec
agent file versions
skill file versions
workflow version
model/harness used
commands run
diff produced
tests run
browser screenshots
review comments
cost
duration
human interventions
final outcome
```

That gives you the raw material for A/B testing and GEPA. DSPy’s optimizer docs make the same shape explicit: an optimizer needs a program, a metric, and training inputs; GEPA adds trace-aware reflective mutation over the textual components. ([DSPy][2])

## A/B testing for agents

At the simplest level, yes: run two versions of a prompt/skill against the same task distribution.

Example:

```text
Treatment A:
  agents/implementer.md v12
  skills/nextjs-shadcn.md v4

Treatment B:
  agents/implementer.md v13
  skills/nextjs-shadcn.md v4
```

Then compare:

```text
pass_rate
e2e_pass_rate
reviewer_accept_rate
avg_cost
avg_duration
human_blocker_rate
rollback_rate
diff_size
merge_conflict_rate
```

For coding agents, I would not use normal web-product A/B testing logic where users are the subjects. Your “subjects” are **tasks**. The more useful design is:

```text
same task
same repo snapshot
same acceptance criteria
same model budget
different prompt/skill/workflow version
compare output
```

That is closer to a randomized benchmark tournament.

## The actual schema I’d use

Make `flt` emit one run folder per attempt:

```text
.flt/runs/
  2026-04-25T18-22-10Z_task-auth-login_attempt-01/
    manifest.json
    task.md
    repo.patch
    final.diff
    plan.md
    transcript.jsonl
    commands.jsonl
    tool_calls.jsonl
    test_results.json
    browser_results.json
    review.json
    blockers.json
    metrics.json
    artifacts/
      screenshot-1.png
      playwright-trace.zip
      coverage.xml
```

The important file is `manifest.json`:

```json
{
  "run_id": "run_01HV...",
  "task_id": "auth-login-v1",
  "repo": {
    "name": "tradeupbot",
    "base_commit": "4d2c9a1",
    "worktree": "/tmp/flt/worktrees/auth-login-v1/a"
  },
  "treatment": {
    "workflow": {
      "path": "workflows/default-build.yaml",
      "version": "sha256:999aaa"
    },
    "agents": {
      "planner": "agents/planner.md@sha256:111",
      "implementer": "agents/implementer.md@sha256:222",
      "reviewer": "agents/reviewer.md@sha256:333",
      "tester": "agents/tester.md@sha256:444"
    },
    "skills": [
      "skills/nextjs-shadcn.md@sha256:def456",
      "skills/playwright-e2e.md@sha256:aaa111"
    ],
    "model_policy": "routing/model_policy.yaml@sha256:777"
  },
  "runtime": {
    "harness": "opencode",
    "model": "gpt-5.4-high",
    "max_cost_usd": 8.0,
    "max_wall_minutes": 45
  }
}
```

And `metrics.json`:

```json
{
  "outcome": "accepted",
  "scores": {
    "unit_tests": 1.0,
    "typecheck": 1.0,
    "lint": 1.0,
    "e2e": 0.75,
    "reviewer_score": 0.82,
    "human_accept": 1.0,
    "security_score": 0.9
  },
  "cost": {
    "usd": 3.42,
    "input_tokens": 812000,
    "output_tokens": 59000
  },
  "time": {
    "wall_seconds": 1680
  },
  "patch": {
    "files_changed": 14,
    "lines_added": 622,
    "lines_deleted": 188
  },
  "blockers": []
}
```

This is “GEPA-ready” because it gives the optimizer both **scalar metrics** and **textual failure context**. GEPA’s key advantage is that it can use rich textual feedback like logs, error messages, failed parses, code traces, and human feedback instead of only a reward number. ([The Data Quarry][3])

## What the GEPA training example should look like

For each failed or mediocre run, generate a compact trace bundle:

```json
{
  "optimizable_file": "agents/implementer.md",
  "current_content": "...",
  "task": "Add email/password auth to the app",
  "score": 0.54,
  "failure_summary": {
    "tests_failed": [
      "auth.spec.ts: should reject invalid password",
      "signup.spec.ts: should enforce unique email"
    ],
    "reviewer_findings": [
      "Password hashing used but no rate limiting",
      "No migration added for user table",
      "Frontend assumes API returns token but backend returns session object"
    ],
    "human_feedback": "It got close but missed schema/migration and contract matching."
  },
  "trace_excerpt": [
    "npm test failed because users.email column does not exist",
    "Playwright login failed: expected /dashboard but stayed on /login"
  ],
  "desired_change": "Improve the implementer instructions so it checks DB schema, frontend-backend contracts, and e2e login path before declaring done."
}
```

GEPA/hone then proposes a mutation to `agents/implementer.md`.

The important constraint: **do not let the optimizer rewrite everything at once**. Optimize one file or one module at a time, or attribution becomes impossible.

## How to do attribution

This is the hardest part. If a run uses:

```text
planner v3
implementer v12
reviewer v8
skill-nextjs v4
workflow v2
```

and it fails, which file caused the failure?

You need three layers.

First: **module-level trace ownership**.

Every agent output should have an owner:

```json
{
  "span_id": "span_implementer_04",
  "owner": "agents/implementer.md@sha256:222",
  "input": "...",
  "output": "...",
  "downstream_failures": [
    "unit_test_failure",
    "reviewer_critical_issue"
  ]
}
```

Second: **critic attribution**.

Have the reviewer classify failures:

```json
{
  "failure": "Frontend expected token but backend returned session object",
  "likely_causes": [
    {
      "artifact": "agents/implementer.md",
      "confidence": 0.65,
      "reason": "Implementer did not verify frontend API contract before coding."
    },
    {
      "artifact": "skills/express-api.md",
      "confidence": 0.25,
      "reason": "Skill doc lacks API contract checklist."
    },
    {
      "artifact": "agents/planner.md",
      "confidence": 0.10,
      "reason": "Plan did not include explicit contract extraction."
    }
  ]
}
```

Third: **controlled reruns**.

When a mutation looks promising, rerun it with everything else held constant:

```text
A = old implementer.md + same planner/reviewer/skill/task/model
B = new implementer.md + same planner/reviewer/skill/task/model
```

That is your A/B test.

## The optimization loop

Your `hone` loop could look like this:

```text
1. Select target artifact:
   agents/implementer.md

2. Pull failure cases where that artifact is implicated.

3. Build GEPA trace bundle:
   current file content + task inputs + outputs + logs + reviews + scores.

4. Ask optimizer to propose K mutations.

5. Run each mutation on held-out tasks.

6. Score with objective metrics.

7. Promote mutation only if it improves Pareto front:
   higher success
   lower cost
   lower blocker rate
   no worse security
   no worse diff quality

8. Commit promoted artifact:
   agents/implementer.md v13

9. Archive losing variants.
```

This is basically AFlow/GEPA thinking adapted to your repos. AFlow is relevant because it treats agent workflow generation as a search problem over code-represented workflows and uses execution feedback to refine them; that is exactly the direction you want once you move from optimizing `.md` files to optimizing workflow graphs. ([Emergent Mind][4])

## Start with bandits before full GEPA

Before you do fancy evolution, implement a simple multi-armed bandit.

Example:

```text
implementer variants:
  v12: 40 runs, 62% accepted, avg $4.10
  v13: 12 runs, 75% accepted, avg $4.80
  v14: 8 runs, 50% accepted, avg $2.20
```

Routing policy:

```text
mostly use current best
sometimes explore new variants
retire variants that are clearly worse
```

Use something simple:

```text
score = accept_rate
      + 0.2 * e2e_pass_rate
      - 0.05 * avg_cost_usd
      - 0.02 * avg_minutes
      - 0.3 * security_failure_rate
```

Then GEPA becomes the **variant generator**, and your bandit/eval system becomes the **variant selector**.

That separation is important:

```text
GEPA/hone = propose better artifacts
flt/eval = prove whether they are better
```

## What “fully optimized every file” should mean

Do not optimize every Markdown file continuously. That creates prompt drift and destroys reliability.

Use promotion channels:

```text
main/
  agents/implementer.md        # stable

experiments/
  agents/implementer.v13.md    # candidate

archive/
  agents/implementer.v9.md     # old
```

A file graduates only if it beats stable on a held-out suite.

Use semantic versioning:

```text
implementer.md v1.4.2
  major = changed role / workflow contract
  minor = improved behavior
  patch = wording/format fixes
```

And store a changelog:

```md
## v1.4.2
- Added API contract extraction checklist.
- Added DB migration verification.
- Added "run e2e before done" requirement.
Evidence:
- +11% accept rate on auth/backend tasks.
- No cost regression.
- Failed on one Prisma migration task; needs follow-up.
```

This makes the system auditable instead of “the prompt magically changed.”

## The data model I’d build in SQLite first

Do not overbuild. Start with SQLite/Postgres tables:

```sql
CREATE TABLE artifacts (
  artifact_id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  kind TEXT NOT NULL, -- agent_prompt, skill, workflow, model_policy
  content_hash TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  parent_artifact_id TEXT
);

CREATE TABLE tasks (
  task_id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  base_commit TEXT NOT NULL,
  task_text TEXT NOT NULL,
  acceptance_text TEXT,
  tags TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  treatment_id TEXT NOT NULL,
  outcome TEXT,
  total_score REAL,
  cost_usd REAL,
  wall_seconds INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE treatment_artifacts (
  treatment_id TEXT NOT NULL,
  role TEXT NOT NULL,
  artifact_id TEXT NOT NULL
);

CREATE TABLE run_metrics (
  run_id TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_value REAL NOT NULL
);

CREATE TABLE run_failures (
  run_id TEXT NOT NULL,
  failure_type TEXT NOT NULL,
  failure_text TEXT NOT NULL,
  blamed_artifact_id TEXT,
  confidence REAL
);
```

This is enough to ask:

```text
Which implementer prompt wins on Next.js tasks?
Which reviewer prompt catches the most real failures?
Which skill file reduces auth-task blocker rate?
Which workflow is cheapest while keeping e2e pass rate above 80%?
```

## What a `flt` command surface could look like

```bash
flt task create \
  --repo ./myapp \
  --idea "Build billing settings page with Stripe customer portal" \
  --acceptance acceptance.md \
  --tags nextjs,stripe,billing

flt experiment run \
  --task billing-settings \
  --workflow workflows/default-build.yaml \
  --variants agents/implementer.md=stable,candidate \
  --n 6 \
  --parallel 3

flt experiment compare \
  --task billing-settings \
  --by agents/implementer.md

flt optimize gepa \
  --target agents/implementer.md \
  --from-failures last-50 \
  --metric composite_acceptance \
  --emit experiments/agents/implementer.vNext.md

flt promote \
  --artifact experiments/agents/implementer.vNext.md \
  --if "accept_rate +10%, security_regression=0, cost_regression<15%"
```

## Your first milestone

Build this first:

```text
Parallel tries against the same task:
  3 agents
  3 worktrees
  same prompt except one controlled variable
  collect diffs/tests/cost
  reviewer ranks outputs
  choose winner
```

Then add this:

```text
Prompt/skill variant registry:
  every .md file hashed
  every run records exact hash
  compare variants over time
```

Then add GEPA:

```text
Use failed runs to mutate one target .md file
Run candidate against held-out tasks
Promote only with evidence
```

That gives you the “self-evolving” loop without pretending the system is magically autonomous.

## The key product insight

Your `flt` should not say:

> “I made an AI swarm.”

It should say:

> “I can run 5 coding agents against the same task, measure which prompt/skill/workflow actually works, merge the best patch, and evolve the system from real failure traces.”

That is way more defensible, and it gives you the benchmark/data moat you keep circling around.

[1]: https://dspy.ai/api/optimizers/GEPA/overview/?utm_source=chatgpt.com "dspy.GEPA: Reflective Prompt Optimizer"
[2]: https://dspy.ai/learn/optimization/optimizers/?utm_source=chatgpt.com "Optimizers"
[3]: https://thedataquarry.com/blog/learning-dspy-3-working-with-optimizers?utm_source=chatgpt.com "Learning DSPy (3): Working with optimizers"
[4]: https://www.emergentmind.com/topics/agentic-process-automation-apa?utm_source=chatgpt.com "Agentic Process Automation (APA)"

Tim: These are expensive tasks? How can gepa optimize in place? Or I just need to every once in a while train on tests I’ve run? Or can “each new task be a run for brand new, proposed, agent configs?” And multiple of them? (n for number of agents)

GPT: So maybe a cron that spawns a mutator once per day?

Tim: Yes — **a daily cron mutator is a good shape**, as long as it **does not auto-promote changes**.

Think of it as:

```text
daily mutator = propose candidate improvements
eval runner   = test them on a small suite
promoter      = only merge if evidence clears thresholds
```

The safe daily loop:

```text
1. Collect yesterday’s traces:
   failed runs, expensive runs, human-rejected runs, blocker reports.

2. Pick one target artifact:
   agents/implementer.md
   or agents/reviewer.md
   or skills/playwright-e2e.md

3. Spawn a mutator agent:
   “Given these traces, propose one minimal improvement.”

4. Write candidate to:
   experiments/agents/implementer.vNext.md

5. Run a small eval:
   3-5 representative tasks, same base commits, same budget.

6. Generate a report:
   accept rate, test pass rate, cost, duration, regressions.

7. Open a PR / branch:
   do not overwrite stable automatically.

8. Promote only if thresholds pass.
```

I’d make the cron conservative:

```bash
0 3 * * * cd ~/src/flt && flt optimize daily --max-candidates 3 --max-eval-cost 20
```

And config like:

```yaml
daily_mutator:
  enabled: true
  schedule: "03:00"
  target_selection:
    strategy: highest_failure_attribution
    max_targets_per_day: 1

  mutation:
    max_candidates: 3
    mutation_style: minimal_diff
    forbidden:
      - rewrite_all_prompts
      - remove_safety_checks
      - weaken_test_requirements
      - increase_budget_without_reason

  eval:
    tasks: 5
    require_same_base_commit: true
    max_total_cost_usd: 20
    compare_against_stable: true

  promotion:
    auto_promote: false
    require_human_review: true
    min_accept_rate_delta: 0.10
    max_cost_regression: 0.15
    max_duration_regression: 0.20
    require_no_security_regression: true
```

The mutator should output a patch plus a claim:

```json
{
  "target": "agents/implementer.md",
  "hypothesis": "Adding a frontend/backend contract checklist will reduce e2e failures where API shapes mismatch.",
  "change_summary": "Added a required contract-extraction step before implementation.",
  "expected_metric_improvement": "Higher e2e pass rate on full-stack tasks.",
  "risk": "Slightly longer planning phase.",
  "candidate_path": "experiments/agents/implementer.contract-check.v1.md"
}
```

The key thing: **daily mutation, weekly promotion** might be even better.

Daily:

```text
Generate candidates.
Run cheap evals.
Save reports.
```

Weekly:

```text
Take the best candidates.
Run a larger held-out eval.
Promote winners.
Archive losers.
```

So your loop becomes:

```text
Every normal task:
  log traces

Every night:
  mutate one artifact from recent failures

Every week:
  run tournament over candidates

Every promotion:
  update stable agent/skill files with evidence
```

For `flt`, I’d name the commands something like:

```bash
flt trace collect --since 24h
flt mutate daily --target auto --max-candidates 3
flt eval candidates --suite smoke --budget 20
flt report latest
flt promote candidate-id --require-review
```

One important detail: the daily mutator should usually optimize **boring checklist/skill behavior**, not agent “personality.” Most wins will be things like:

```text
Before coding, inspect existing package manager and scripts.
Before backend changes, inspect frontend API calls.
After DB changes, run migration/schema checks.
After UI changes, run Playwright or browser smoke test.
When blocked, emit structured blocker JSON instead of guessing.
Before declaring done, run clean install/test from repo root.
```

That is where self-improvement becomes real.

So yes: **cron once per day is the right primitive**. Just make it a **candidate generator + evaluator**, not an unsupervised prompt overwriter.

Yes — store **every human message**, but separate it into **replay logs** and **optimization datasets**.

You want the raw conversation preserved so sessions can resume, audits are possible, and future optimizers can reconstruct what happened. But you do **not** want every casual human message blindly fed into GEPA, because some messages are noise, secrets, emotional/frustrated context, or project-specific one-offs.

A good structure:

```text
.flt/
  sessions/
    session_2026-04-25_auth-login/
      messages.jsonl        # full human/agent/tool transcript
      state.json            # resumable session state
      artifacts/
      patches/
      traces/

  runs/
    run_01/
      manifest.json
      metrics.json
      commands.jsonl
      tool_calls.jsonl
      diff.patch
      test_results.json
      blocker_report.json

  datasets/
    optimization/
      examples.jsonl        # curated/redacted training examples
    eval/
      tasks.jsonl           # reusable held-out eval tasks
```

For `messages.jsonl`, I’d log each message like:

```json
{
  "ts": "2026-04-25T22:14:31Z",
  "session_id": "sess_auth_login_001",
  "run_id": "run_01",
  "role": "human",
  "source": "cli",
  "content": "Make sure the login page matches the existing design system.",
  "tags": ["instruction", "design_constraint"],
  "visibility": "raw_log",
  "include_in_optimization": true
}
```

For casual or sensitive messages:

```json
{
  "ts": "2026-04-25T22:18:02Z",
  "role": "human",
  "content": "ugh this is annoying just fix it",
  "tags": ["frustration", "non_actionable"],
  "visibility": "raw_log",
  "include_in_optimization": false
}
```

The important distinction:

```text
Raw session log:
  append-only
  complete
  resumable
  auditable
  may contain noise/secrets

Optimization dataset:
  curated
  redacted
  normalized
  task-relevant
  safe to feed into GEPA/hone
```

So yes, store everything — but add metadata.

I’d classify human messages into a few types:

```text
task_spec
acceptance_criteria
constraint
correction
preference
blocker_answer
review_feedback
approval
rejection
casual
secret
irrelevant
```

The most valuable messages for optimization are:

```text
“This is wrong because…”
“Don’t do X next time.”
“The blocker is actually Y.”
“Use this library instead.”
“Acceptance criteria are…”
“This solution is too complex.”
“This passed but I wouldn’t merge it because…”
```

Those should become high-quality optimizer examples.

For example, if you say:

```text
“You forgot to inspect the frontend API calls before building the backend.”
```

That becomes an optimization event:

```json
{
  "event_type": "human_correction",
  "target_artifacts": [
    "agents/implementer.md",
    "skills/frontend-backend-contract.md"
  ],
  "lesson": "Before implementing backend routes, inspect frontend fetch/axios calls and preserve the expected response shape.",
  "evidence_run_id": "run_01",
  "severity": "high"
}
```

That is GEPA gold.

## Resume format vs optimizer format

Most harnesses store session history for resuming. Keep that format simple and lossless.

But also generate a derived file:

```text
learning_events.jsonl
```

Example:

```json
{
  "run_id": "run_01",
  "artifact_suspected": "agents/implementer.md",
  "event_type": "human_rejection",
  "human_feedback": "It technically passes tests but the architecture is too coupled.",
  "normalized_lesson": "Prefer service boundaries over route-level business logic for backend tasks.",
  "suggested_skill_update": "skills/express-service-boundary.md",
  "include_in_optimization": true
}
```

This is what your daily mutator should read first.

## Redaction matters

Before any trace goes into optimization, run a redaction pass for:

```text
API keys
.env values
OAuth tokens
database URLs
private customer data
personal messages
company secrets
large pasted proprietary files
```

Use a policy like:

```yaml
trace_policy:
  store_raw_messages: true
  raw_log_location: ".flt/sessions"
  optimizer_input_requires_redaction: true
  default_include_human_messages: false
  include_human_message_types:
    - task_spec
    - acceptance_criteria
    - constraint
    - correction
    - review_feedback
    - blocker_answer
    - approval
    - rejection
```

I would make **raw logs opt-out difficult**, because they are needed for debugging and resume. But make **optimizer inclusion opt-in by classifier**.

## Practical answer

For `flt`, I’d implement:

```bash
flt session export
flt trace derive-learning-events
flt trace redact
flt optimize daily --input .flt/datasets/optimization/examples.jsonl
```

And store:

```text
messages.jsonl          # everything
learning_events.jsonl   # distilled human/agent lessons
optimizer_bundle.jsonl  # redacted GEPA input
```

So the answer is:

**Yes, store every human message for session continuity and auditability.**

**No, do not feed every human message directly into GEPA.**

**Yes, extract structured learning events from human corrections, approvals, rejections, and blocker answers.**

That gives you resumable harness behavior today and self-improving data tomorrow.

TIM: Who classifies? And should I generalize more or less? Such as, per project agents that get optimized? Or just “coder” etc per role? The 2 main things are 1. The structured system of spawns (maybe a new workflow yml? Flt workflows allow for complex multi step retries by just chaining spawn agent, fail (retry last step, evaluator for example could call fail), and pass and conditions for after?) for a “idea -> multiple iterations/blockers/feedback?” And 2. The overnight gepa of all traces from whole system; conceptually I wonder how can a mutator be good without a lot of data over the exact same task but different iterations? This is much closer to “multiple tasks”, randomly, and multiple iterations

GPT: Yes — this is exactly the hard part. The answer is: **classification should be multi-layered**, optimization should start **more general**, and the workflow system should be the durable core. The nightly GEPA loop should not require “same exact task repeated 50 times”; it should learn from **families of failures across different tasks**.

## 1. Who classifies the messages/traces?

Use three classifiers, in this order:

```text
1. Deterministic rules
2. Cheap LLM classifier
3. Human override / implicit human signal
```

Not everything needs a frontier model.

### Layer 1: deterministic rules

Some things are obvious from structure:

```text
User said "yes", "looks good", "merge it"       → approval
User said "no", "wrong", "that's broken"        → rejection/correction
Message contains .env/API key pattern           → secret/sensitive
Agent emitted blocker_report.json               → blocker
Tests failed                                    → failure
Tests passed + human approved                   → success
```

This should be your first pass.

### Layer 2: cheap classifier agent

Then use a small/cheap model to classify ambiguous human messages and run outcomes.

It outputs something like:

```json
{
  "message_type": "correction",
  "actionability": "high",
  "target_scope": "backend_contract",
  "suspected_artifacts": [
    "agents/implementer.md",
    "skills/frontend-backend-contract.md"
  ],
  "normalized_lesson": "Before implementing backend routes, inspect the frontend callsites and preserve expected response shapes.",
  "include_in_optimization": true,
  "confidence": 0.82
}
```

This classifier does **not** rewrite prompts. It just labels data.

### Layer 3: human signal

Your behavior is also a label.

```text
You manually merge candidate A      → strong positive signal
You abandon candidate B             → negative signal
You edit the agent's code heavily   → partial failure signal
You answer a blocker                → blocker-resolution signal
You say "do this next time"         → high-value learning event
```

You should make `flt` capture explicit commands like:

```bash
flt accept run_123
flt reject run_124 --reason "too complex"
flt lesson run_124 "Always inspect frontend API contracts before backend work"
flt promote candidate_07
```

This is way better than relying only on chat classification.

## 2. Should agents be generalized or per-project?

Start generalized. Then allow project overlays.

The structure I’d use:

```text
global/
  agents/
    planner.md
    implementer.md
    reviewer.md
    tester.md
    blocker.md
  skills/
    frontend-backend-contract.md
    playwright-debug.md
    express-api.md
    nextjs-ui.md

project/
  .flt/
    agents/
      implementer.overlay.md
      reviewer.overlay.md
    skills/
      local-architecture.md
      deployment.md
      design-system.md
    workflows/
      idea-to-pr.yml
```

So each final prompt is composed:

```text
global role prompt
+ global skill docs
+ project overlay
+ task-specific context
```

For example:

```text
agents/implementer.md
+ skills/frontend-backend-contract.md
+ project/tradeupbot/.flt/skills/local-architecture.md
+ task.md
```

This gives you the best of both worlds.

### What should be global?

Global artifacts should encode durable behaviors:

```text
inspect existing code before editing
run tests before declaring done
use minimal diffs
surface blockers explicitly
produce structured handoff
verify frontend/backend contracts
avoid changing unrelated files
```

These transfer across projects.

### What should be per-project?

Project artifacts should encode local facts:

```text
this repo uses pnpm
this app uses Next.js App Router
auth lives in src/lib/auth.ts
do not touch pricing math without tests
design system uses shadcn + Tailwind
deploy target is Vercel
database migrations use Prisma
```

Those should not pollute the global coder.

### What should be per-task?

Per-task context should stay local:

```text
build login page
fix this bug
add Stripe portal
change copy on dashboard
```

Do not optimize global prompts from one-off product preferences unless the lesson generalizes.

## 3. The right abstraction: base agents + skills + workflows

I would avoid “one optimized mega coder.” Use this hierarchy:

```text
Workflow = control flow
Agent = role behavior
Skill = reusable procedure/checklist
Project memory = repo-specific facts
Task = current objective
```

GEPA/hone can optimize each layer differently.

```text
Workflow optimization:
  Should we add a reviewer before implementation?
  Should failed evaluator call retry?
  Should browser tests run earlier?

Agent optimization:
  Should the implementer ask fewer questions?
  Should the reviewer check security first?

Skill optimization:
  Should the Express API skill include pagination?
  Should the Playwright skill include console log inspection?

Project optimization:
  Should this repo memory say "always use pnpm test:e2e"?
```

That is cleaner than trying to mutate “the swarm.”

## 4. For `flt`, yes: add workflow YAML

This is probably the core product.

You want workflows that can express:

```text
spawn agent
run command
evaluate
pass/fail
retry
branch
parallel
blocker
human approval
merge
```

A simple workflow could look like:

```yaml
name: idea-to-pr
version: 1

inputs:
  idea: string
  repo: path

steps:
  - id: spec
    type: spawn
    agent: planner
    output: spec.md

  - id: acceptance
    type: spawn
    agent: acceptance-writer
    input:
      spec: $steps.spec.output
    output: acceptance.md

  - id: implement_parallel
    type: parallel
    n: 3
    step:
      type: spawn
      agent: implementer
      input:
        spec: $steps.spec.output
        acceptance: $steps.acceptance.output
      output:
        diff: patch.diff
        handoff: handoff.md
        blockers: blockers.json

  - id: evaluate
    type: spawn
    agent: evaluator
    input:
      candidates: $steps.implement_parallel.outputs
    output: ranking.json

  - id: retry_if_needed
    type: condition
    if: $steps.evaluate.output.best_score < 0.75
    then:
      - type: fail
        target: implement_parallel
        mode: retry_best_with_feedback
        max_retries: 2
    else:
      - type: pass

  - id: verify
    type: command
    run: pnpm install && pnpm test && pnpm lint

  - id: human_gate
    type: human_approval
    when: before_merge

  - id: merge
    type: merge
    candidate: $steps.evaluate.output.best_candidate
```

The important primitive is what you said:

```text
evaluator can call fail
fail can retry last step
retry includes evaluator feedback
conditions decide next step
```

That turns `flt` from “spawn manager” into an **agentic CI/workflow engine**.

## 5. “Idea → multiple iterations/blockers/feedback” workflow

You want something like this:

```text
idea
  ↓
spec draft
  ↓
acceptance criteria
  ↓
implementation attempt(s)
  ↓
self-test
  ↓
evaluator
  ↓
if failed: feedback → retry
  ↓
if blocked: structured blocker → human
  ↓
human answer
  ↓
resume
  ↓
final verification
  ↓
PR / patch
```

The workflow state should survive interruptions:

```json
{
  "workflow_id": "wf_auth_001",
  "current_step": "blocked_waiting_for_human",
  "blocker": {
    "question": "Should auth use Google OAuth or email/password?",
    "recommended": "Google OAuth for v1"
  },
  "resume_after": "implement_parallel"
}
```

This is a much more valuable system than “many agents chat.”

## 6. How can overnight GEPA work without same-task repetitions?

It works by learning from **failure classes**, not exact task repeats.

You are right that if you only have random unique tasks, you cannot say:

```text
Prompt v7 is 8.2% better on this exact distribution
```

with high confidence.

But you can still learn useful things like:

```text
Across 14 full-stack tasks, failures often came from frontend/backend contract mismatch.
Across 9 backend tasks, agents forgot migrations 4 times.
Across 6 UI tasks, agents declared success without browser testing.
Across 11 bugfix tasks, agents over-edited unrelated files.
```

That is enough to mutate skills and checklists.

GEPA does not need identical tasks to propose useful improvements. It needs:

```text
trace
failure
artifact involved
lesson
metric
```

But you are right that **promotion needs held-out evaluation**.

So split the process:

```text
Mutation can use messy cross-task traces.
Promotion requires controlled eval tasks.
```

That is the key.

## 7. Build a small reusable eval suite

You need your own private mini benchmark.

For each project, maintain 5–20 eval tasks:

```text
project/.flt/evals/
  auth-contract-bug/
  add-settings-page/
  fix-playwright-failure/
  add-api-pagination/
  refactor-service-boundary/
```

Each eval task has:

```text
task.md
starting_patch_or_base_commit
acceptance.md
expected_tests
scorer.sh
```

Then nightly GEPA can learn from all traces, but candidates are tested on this suite.

```text
learn from messy history
test on stable eval suite
promote if better
```

This solves your concern.

## 8. Multiple tasks, random iterations, and attribution

Your data will be noisy. That is fine if you treat conclusions as probabilistic.

For each failure, classify it into a failure taxonomy:

```text
contract_mismatch
missing_test
did_not_run_tests
bad_repo_inspection
overengineering
wrong_library
security_regression
migration_missing
style_inconsistent
blocked_missing_secret
ambiguous_product_decision
```

Then optimize based on clusters.

Example:

```text
Failure cluster:
  contract_mismatch appeared in 7/31 full-stack runs

Suspected artifacts:
  implementer.md
  frontend-backend-contract.md
  idea-to-pr.yml

Candidate mutations:
  Add contract extraction step to skill
  Add evaluator check for frontend API call compatibility
  Add workflow step before implementation: inspect API callsites

Eval:
  Run 5 full-stack tasks
  Compare stable workflow vs candidate workflow
```

This is the real loop.

## 9. What should the mutator optimize nightly?

Not “all traces from whole system” in one giant prompt.

Do this:

```text
nightly job:
  1. cluster failures from last N runs
  2. pick top failure cluster
  3. pick one target artifact
  4. propose one minimal mutation
  5. evaluate candidate
  6. report
```

Example:

```text
Top cluster: agents frequently forget browser verification.
Target artifact: workflows/idea-to-pr.yml
Mutation: add browser-smoke step after UI changes.
Eval: run 4 UI tasks.
```

The mutator should be scoped. Otherwise it will make vague prompt soup.

## 10. “All traces from whole system” should become a digest first

Raw traces are too large and noisy. Create a daily digest:

```json
{
  "period": "2026-04-25",
  "runs_analyzed": 18,
  "top_failure_clusters": [
    {
      "type": "frontend_backend_contract_mismatch",
      "count": 5,
      "example_runs": ["run_12", "run_14", "run_18"],
      "suspected_artifacts": [
        "skills/frontend-backend-contract.md",
        "agents/implementer.md"
      ],
      "suggested_action": "Strengthen contract extraction before backend implementation."
    },
    {
      "type": "declared_done_without_e2e",
      "count": 4,
      "suspected_artifacts": [
        "workflows/idea-to-pr.yml",
        "agents/verifier.md"
      ],
      "suggested_action": "Workflow should require browser smoke test for UI-labeled tasks."
    }
  ]
}
```

Then the mutator reads:

```text
daily_digest.json
selected example traces
target artifact content
eval results of previous candidates
```

Not the entire universe.

## 11. A good nightly pipeline

```text
cron
  ↓
trace ingestion
  ↓
redaction
  ↓
classification
  ↓
failure clustering
  ↓
target selection
  ↓
mutation proposal
  ↓
cheap eval
  ↓
report/PR
```

In command form:

```bash
flt traces classify --since 24h
flt traces cluster --since 7d
flt mutate propose --target auto --max-candidates 3
flt eval candidates --suite smoke --budget 20
flt report nightly
```

## 12. Where `n` fits

There are two different `n`s.

### Runtime `n`

How many agents attempt the task?

```text
n=1 stable
n=2 stable + candidate
n=3-5 tournament
```

This gives you online comparison data.

### Mutation `n`

How many candidate artifacts does GEPA/hone propose?

```text
k=3 candidate prompt mutations
k=5 candidate skill mutations
k=2 candidate workflow mutations
```

A good budget-conscious setup:

```text
daily:
  runtime n mostly 1
  occasional n=2 shadow tests
  mutation k=3
  eval top candidates on 3-5 tasks

weekly:
  tournament n=4 or more
  larger eval suite
```

## 13. Should new tasks use brand-new proposed configs?

Sometimes.

I would use a policy like:

```yaml
exploration:
  stable_only_probability: 0.75
  stable_plus_candidate_probability: 0.20
  tournament_probability: 0.05

candidate_selection:
  prefer:
    - candidates_that_target_task_tags
    - candidates_with_smoke_eval_success
    - underexplored_candidates
  avoid:
    - candidates_with_security_regressions
    - candidates_that_increase_cost_too_much
```

So if the task is tagged:

```text
fullstack, auth, backend
```

then use a candidate that improved:

```text
frontend-backend-contract
migration-checking
auth-flow-testing
```

Do not randomly test a UI prompt on a backend migration task.

## 14. More or less generalization?

My recommendation:

```text
Global role prompts: very general
Skills: medium-specific
Project overlays: project-specific
Workflow YAML: task-family-specific
Task spec: exact
```

Example:

```text
global implementer.md:
  general coding behavior

skill frontend-backend-contract.md:
  reusable full-stack API contract checklist

project tradeupbot/local-architecture.md:
  this repo's specific structure and commands

workflow idea-to-pr.yml:
  control loop for building features

task.md:
  add Stripe billing portal
```

Optimize at the lowest level that explains the failure.

```text
One repo-specific command wrong?
  update project overlay

All Next.js tasks fail browser testing?
  update skill/playwright-nextjs.md

All agents skip verification?
  update workflow

Implementer keeps guessing?
  update implementer.md
```

This prevents global prompt pollution.

## 15. The biggest design principle

Do not let the nightly mutator ask:

```text
“How can we improve the whole system?”
```

That produces vague garbage.

Make it ask:

```text
“Given these 6 failures classified as frontend/backend contract mismatch, propose a minimal patch to exactly one of:
1. skills/frontend-backend-contract.md
2. agents/implementer.md
3. workflows/idea-to-pr.yml

The patch must reduce this failure type without increasing cost by more than 15%.”
```

That can work.

## The concrete system I’d build

Start with this:

```text
1. flt workflow YAML
2. append-only traces
3. cheap classifier → learning_events.jsonl
4. failure taxonomy
5. project eval suites
6. daily mutator that patches one artifact
7. candidate branch/PR
8. smoke eval
9. weekly promotion
```

And the conceptual answer to your concern:

**The mutator does not need lots of data on the exact same task to propose useful improvements.**

It needs lots of examples of the **same failure pattern**.

But to prove the mutation is good, you need a **small stable eval suite** and occasional A/B shadow runs.

So your system becomes:

```text
random real tasks → noisy learning data
failure clusters → candidate mutations
eval suite → evidence
shadow runs → live validation
promotion gate → stable improvement
```

That is the non-hype version of a self-evolving coding swarm.

Tim: How about kimi swarms? Also, can you fetch directly my whole GitHub.com/twaldin/flt repo, I feel I’m so close; it feels like per task, I am always using cli or : to spawn agents manually and babysit each one; the inter agent messaging I have is honestly in my opinion the best I am yet to see anyone use send keys direct to terminal and that’s the fastest way no? And preferred input for all agents. I feel I’m close to autonomous, and probably need to work on the auto chaining workflows to complete detailed spec/design docks created by the agents; and I think it’s all achievable with primitives; the overnight gepa/optimization, I think we do it per agent? So hone gets run on all agents that had one or more tasks? On their whole .flt/agents/<name> dir? And then the workflows already exist, probably need to create new agent presets and souls for different steps i think maybe we add the “oracle” agent to all agents where they can go flt send oracle who is always spawned-on-message and replies, then dies; researches as well? These kinda tie in because I need to gepa my soul mds but they also feel super unaligned right now. What’s the concrete list of agents + responsabilties. Also what is been proven as the best “per agent config”? Skills the meta now? Mcp seems dead, clis are good, but skills inform agents about things dynamically when they need? It’s like the old “hot cold” system where u just say “read this Md file” in your AGENTS.md file for “extra rules (or skills!) so I should maybe make a flt skill? And it’s dynamically populated per agent? Or keep “injected flt system block informing agents “you are flt agent use flt send blah blah”

Gpt: Yes — after fetching `twaldin/flt`, my reaction is: **you are closer than you think, but the next jump is not “more swarm.” It is workflow control + trace/eval/optimization around the primitives you already have.**

Your repo already has the important primitives:

`flt spawn`, `flt send`, `flt kill`, inbox/logs, cross-CLI adapters, tmux lifecycle, worktrees, presets, SOUL.md, skills, workflow YAML, pass/fail transitions, retries, PR creation, and instruction injection. The README already frames the exact thesis: one controller over Claude Code, Codex, Gemini CLI, Aider, OpenCode, SWE-agent, etc., with agents messaging each other through the same inbox and terminal sessions. ([GitHub][1])

## Kimi swarms: useful signal, but do not copy the marketing layer

Kimi is interesting because Moonshot is explicitly productizing the same “from one to many” idea. Their Kimi K2.6 page describes open-source coding + long-horizon execution + agent-swarm capabilities, reusable skills, and “Claw Groups,” where multiple agents share a workspace and a coordinator assigns tasks, manages dependencies, and keeps the workflow on track. ([Kimi][2])

That validates your direction. But I would **not** chase “300 agents” or “massive swarm” as the core. Public benchmark data still suggests the best practical systems are harness/workflow/scaffold dependent, not simply “more agents.” Terminal-Bench 2.0, for example, shows many different harness/model pairings spread across the board; Kimi K2.5 via Terminus 2 is listed, but it is not some magical outlier crushing every other scaffold. ([Terminal-Bench][3])

The lesson from Kimi is not “spawn hundreds.” It is:

> Coordinator + dependencies + shared workspace + reusable skills.

That is literally `flt`’s lane.

## Your `send keys direct to terminal` instinct is correct

Yes, for existing CLI coding agents, **tmux/send-keys is probably the most universal and lowest-friction control plane**.

Why it is good:

```text
- Works with CLIs that do not expose APIs.
- Preserves each tool's native UX and auth.
- Lets agents use subscription/OAuth CLIs.
- Allows human takeover at any moment.
- Makes cross-harness orchestration possible.
- Avoids waiting for every CLI to support MCP/API modes.
```

Your README says the TUI streams selected agent terminal output and insert mode forwards keystrokes directly to the agent; that is the primitive I would double down on. ([GitHub][1])

The weakness is not send-keys. The weakness is **lack of structured outcomes**. A terminal agent can receive text fast, but `flt` needs reliable answers to:

```text
What task was it doing?
What files did it change?
Did it pass?
Did it fail?
Why?
What blocker occurred?
What should happen next?
Which prompt/skill/workflow version caused this?
```

So keep send-keys as the transport. Add structure around it.

## The next thing to build: workflow v2

You already have workflows. The README says workflows are YAML state machines that chain agents together, allow later steps to reference earlier worktrees/branches/PRs, and agents signal transitions with `flt workflow pass` or `flt workflow fail`. ([GitHub][1])

That is exactly the right direction. Now make workflows the main product.

I would evolve workflows from:

```yaml
implement -> review -> done
```

into:

```yaml
idea -> spec -> design -> implementation tournament -> eval -> retry/blocker -> verify -> PR
```

You need these workflow primitives:

```text
spawn
parallel
send
wait_idle
require_verdict
pass
fail
retry
condition
human_gate
merge_best
run_command
collect_artifacts
oracle_query
```

Your current workflow engine already has pass/fail and retries, and the raw engine shows it prods agents that go idle without a verdict instead of silently passing. That is a very good design choice because it forces explicit workflow state instead of “agent stopped talking, I guess it worked.” ([GitHub][4])

The missing step is **parallel candidates + evaluator selection**.

Example shape:

```yaml
name: idea-to-pr-v2

steps:
  - id: spec
    type: spawn
    preset: spec_writer
    task: |
      Turn this idea into SPEC.md, ACCEPTANCE.md, and RISKS.md:
      {task}
    on_complete: design

  - id: design
    type: spawn
    preset: architect
    task: |
      Read {steps.spec.worktree}/SPEC.md.
      Produce DESIGN.md with implementation plan, files likely touched,
      tests needed, and blockers.
    on_complete: implement

  - id: implement
    type: parallel
    n: 3
    preset: coder
    task: |
      Implement the design.
      You must produce:
      - diff
      - test report
      - blocker_report.json if blocked
      - handoff.md
    on_complete: evaluate

  - id: evaluate
    type: spawn
    preset: evaluator
    task: |
      Compare the three candidate worktrees.
      Run tests where possible.
      Pick best_candidate or fail with reason.
    on_fail: implement
    max_retries: 2
    on_complete: verify

  - id: verify
    type: spawn
    preset: verifier
    task: |
      Verify the selected candidate from evaluator.
      Run clean install, tests, lint/typecheck/e2e as applicable.
      Call pass only if merge-ready.
    on_fail: implement
    max_retries: 1
    on_complete: human_gate

  - id: human_gate
    type: human_approval
    on_complete: done
```

That is the “autonomy” piece you’re missing. Not intelligence. **Control flow.**

## Concrete agent list

Do not make 40 agents. Start with 9 durable presets.

### 1. `orchestrator`

Owns the run. Converts user intent into workflow invocation. Does not code much.

Responsibilities:

```text
- choose workflow
- decide n
- decide presets/models
- summarize current state
- ask human only for true blockers
- keep project moving
```

Best model: strongest reasoning model you have.

---

### 2. `spec_writer`

Turns idea into spec, acceptance criteria, non-goals, risks.

Outputs:

```text
SPEC.md
ACCEPTANCE.md
OPEN_QUESTIONS.md
```

This is crucial because bad autonomy usually starts from vague tasks.

---

### 3. `architect`

Turns spec into implementation plan.

Outputs:

```text
DESIGN.md
FILES_TO_INSPECT.md
TEST_PLAN.md
DEPENDENCIES.md
RISK_REGISTER.md
```

This agent should be strict about repo inspection before coding.

---

### 4. `coder`

Actually implements.

Responsibilities:

```text
- inspect repo
- make minimal diff
- run relevant tests
- write handoff
- emit blocker_report.json if blocked
```

This should be the generic “worker” optimized most often.

---

### 5. `tester`

Writes or fixes tests, especially when coder skipped coverage.

Responsibilities:

```text
- unit/integration/e2e tests
- reproduce bugs
- create failing test before fix when possible
- capture exact commands
```

---

### 6. `reviewer`

Does code review, not implementation.

Responsibilities:

```text
- correctness
- security
- maintainability
- overengineering
- missed acceptance criteria
- unrelated changes
```

Reviewer should be allowed to call `flt workflow fail "reason"`.

---

### 7. `verifier`

Runs commands and browser checks. This is not the same as reviewer.

Responsibilities:

```text
- clean install
- lint/typecheck/test
- Playwright/browser smoke
- check console logs
- final merge readiness
```

This agent should be boring and procedural.

---

### 8. `evaluator`

Compares candidates in parallel tries.

Responsibilities:

```text
- rank worktrees/diffs
- compare test results
- select best candidate
- explain tradeoffs
- request retry with precise feedback
```

This is where your A/B/tournament work lives.

---

### 9. `oracle`

Spawn-on-message, dies after reply.

Responsibilities:

```text
- answer focused questions
- research docs/web/codebase
- provide second opinion
- never own state
- never directly mutate repo unless explicitly asked
```

Yes, I like your oracle idea a lot. Make it cheap and ephemeral:

```bash
flt ask oracle "What is the correct Vercel env var behavior for this?"
```

or from any agent:

```bash
flt send oracle "Research this error and reply to parent: ..."
```

But do **not** keep oracle always running. Make it spawn-on-message because research questions are bursty and you want clean isolated context.

## Per-agent config: what is “proven best”?

The emerging meta is:

```text
short stable system block
+ role-specific SOUL.md
+ dynamically selected skills
+ project memory
+ task context
+ workflow contract
```

Not one giant mega-prompt.

Your repo already has this direction: agents get identity from SOUL.md, and skills are Markdown files from global or per-agent skill directories. For Claude Code they become slash commands; for other CLIs they are embedded into the instruction file. ([GitHub][1])

So yes: **skills are the meta**, but only if they are dynamically selected or at least scoped. Dumping 80 skills into every agent becomes prompt pollution.

Recommended hierarchy:

```text
FLT injected system block:
  universal protocol only

SOUL.md:
  role identity and responsibilities

skills/*.md:
  reusable procedures/checklists

project memory:
  repo-specific commands, architecture, conventions

workflow block:
  current step contract and pass/fail rules

task:
  actual objective
```

## Keep the injected FLT system block small

Yes, keep a universal injected block. But it should only teach the agent how to participate in `flt`.

It should say:

```text
You are an flt-managed agent.
You can message parent: flt send parent "..."
You can message another agent: flt send <name> "..."
If in a workflow, you must eventually call:
  flt workflow pass
or:
  flt workflow fail "reason"
If blocked, emit blocker_report.json and notify parent.
Do not silently idle when done.
```

That belongs globally.

Do **not** put coding style, frontend rules, backend rules, browser testing rules, security rules, etc. all in the injected system block. Those are skills or role files.

## Make `flt skill` real

You already have `skills.ts` and README-level skills. The next jump is to make skills first-class:

```bash
flt skills add frontend-contract ~/.flt/skills/frontend-contract.md
flt skills attach coder frontend-contract
flt skills attach verifier playwright-smoke
flt skills suggest --task "add OAuth login"
```

Skill file format:

```md
---
name: frontend-backend-contract
description: Inspect frontend API callsites before backend/API changes.
applies_when:
  - fullstack
  - api
  - auth
  - frontend-backend
agents:
  - coder
  - reviewer
  - verifier
---

# Frontend/backend contract skill

Before implementing backend routes:
1. Search for existing fetch/axios/server-action callsites.
2. Record expected method, path, request body, response shape.
3. Preserve or intentionally migrate the contract.
4. Add/adjust tests that prove the contract.
5. Do not declare done until frontend path works.
```

Then the spec/architect can tag the task:

```json
{
  "tags": ["fullstack", "auth", "api"]
}
```

and `flt` can inject only relevant skills.

That is better than telling every agent “read all MD files.”

## GEPA/hone: per agent, but not blindly on whole directories

Do **not** run hone on `~/.flt/agents/<name>/` wholesale every night. That will create noisy, unreviewable prompt soup.

Run optimization against **one artifact target at a time**:

```text
agents/coder/SOUL.md
skills/frontend-backend-contract.md
skills/playwright-smoke.md
workflows/idea-to-pr.yml
agents/reviewer/SOUL.md
```

The nightly process should pick the target by failure attribution:

```text
If coders repeatedly skip API contract inspection:
  target skills/frontend-backend-contract.md or coder/SOUL.md

If reviewers miss security issues:
  target reviewer/SOUL.md or security-review.md

If agents succeed but workflow never retries correctly:
  target workflows/idea-to-pr.yml

If agents do not call pass/fail:
  target workflow-block.md / flt system block
```

So yes, “per agent” is part of it, but the more precise answer is:

> Optimize the smallest artifact that explains the failure.

## The nightly optimizer should be a workflow too

Make optimization itself an `flt` workflow:

```yaml
name: nightly-optimize

steps:
  - id: classify
    preset: trace_classifier
    task: |
      Read recent traces. Produce failure_clusters.json.
    on_complete: select_target

  - id: select_target
    preset: optimizer_planner
    task: |
      Choose exactly one artifact to mutate.
      Prefer high-frequency, high-confidence failure clusters.
    on_complete: mutate

  - id: mutate
    preset: mutator
    task: |
      Produce one minimal candidate patch.
      Do not rewrite unrelated files.
    on_complete: eval

  - id: eval
    preset: evaluator
    task: |
      Run smoke eval comparing stable vs candidate.
      Produce eval_report.json.
    on_complete: report

  - id: report
    preset: reporter
    task: |
      Summarize whether candidate should be promoted.
      Do not auto-promote unless thresholds pass.
```

This makes `flt` dogfood itself.

## How to make the mutator good without same-task data

You were right to worry. You will not have clean “same task repeated 100 times” data.

The solution is:

```text
real traces -> failure clusters -> candidate mutation -> held-out eval suite
```

The mutator learns from messy multi-task history. Promotion happens on controlled evals.

Example:

```text
Recent traces:
  6 different tasks failed because agents skipped browser verification.

Mutation:
  update verifier SOUL.md + workflow to require browser smoke for UI-tagged tasks.

Eval:
  run 5 saved UI tasks before/after.

Promote:
  only if pass rate improves without unacceptable cost increase.
```

You need `.flt/evals/` per project.

```text
.flt/evals/
  auth-flow/
    task.md
    base_commit.txt
    scorer.sh
  api-contract/
    task.md
    base_commit.txt
    scorer.sh
  ui-smoke/
    task.md
    base_commit.txt
    scorer.sh
```

Without eval suites, GEPA becomes vibes. With eval suites, it becomes real.

## Your “autonomous 0→100” path

The actual roadmap:

### Phase 1: harden current primitives

```text
- reliable send/direct terminal control
- reliable idle detection
- reliable pass/fail verdicts
- reliable worktree capture
- reliable trace logs
```

You already have much of this.

### Phase 2: workflow v2

```text
- parallel steps
- conditions
- artifact collection
- blocker state
- human approval gates
- evaluator-selected candidate
```

This is your biggest near-term unlock.

### Phase 3: agent preset pack

Ship default presets:

```text
orchestrator
spec_writer
architect
coder
tester
reviewer
verifier
evaluator
oracle
mutator
trace_classifier
```

### Phase 4: skills

```text
frontend-backend-contract
playwright-smoke
repo-inspection
minimal-diff
backend-api
database-migration
security-review
debug-failing-test
pr-handoff
```

### Phase 5: optimization

```text
trace classification
failure clustering
candidate mutation
eval suite
promotion gate
```

## What I would change in your mental model

You said:

> “I need to GEPA my soul mds but they feel super unaligned.”

I’d reframe that:

```text
SOUL.md should be small and stable.
Skills should carry procedural knowledge.
Workflow should carry control flow.
Project memory should carry repo-specific facts.
GEPA should mutate the artifact nearest to the failure.
```

Bad:

```text
GEPA rewrites coder/SOUL.md into a giant everything prompt.
```

Good:

```text
GEPA notices contract mismatch failures and patches skills/frontend-backend-contract.md.
```

Bad:

```text
All agents get all skills all the time.
```

Good:

```text
Task tags select relevant skills.
Workflow step selects role.
Project overlay adds repo facts.
```

## The concrete default agent responsibilities

Here is the clean list I would literally create:

```text
~/.flt/agents/orchestrator/SOUL.md
Owns task decomposition, workflow choice, human-facing summary.

~/.flt/agents/spec_writer/SOUL.md
Turns ideas into SPEC.md, ACCEPTANCE.md, NON_GOALS.md.

~/.flt/agents/architect/SOUL.md
Inspects repo and writes DESIGN.md, TEST_PLAN.md, FILES_TO_TOUCH.md.

~/.flt/agents/coder/SOUL.md
Implements minimal diffs. Must run tests. Must emit handoff.

~/.flt/agents/tester/SOUL.md
Creates/repairs tests and reproduction cases.

~/.flt/agents/reviewer/SOUL.md
Reviews diff against spec, architecture, security, maintainability.

~/.flt/agents/verifier/SOUL.md
Runs final commands/browser checks. Binary merge-readiness verdict.

~/.flt/agents/evaluator/SOUL.md
Ranks multiple candidate worktrees. Selects best or fails with feedback.

~/.flt/agents/oracle/SOUL.md
Ephemeral research/second-opinion agent. Answers and exits.

~/.flt/agents/mutator/SOUL.md
Proposes minimal prompt/skill/workflow mutations from traces.

~/.flt/agents/trace_classifier/SOUL.md
Classifies failures, human corrections, blockers, and suspected artifacts.
```

And default skills:

```text
~/.flt/skills/flt-protocol.md
~/.flt/skills/repo-inspection.md
~/.flt/skills/minimal-diff.md
~/.flt/skills/frontend-backend-contract.md
~/.flt/skills/playwright-smoke.md
~/.flt/skills/test-before-done.md
~/.flt/skills/database-migration.md
~/.flt/skills/security-review.md
~/.flt/skills/blocker-report.md
~/.flt/skills/pr-handoff.md
~/.flt/skills/debug-loop.md
```

## My strongest recommendation

Do **not** build “Kimi swarm clone.”

Build:

> `flt`: tmux-native workflow engine for real coding CLIs, with skills, worktrees, cross-agent messaging, parallel attempts, evaluator-selected patches, and trace-driven prompt/skill optimization.

That is much sharper.

Your differentiator is not that agents exist. Everyone has agents.

Your differentiator is:

```text
I can control any CLI agent through the terminal.
I can spawn them into isolated worktrees.
I can chain them through YAML workflows.
I can make them message each other.
I can compare their outputs.
I can collect traces.
I can optimize the prompts/skills/workflows from real failures.
```

That is very close to a real autonomous coding factory. The missing piece is not another model. It is workflow v2 + artifact contracts + eval/promotion.

[1]: https://github.com/twaldin/flt "GitHub - twaldin/flt: cli-first harness agnostic agent orchestration tool · GitHub"
[2]: https://www.kimi.com/ai-models/kimi-k2-6 "Kimi K2.6 | Leading Open-Source Model in Coding & Agent"
[3]: https://www.tbench.ai/leaderboard/terminal-bench/2.0 "Terminal-Bench"
[4]: https://raw.githubusercontent.com/twaldin/flt/refs/heads/main/src/workflow/engine.ts "raw.githubusercontent.com"

Tim: Skills are already —skill added dynamically on spawn, and in presets, should I just make each agent its own preset with skills? Or dynamic like u said based on task tagging from the plan? I kinda like that because I can make it, for example, n different coders for n different, deemed “parallelizable” tasks decided by previous agent? And assign  skills as the agent decides per task? Same with reviewers, can be parallel for seperate code sections? One per coder? Then also the verifier needs certain ones. Make sense? 2 more: should I prefer import/use popular skills from any harness + source? It’s a pretty open standard just a SKILL.md that points wherever, right. Instead of creating own from scratch? Or follow the “skill-creator” and “skill-finder” skills? So agents can make and find skills to add to workflows if needed? Second, should I adopt/switch to dspy? There’s a dspy ts implementation; could I maybe try to use dspy but have it invoke my coding clis like harness does? That would make optimizing/logging the workflows easier, more standardizable, etc

Yes, this makes sense. I would structure it as:

```text id="b27a16"
preset = durable role identity
skills = dynamic capabilities/checklists for this task
workflow = control flow and coordination
planner = decides task split + tags + recommended skills
```

So: **each agent should be a preset**, but **skills should be dynamically attached based on the task plan**, not hardcoded forever.

## 1. Presets vs dynamic skills

Use presets for things that should almost never change:

```text id="y2q0p"
coder
reviewer
verifier
evaluator
architect
spec_writer
oracle
mutator
trace_classifier
```

Each preset should define:

```yaml id="wy9uq0"
name: coder
model: claude-code-or-codex-or-opencode
soul: ~/.flt/agents/coder/SOUL.md
default_skills:
  - flt-protocol
  - repo-inspection
  - minimal-diff
  - test-before-done
```

Then dynamic task tags add skills:

```yaml id="1mokmh"
task:
  title: "Add Stripe billing portal"
  tags:
    - fullstack
    - billing
    - stripe
    - nextjs
    - api
```

Which resolves to:

```yaml id="dx9fyv"
dynamic_skills:
  - frontend-backend-contract
  - stripe-billing
  - nextjs-app-router
  - env-var-handling
  - playwright-smoke
```

So the final spawn is:

```bash id="gwfcd3"
flt spawn coder \
  --task task.md \
  --skill frontend-backend-contract \
  --skill stripe-billing \
  --skill nextjs-app-router \
  --skill playwright-smoke
```

This is better than making a permanent `stripe-nextjs-coder` preset for every possible combination.

## 2. Yes: previous agent should decide parallelizable tasks

This is the right architecture.

The `architect` or `planner` should produce a task graph:

```json id="ozxq62"
{
  "tasks": [
    {
      "id": "backend-stripe-portal",
      "title": "Add backend route for Stripe customer portal",
      "parallelizable": true,
      "agent_preset": "coder",
      "tags": ["backend", "api", "stripe", "env"],
      "skills": ["stripe-billing", "backend-api", "env-var-handling"],
      "depends_on": []
    },
    {
      "id": "settings-ui",
      "title": "Add billing settings UI",
      "parallelizable": true,
      "agent_preset": "coder",
      "tags": ["frontend", "nextjs", "ui", "shadcn"],
      "skills": ["nextjs-app-router", "shadcn-ui", "frontend-backend-contract"],
      "depends_on": []
    },
    {
      "id": "e2e-test",
      "title": "Add Playwright smoke test",
      "parallelizable": false,
      "agent_preset": "tester",
      "tags": ["e2e", "playwright", "billing"],
      "skills": ["playwright-smoke"],
      "depends_on": ["backend-stripe-portal", "settings-ui"]
    }
  ]
}
```

Then `flt` does:

```text id="ky1nr9"
spawn coder A for backend
spawn coder B for frontend
wait for both
spawn tester
spawn reviewer(s)
spawn verifier
```

That is much better than “n coders all doing same thing” for normal product work.

There are actually two useful parallel modes:

```text id="5rv5wn"
competitive parallelism:
  N agents attempt the same task.
  Evaluator picks best.

decomposed parallelism:
  N agents do different subtasks.
  Integrator merges them.
```

You want both.

## 3. Reviewers can be parallel too

Yes. Review should mirror the work split.

For decomposed tasks:

```text id="n2v58m"
backend coder  → backend reviewer
frontend coder → frontend reviewer
tester output  → test reviewer
```

Then a final reviewer looks across the whole integrated diff:

```text id="i5eq8g"
section reviewers → integration reviewer → verifier
```

Concrete:

```yaml id="vrad2a"
review:
  mode: per_task_then_global
  per_task_reviewers:
    backend-stripe-portal:
      preset: reviewer
      skills: [backend-api, security-review, stripe-billing]
    settings-ui:
      preset: reviewer
      skills: [nextjs-app-router, shadcn-ui, accessibility-review]
  global_reviewer:
    preset: reviewer
    skills: [acceptance-check, integration-review]
```

This makes way more sense than one reviewer trying to deeply inspect everything.

## 4. Verifier skills should be selected from changed surface area

The verifier should not always get every skill. It should get skills based on what changed.

Example:

```text id="lb022q"
Changed files:
  app/settings/billing/page.tsx
  app/api/billing/portal/route.ts
  playwright/billing.spec.ts
```

Verifier receives:

```text id="mr4352"
nextjs-app-router
frontend-backend-contract
stripe-billing
playwright-smoke
env-var-handling
```

So yes: planner tags the task, but verifier can also infer from diff/files.

## 5. Should you import popular skills?

Yes, but with a quarantine/review layer.

Anthropic’s docs describe skills as folders with a `SKILL.md` plus optional scripts/resources, and Anthropic also publishes open-source skills. They are portable enough that using external skills is reasonable, especially for common domains like Claude API, frontend frameworks, browser testing, spreadsheets, etc. ([Claude Platform][1])

But there is a security angle. Skills can include scripts/resources, and there has already been public concern about malicious or unsafe skills in the ecosystem. So treat skills like dependencies, not like harmless Markdown. ([Axios][2])

I would build:

```bash id="ytqhhy"
flt skill import anthropics/skills/claude-api
flt skill import alirezarezvani/claude-skills/playwright
flt skill audit claude-api
flt skill trust claude-api
```

Skill states:

```text id="z5tr6g"
untrusted
reviewed
trusted
pinned
deprecated
```

And pin by commit/hash:

```yaml id="cai9c0"
skills:
  claude-api:
    source: github:anthropics/skills/skills/claude-api
    commit: abc123
    hash: sha256:...
    trust: reviewed
```

There are already large third-party skill collections claiming hundreds of Claude/Codex/Gemini-compatible skills, so you do not need to write everything from scratch. But I would curate aggressively. ([GitHub][3])

## 6. Should you have `skill-finder` and `skill-creator` agents?

Yes — but again, with gates.

### `skill_finder`

Responsibilities:

```text id="0yo4f9"
- Search local skill registry first.
- Search trusted remote registries second.
- Recommend skills for a task.
- Explain why each skill applies.
- Never auto-install untrusted skills without approval.
```

Output:

```json id="y0ut9j"
{
  "recommended_skills": [
    {
      "name": "frontend-backend-contract",
      "source": "local",
      "reason": "Task modifies frontend and API route."
    },
    {
      "name": "stripe-billing",
      "source": "remote",
      "trust": "untrusted",
      "reason": "Task requires Stripe customer portal flow.",
      "requires_review": true
    }
  ]
}
```

### `skill_creator`

Responsibilities:

```text id="xqj8qj"
- Create a new skill only after repeated failure pattern or missing capability.
- Keep SKILL.md small.
- Add examples/checklists.
- Add smoke eval if possible.
- Never silently modify stable skills without review.
```

Good trigger:

```text id="vr1pcp"
Three runs failed because agents did not know how to inspect Vercel deployment logs.
Create skill: vercel-debugging.
```

Bad trigger:

```text id="qmyuqk"
One weird task happened once.
Create giant new skill.
```

So yes: make skill-finder and skill-creator, but keep them in the optimization/maintenance workflow, not every normal task.

## 7. Should you adopt/switch to DSPy?

My answer: **do not switch `flt` to DSPy. Add a DSPy-compatible optimization layer later.**

`flt`’s core is not a normal DSPy program. It is:

```text id="85clh8"
tmux sessions
CLI agents
worktrees
terminal I/O
workflow state
send keys
human takeover
logs
patches
commands
```

DSPy is excellent for modular LLM programs with signatures, metrics, and optimizers. Its docs define optimizers as tuning prompts/weights of a DSPy program against metrics, and GEPA specifically optimizes text components using rich trace feedback. ([DSPy][4])

That maps better to your **classifier/evaluator/mutator/routing components**, not necessarily the whole `flt` runtime.

So the split should be:

```text id="d7k3kz"
flt native:
  spawning
  terminal control
  workflows
  worktrees
  logs
  skill injection
  pass/fail/retry
  human gates

DSPy/GEPA layer:
  trace classifier
  skill selector
  evaluator rubric
  prompt/skill mutator
  workflow policy optimizer
```

## 8. Could DSPy invoke your coding CLIs like `harness`?

Yes, conceptually. You can wrap `flt`/`harness` as a DSPy module/tool.

Pseudo-shape:

```python id="hwefi8"
class RunFltTask(dspy.Module):
    def __init__(self, workflow, preset):
        self.workflow = workflow
        self.preset = preset

    def forward(self, task, repo, skills):
        run = flt_run(
            workflow=self.workflow,
            preset=self.preset,
            task=task,
            repo=repo,
            skills=skills,
        )
        return dspy.Prediction(
            diff=run.diff,
            test_results=run.test_results,
            trace=run.trace,
            score=run.score,
        )
```

Then the metric returns both score and textual feedback. The DSPy GEPA docs specifically note that GEPA benefits from natural-language traces and feedback, not just numerical rewards. ([GitHub][5])

But I would not make TypeScript DSPy the foundation yet. The Python DSPy ecosystem is the official/primary one, while TypeScript options like `dspy.ts` and Ax exist but are separate implementations/ports. `dspy.ts` describes itself as a TypeScript port, and Ax says it brings DSPy’s approach to TypeScript, but neither is the canonical Stanford DSPy runtime. ([GitHub][6])

## 9. Recommended DSPy strategy

Do this:

### Now

Keep `flt` native TypeScript.

Add clean JSONL traces and metrics:

```text id="u5u2f0"
workflow_run.json
messages.jsonl
tool_calls.jsonl
skills_used.json
metrics.json
failure_clusters.json
```

### Next

Export DSPy/GEPA training bundles:

```bash id="puxn9l"
flt export dspy --since 7d --target skills/frontend-backend-contract
```

### Later

Run Python DSPy/GEPA offline:

```bash id="7kqsya"
python optimize_skill.py \
  --target skills/frontend-backend-contract.md \
  --traces .flt/exports/frontend-contract.jsonl \
  --eval-suite .flt/evals/fullstack
```

### Eventually

Optional TypeScript integration:

```text id="xf1z9t"
Use DSPy.ts/Ax only for lightweight in-process classifiers/rankers
if they feel ergonomic.
```

Do not force everything through DSPy just because it sounds standard. Your unique thing is the runtime.

## 10. The architecture I’d choose

### Runtime path

```text id="c7p7xp"
User idea
  ↓
orchestrator preset
  ↓
spec_writer
  ↓
architect creates task graph:
    task tags
    dependencies
    suggested skills
    parallelization plan
  ↓
skill_finder validates/augments skills
  ↓
spawn coders per task
  ↓
spawn reviewers per task
  ↓
integrator/evaluator
  ↓
verifier
  ↓
human gate / PR
```

### Optimization path

```text id="cxv3wq"
Traces
  ↓
trace_classifier
  ↓
failure clusters
  ↓
mutator chooses smallest target:
    SOUL.md, skill, workflow, preset, selector
  ↓
candidate patch
  ↓
eval suite
  ↓
promotion report
```

## 11. Concrete recommendation for your current question

Make each agent its own preset with **minimal default skills**.

Then add a `skill_selector` step after planning:

```yaml id="5k1aq7"
- id: select_skills
  preset: skill_finder
  task: |
    Given task_graph.json and available skills, assign skills to each task agent,
    reviewer, and verifier. Prefer local trusted skills. Do not add irrelevant skills.
```

Then spawn agents from the task graph:

```yaml id="lyzu70"
- id: implement_tasks
  type: parallel_from_graph
  graph: $steps.plan.task_graph
  spawn:
    preset: $task.agent_preset
    skills: $task.skills
```

This gives you exactly what you described:

```text id="5pmiq3"
n different coders for n parallelizable tasks
skills selected per task
reviewers assigned per code section
verifier gets skills based on final diff
```

## 12. My direct answers

**Should each agent be its own preset with skills?**
Yes. Each agent should be a preset with stable default skills.

**Should skills also be dynamic based on task tags from the plan?**
Yes. That should be the main mechanism.

**Can planner decide n different coders for n parallelizable tasks and assign skills?**
Yes. That is the correct workflow design.

**Can reviewers be parallel per code section or per coder?**
Yes. Use per-task reviewers plus one final integration reviewer.

**Should verifier get certain skills?**
Yes. Verifier skills should come from task tags plus changed file analysis.

**Should you import popular skills?**
Yes, but pin, audit, and trust-gate them like dependencies.

**Should agents create/find skills?**
Yes. `skill_finder` can recommend. `skill_creator` can propose. Human/eval gates should approve.

**Should you switch to DSPy?**
No, not for the core runtime. Keep `flt` native. Add DSPy/GEPA as an offline optimization/export layer first.

**Can DSPy invoke your coding CLIs?**
Yes. Wrap `flt run` or `harness.spawn()` as a DSPy module/tool, but use that for evaluation and optimization, not for replacing your terminal orchestration.

The clean thesis is:

> `flt` is the terminal-native execution/workflow layer. Skills are dynamically selected capabilities. DSPy/GEPA is the offline optimizer over traces, not the runtime replacement.

[1]: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview?utm_source=chatgpt.com "Agent Skills - Claude API Docs"
[2]: https://www.axios.com/2025/12/02/anthropic-claude-skills-medusalocker-ransomware?utm_source=chatgpt.com "Exclusive: Researchers trick Claude plug-in into deploying ransomware"
[3]: https://github.com/alirezarezvani/claude-skills?utm_source=chatgpt.com "alirezarezvani/claude-skills: 232+ Claude Code skills & ..."
[4]: https://dspy.ai/learn/optimization/optimizers/?utm_source=chatgpt.com "Optimizers"
[5]: https://github.com/stanfordnlp/dspy/blob/main/docs/docs/api/optimizers/GEPA/overview.md?utm_source=chatgpt.com "dspy/docs/docs/api/optimizers/GEPA/overview.md at main"
[6]: https://github.com/ruvnet/dspy.ts?utm_source=chatgpt.com "ruvnet/dspy.ts: DS.js (Declarative Self‑learning JavaScript"

Tim: More issues — so many spec.md etc Md files are slop/never read pst workflow we should auto clean/somehow? Second same with data how to store in nice way but still useful? Don’t wanna purge more, but how can we plan for save msgs from random json files on disk or an actual db on disc like opencode; and my biggest issue: how will I ever know what harness + model to use per agent? This is never well defined by any bench to me (cost vs needed intelligence per task, and either costs time of manually doing it)

GPT: Yes — these are the exact three problems you need to solve before `flt` feels “autonomous” instead of “a folder full of abandoned agent junk.”

I’d split it into:

```text id="nxm7ar"
1. Artifact lifecycle: what happens to SPEC.md, DESIGN.md, scratch files, reports?
2. Trace/data storage: JSONL/files vs SQLite vs both.
3. Model/harness routing: how to choose cheap/strong tools per agent without babysitting.
```

## 1. The `SPEC.md` slop problem

You are right: agents create tons of Markdown that is never read again.

The solution is **not “stop writing Markdown.”** Markdown artifacts are good. The problem is that they lack lifecycle and ownership.

Give every artifact a type, status, owner, and expiry.

```text id="2e3b9m"
SPEC.md        durable until task ends
DESIGN.md      durable until implementation ends
HANDOFF.md     durable until reviewed
SCRATCH.md     temporary
BLOCKERS.json  durable
EVAL.json      durable
TRACE.jsonl    permanent-ish
```

So instead of random files:

```text id="lvc7jz"
SPEC.md
DESIGN.md
notes.md
final.md
review.md
plan2.md
```

use structured artifact dirs:

```text id="4b4jsm"
.flt/runs/run_123/
  artifacts/
    spec.md
    acceptance.md
    design.md
    task_graph.json
    handoff.md
    review.md
    verifier_report.md
    blocker_report.json
    final_summary.md
  scratch/
    coder-notes.md
    reviewer-temp.md
  patches/
    candidate-a.diff
    candidate-b.diff
  logs/
    messages.jsonl
    commands.jsonl
```

Then add a manifest:

```json id="tif9cz"
{
  "artifacts": [
    {
      "path": "artifacts/spec.md",
      "type": "spec",
      "owner": "spec_writer",
      "status": "consumed",
      "consumed_by": ["architect", "coder-a", "coder-b"],
      "keep": true
    },
    {
      "path": "scratch/coder-notes.md",
      "type": "scratch",
      "owner": "coder-a",
      "status": "expired",
      "keep": false
    }
  ]
}
```

The important primitive is **mark consumed**.

When the architect reads the spec:

```bash id="7lkps3"
flt artifact consume artifacts/spec.md --by architect
```

When the workflow finishes:

```bash id="zr5coq"
flt artifact gc run_123
```

Garbage collection policy:

```text id="o5uz5l"
Keep:
  spec, acceptance, task_graph, final diff, blocker reports, eval reports,
  human feedback, final summary, metrics

Compress/archive:
  full transcripts, command logs, screenshots, failed candidate diffs

Delete or move to cold storage:
  scratch notes, duplicate plans, abandoned drafts, temporary Markdown
```

You do **not** want to purge more aggressively. You want to **summarize and demote**.

The final run should have a durable `run_summary.md`:

```md id="qa2prc"
# Run Summary

Task: Add Stripe billing portal
Outcome: accepted
Best candidate: coder-b
Why: passed e2e, smaller diff, no security issues

Important lessons:
- Existing billing route used server actions, not REST.
- Stripe env var missing in local dev.
- Playwright needed mocked portal URL.

Artifacts worth keeping:
- task_graph.json
- candidate-b.diff
- verifier_report.md
- blocker_report.json
```

Then most of the messy Markdown can be hidden under `.flt/archive`.

## 2. Store data as files and SQLite, not one or the other

You should use both.

### Files are the source of truth for large artifacts

Keep these as files:

```text id="yba7t2"
messages.jsonl
commands.jsonl
tool_calls.jsonl
diff.patch
screenshots
playwright traces
SPEC.md
DESIGN.md
HANDOFF.md
review.md
```

Files are easy for agents to read, easy for humans to inspect, and Git/worktree-friendly.

### SQLite is the index/query layer

Use SQLite for:

```text id="y6eq1p"
runs
sessions
messages metadata
artifact index
metrics
costs
model/harness used
skill versions
workflow step states
failure classifications
human approvals/rejections
```

This is also where the ecosystem is going. OpenHands emphasizes production-agent requirements like lifecycle control, model-agnostic routing, execution portability, and human interfaces; those are exactly easier with a real state/index layer rather than scattered files. ([arXiv][1])

A local SQLite audit trail is also the obvious pattern for agent logs: Gryph, for example, logs file reads, file writes, command executions, tool invocations, and session boundaries to a local SQLite database. ([SafeDep][2])

So design it like:

```text id="tvm5xs"
.flt/
  flt.db                  # index/query/state
  sessions/
    sess_abc/
      messages.jsonl
  runs/
    run_123/
      artifacts/
      logs/
      patches/
      archive/
  evals/
  skills/
  workflows/
```

SQLite points to files:

```sql id="lh8nvl"
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  path TEXT NOT NULL,
  type TEXT NOT NULL,
  owner_agent TEXT,
  status TEXT,
  keep INTEGER,
  created_at TEXT,
  consumed_at TEXT,
  summary TEXT
);
```

Do not shove all transcript text into SQLite as the only copy. Store raw text as JSONL files, then index it in SQLite.

## 3. Data lifecycle: hot, warm, cold

Use a tiered policy.

```text id="3k750d"
Hot:
  current sessions/runs
  fully readable
  all artifacts visible

Warm:
  recent completed runs
  summarized
  full logs still on disk
  scratch hidden/archived

Cold:
  old runs
  compressed logs
  searchable metadata
  only summaries + metrics loaded by default
```

Commands:

```bash id="zzn8h8"
flt gc --run run_123
flt archive --older-than 30d
flt summarize --older-than 7d
flt vacuum
```

Policy:

```yaml id="w7sovs"
retention:
  hot_days: 7
  warm_days: 45
  cold_after_days: 45

  keep_forever:
    - final_summary
    - metrics
    - accepted_diff
    - blocker_report
    - human_feedback
    - failure_classification

  archive:
    - messages
    - commands
    - screenshots
    - failed_candidate_diffs

  delete_after_archive:
    - scratch
    - duplicate_plans
    - temporary_notes
```

The key is: **agents should read summaries by default, not the entire graveyard.**

## 4. How agents should consume old data

Never let agents blindly read all old traces.

Give them retrieval commands:

```bash id="7l4385"
flt memory search "frontend backend contract failures"
flt runs similar "add billing settings page"
flt lessons list --tag nextjs --tag api
flt artifact show run_123 final_summary
```

Then the agent gets compact results:

```text id="u1s24k"
Relevant lessons:
1. In this repo, billing APIs use server actions, not REST.
2. Always run pnpm test:e2e after settings page changes.
3. Stripe env vars are mocked in tests through test/env.ts.
```

This solves “store everything but don’t drown the agent.”

## 5. The hardest one: model + harness routing

You will not get this from public benchmarks alone. Public benchmarks are useful priors, but they do not answer:

```text id="7bz1a2"
For this repo, this task, this agent role, with my prompts,
which harness/model gives best cost-adjusted outcome?
```

SWE-bench and Terminal-Bench prove the broad point that harness/scaffold matters. SWE-bench leaderboard entries are agent/model combinations, and the current official leaderboard shows different scaffolds/models with cost columns rather than a single universal answer. ([SWE-bench][3]) Terminal-Bench 2.0 has 89 terminal tasks across software engineering, ML, security, data science, system administration, and more — useful, but still not “which model should my reviewer use on my project today?” ([Terminal-Bench][4])

There is also evidence that benchmark rankings are fragile: one SWE-bench evaluation audit found ranking changes for 24.4% of Verified entries after correcting erroneous patch evaluations. ([arXiv][5])

So the answer is: **use public benches as priors, then build your own router from your own traces.**

## 6. Build a model/harness router

Every agent role should have a routing policy:

```yaml id="m9e5ml"
roles:
  spec_writer:
    default: cheap_reasoning
    escalation: strong_reasoning

  architect:
    default: strong_reasoning

  coder:
    default: balanced_coder
    escalation: frontier_coder

  reviewer:
    default: strong_reasoning_or_cheap_reviewer
    escalation: frontier_reviewer

  verifier:
    default: cheap_tool_user
    escalation: balanced_coder

  oracle:
    default: cheap_research
    escalation: strong_research
```

The router should choose based on:

```text id="uxt0bp"
role
task difficulty
repo risk
changed surface area
language/framework
expected tool use
need for browser
need for long context
budget remaining
past win rate
past cost
user priority
```

A task profile:

```json id="i5nq96"
{
  "tags": ["fullstack", "auth", "database", "nextjs"],
  "risk": "high",
  "estimated_context": "large",
  "requires_browser": true,
  "requires_external_docs": false,
  "parallelizable": true,
  "budget_tier": "medium"
}
```

Then route:

```json id="eiwc0i"
{
  "agent": "architect",
  "harness": "claude-code",
  "model": "opus",
  "reason": "High-risk fullstack auth task needs strong planning and long context."
}
```

or:

```json id="xg6hx0"
{
  "agent": "verifier",
  "harness": "opencode",
  "model": "cheap-fast-coder",
  "reason": "Mostly running deterministic tests and reporting failures."
}
```

## 7. Use a cost-adjusted score

For every agent run, compute:

```text id="m8pyvk"
utility = outcome_score
        - cost_penalty
        - time_penalty
        - human_intervention_penalty
        - retry_penalty
```

Example:

```text id="c5p3qw"
score = 1.0 * accepted
      + 0.4 * tests_passed
      + 0.2 * reviewer_score
      - 0.05 * cost_usd
      - 0.01 * minutes
      - 0.2 * needed_human_fix
```

Then your router can learn:

```text id="nto8tz"
For verifier tasks:
  cheap model wins because deterministic commands matter more than intelligence.

For architect tasks:
  frontier model wins because bad design causes expensive downstream failures.

For reviewer tasks:
  mid model may catch 80% of issues at 25% cost.

For hard debugging:
  strong model pays for itself.
```

This is how you escape manual vibes.

## 8. Start with a hand-written routing matrix

Do not wait for perfect data.

Use this initial policy:

```text id="q0nw4i"
spec_writer:
  medium/cheap reasoning model

architect:
  strongest model for complex tasks
  medium model for small tasks

coder:
  medium/high coding model by default
  strongest only for hard/ambiguous/core code

tester:
  cheap/medium coding model

reviewer:
  medium model first
  strong model for security/auth/payments/large diffs

verifier:
  cheap model or even deterministic script-first

evaluator:
  strong reasoning model when choosing between candidate diffs

oracle:
  cheap for docs/simple questions
  strong for architecture/research blockers

mutator:
  strong-ish reasoning model, but run infrequently
```

The biggest cost win is this:

```text id="6yyb1h"
Do not use frontier models for verifier/tester/scratch agents by default.
Use frontier models for architect/evaluator/hard coder.
```

## 9. Add escalation instead of perfect initial routing

Let cheap agents try first, then escalate when there are signals.

Escalation triggers:

```text id="6yx5wf"
- same step failed twice
- tests failing with unclear cause
- agent emitted low-confidence blocker
- large diff touches auth/payments/security
- reviewer found architectural issue
- command loop repeated same error
- human rejected output
```

Workflow:

```text id="kxpt5i"
cheap coder fails
  ↓
same worktree + trace sent to stronger coder
  ↓
strong coder fixes or explains blocker
```

This is usually cheaper than always starting with the best model.

## 10. Make harness/model choice observable

Every run should record:

```json id="40q0au"
{
  "agent": "coder",
  "harness": "opencode",
  "model": "gpt-5.4-high",
  "task_tags": ["nextjs", "api"],
  "outcome": "accepted",
  "cost_usd": 4.31,
  "wall_seconds": 1840,
  "human_interventions": 1,
  "tests_passed": true,
  "diff_files": 12
}
```

Then query:

```bash id="uf855j"
flt stats route --role coder --tag nextjs
flt stats route --role reviewer --tag security
flt stats cost --by harness --by model --by role
```

Output:

```text id="f4e474"
Role: reviewer, tag: nextjs
1. opencode + gpt-5.4-high
   accept contribution: 0.72, avg cost $0.91

2. claude-code + opus
   accept contribution: 0.78, avg cost $2.40

Recommendation:
   Use gpt-5.4-high by default; escalate to opus for auth/payment/security.
```

This is the actual answer to “how will I ever know?” — you collect local evidence.

## 11. Public benchmarks become priors, not truth

Seed your router from benchmark priors:

```yaml id="icd2s6"
priors:
  terminal_tasks:
    prefer:
      - harnesses_that_do_well_on_terminal_bench
  github_issue_repair:
    prefer:
      - harnesses_that_do_well_on_swe_bench
  enterprise_large_repo:
    prefer:
      - long_context_strong_retrieval_harness
```

But decayed by local performance:

```text id="ojavja"
router_score =
  0.25 * public_benchmark_prior
+ 0.60 * local_outcome_score
+ 0.15 * recent_reliability
```

Eventually local data dominates.

## 12. The most practical default storage plan

Use this:

```text id="y6sros"
.flt/flt.db
  sessions, runs, agents, artifacts, metrics, skills, workflows, routing decisions

.flt/runs/<run_id>/
  human-readable artifacts and logs

.flt/archive/
  compressed old runs

.flt/memory/
  lessons.jsonl
  project_facts.md
  failure_clusters.jsonl
```

SQLite tables:

```sql id="v5d3wq"
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  workflow TEXT,
  status TEXT,
  started_at TEXT,
  ended_at TEXT,
  final_score REAL,
  total_cost_usd REAL
);

CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  agent_name TEXT,
  role TEXT,
  harness TEXT,
  model TEXT,
  preset_hash TEXT,
  skills_json TEXT,
  status TEXT,
  cost_usd REAL,
  wall_seconds INTEGER,
  outcome_score REAL
);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  agent_run_id TEXT,
  type TEXT,
  path TEXT,
  status TEXT,
  keep INTEGER,
  summary TEXT
);

CREATE TABLE routing_observations (
  id TEXT PRIMARY KEY,
  role TEXT,
  task_tags TEXT,
  harness TEXT,
  model TEXT,
  score REAL,
  cost_usd REAL,
  accepted INTEGER,
  created_at TEXT
);
```

## 13. The answer to your three issues

### “SPEC.md files are slop / never read”

Make artifacts typed, statused, and garbage-collected.

```text id="y3k4gw"
scratch gets archived/deleted
spec/design/handoff gets summarized
final run summary survives
consumed artifacts are tracked
```

### “How to store data nicely but useful?”

Use:

```text id="rmr6ph"
JSONL/files for raw logs and artifacts
SQLite for index, metrics, state, routing, search
summaries for agent consumption
archive for old raw data
```

### “How do I know what harness + model to use per agent?”

Start with a hand-written routing policy, then learn from local traces.

```text id="4qzb3c"
public benchmarks = prior
your flt traces = truth
router = cost-adjusted role/task policy
escalation = safety valve
```

## 14. What I would build next

In order:

```text id="u106p5"
1. flt.db with runs, agent_runs, artifacts, routing_observations
2. artifact manifest + gc/summarize/archive command
3. workflow v2 artifacts: every step declares outputs
4. route policy YAML for role → harness/model
5. routing stats command
6. escalation rules
7. nightly report:
   - slop cleaned
   - failures clustered
   - routing recommendations updated
```

The important product loop becomes:

```text id="6fkqb8"
Run agents
  ↓
Collect artifacts/traces
  ↓
Summarize and archive junk
  ↓
Score harness/model/role outcomes
  ↓
Improve routing
  ↓
Mutate prompts/skills/workflows only with evidence
```

That is how `flt` stops being a pile of sessions and becomes a real agent OS.

[1]: https://arxiv.org/abs/2511.03690?utm_source=chatgpt.com "The OpenHands Software Agent SDK: A Composable and Extensible Foundation for Production Agents"
[2]: https://safedep.io/gryph-ai-agent-audit-trail?utm_source=chatgpt.com "Gryph: Audit Trail for AI Coding Agents"
[3]: https://www.swebench.com/?utm_source=chatgpt.com "SWE-bench Leaderboards"
[4]: https://www.tbench.ai/?utm_source=chatgpt.com "Terminal-Bench"
[5]: https://arxiv.org/html/2506.09289v1?utm_source=chatgpt.com "Rigorous Evaluation of Coding Agents on SWE-Bench"

