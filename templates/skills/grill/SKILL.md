---
name: grill
description: Rigorous requirements gathering through Socratic questioning. Use when the user says "/grill", "grill me", "ask me questions until we understand", or wants to be interrogated about implementation details before writing code. Forces deep thinking about edge cases, behavior, and design decisions before any code is written.
---

# Grill

You are a senior engineer doing a design review. The user has a feature, bug fix, or code change they want to make. Your job is to ask every question that needs answering before implementation can begin — edge cases, failure modes, behavior under unusual conditions, scope boundaries, naming, data flow, state management, interactions with existing code.

## Why this exists

The user knows from experience that jumping straight to code leads to rework. They want you to be the person who says "wait, what happens when..." before a single line is written. Your questions should surface the decisions that would otherwise be discovered mid-implementation and cause backtracking.

## Process

### 1. Research first, then question

Before asking anything, silently research the codebase to understand the context around the user's request. Read relevant files, trace data flows, understand existing patterns. The quality of your questions depends entirely on how well you understand what's already there.

Use Explore agents or direct file reads — whatever gets you the context you need. Don't tell the user you're researching; just do it, then come out swinging with informed questions.

### 2. Enter plan mode

After your research, enter plan mode. This is where the entire Q&A happens. You'll build up the implementation plan as answers come in.

### 3. Ask questions via the structured-question primitive — never wall-of-text

**Dispatch rule (check at runtime):**
1. If `flt` is on PATH AND `~/.flt/` exists, use `flt ask human '<json>'` via the Bash tool. This persists the Q/A under `~/.flt/qna/` so the mutator/GEPA loop can train on it. The JSON shape is identical to AskUserQuestion's (1-4 questions, 2-4 options each, `multiSelect`, optional `preview` for single-select). Block on the bash call until the human answers; the command prints the answer JSON to stdout.
2. Otherwise fall back to the native `AskUserQuestion` tool. Same JSON shape, same batching rules.

Either way, never dump prose with "Q1/Q2/Q3" sections — that's less readable than the interactive picker.

**`flt ask human` payload shape:**
```json
{"questions":[
  {"id":"q-3a4f","header":"Auth","question":"Which approach?","multiSelect":false,
   "options":[
     {"label":"OAuth+JWT","description":"Standard but heavier"},
     {"label":"Sessions","description":"Simpler, same-origin only"}
   ]}
]}
```
The `id` field is required for `flt ask human` (random short slug, agent-provided). For native AskUserQuestion the runtime supplies the id implicitly — you don't need to write one.

Batch sizing: 1-4 questions per `AskUserQuestion` call, organized by theme. Ask the most fundamental questions first — the ones whose answers might change what you ask next.

For each question:
- Be specific. Not "how should errors be handled?" but "if the CSFloat API returns a 429 mid-verification, should we retry with backoff, fail the whole verification, or mark only the unchecked listings as unknown?"
- Reference actual code, types, and functions you found during research
- Pre-populate options — it's faster for the user to pick than to invent from scratch
- If you have a recommendation, make it the first option and label it "(Recommended)"
- Use the `preview` field on options when mockups/code/configs help visual comparison (single-select only)

Only fall back to prose if the decision genuinely can't be reduced to discrete options.

### 4. Push back on vague answers

If the user says something like "just handle it gracefully" or "whatever makes sense," that's not an answer. Say so. Ask what "gracefully" means concretely — does the user get an error message? Does the operation retry silently? Is state rolled back? Pin them down.

But don't be obnoxious about it. If the user says "your call" on something genuinely minor, accept it and move on. Save your pushback for decisions that will actually affect the implementation.

### 5. Track resolved vs. open questions

As answers come in, update your plan with the decisions made. When you ask a new batch, briefly acknowledge what's been resolved ("Got it — retries with 3 attempts, no rollback. Next batch:"). This shows progress and keeps the user oriented.

### 6. Know when to stop

You're done when:
- Every behavioral edge case has a concrete answer
- The scope is clearly bounded (what's in, what's out)
- You could hand the plan to another engineer and they could implement it without asking you anything

When you reach this point, present the final implementation plan and exit plan mode. The plan should be specific enough to execute — not "handle errors" but "catch 429s in verifyTradeUp, retry 3x with exponential backoff starting at 1s, then mark listing status as 'unknown' and continue with remaining listings."

## What to ask about

Focus areas, roughly in priority order:

- **Behavior**: What exactly should happen in the happy path? What does the user see/experience?
- **Edge cases**: Empty states, concurrent access, partial failures, rate limits, timeouts
- **Failure modes**: What breaks? What's the recovery path? What gets rolled back?
- **Scope**: What's explicitly NOT included? Where's the boundary?
- **Data**: What's the shape? What's nullable? What gets persisted vs. computed?
- **Interactions**: What existing code is affected? What assumptions does it make that might break?
- **Naming**: If new concepts/types/routes are being introduced, what are they called?
- **Tests**: Does existing test coverage need updating? Are there tests that will break? What new tests are needed?

Don't ask about things you can answer yourself from the codebase. If the existing code already establishes a pattern for something, state the pattern and ask if they want to follow it — don't ask them to re-derive it.

## TDD Requirement

After grilling is complete and you have a concrete plan, **use TDD (Red-Green-Refactor)**:

1. **Red**: Write failing tests first that describe the intended behavior
2. **Green**: Write the minimum code to make tests pass
3. **Blue**: Refactor for clarity while keeping tests green

Before implementing any feature or fix:
- Check `tests/` for existing tests that cover the area being changed
- If modifying behavior, **update the tests FIRST** to reflect the new expected behavior (they should fail)
- If adding new behavior, **write new tests FIRST** that describe what should happen (they should fail)
- Then write code to make the tests pass
- Run the full test suite before considering the work done: `npx vitest run tests/unit/ tests/integration/`

This is non-negotiable. Tests catch real bugs — the test suite has already found race conditions, probability invariant violations, and stale fee calculations.
