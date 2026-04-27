# ROADMAP — Dynamic Pointing

v1 (tonight) evolves a single file: `controllers/planner.py`. That's deliberate — validate the hone→grader→mutator loop end-to-end on a proxy sim before adding any scheduler machinery. Everything below is queued for after v1 shows measurable improvement.

## The core risk when pointing at multiple modules

Modules aren't independent. If you evolve `planner.py` to be more aggressive, the attitude controller may not keep up, and the next round of eval will score the planner as crash-heavy — but the planner isn't the problem, the downstream module is. If you don't rotate, you end up conservatizing a fine planner to compensate for a broken module, which is backwards.

Two hard rules whenever the mutation target rotates:
1. **Freeze the previous module at its best checkpoint, not revert.** The whole stack has been improving together; don't throw that away.
2. **When a rotation doesn't produce the expected gain, the first question is "is this module actually the bottleneck, or is something else making it look bad?"** That's what the diagnose step below is ultimately protecting against.

## Progression (in order of when to build)

### Level 0 — Manual rotation
You eyeball `runs/*.csv`, notice 80% of crashes are vision-dropout in fast turns, manually point the next `hone run` at `gate_detector.py`. Five minutes of human judgment per rotation, highest leverage per hour of engineering work.

### Level 1 — Bottleneck-diagnosis wrapper (`hone-a-drone diagnose`)
Small script that reads the last run's per-rollout logs and classifies failure modes:
- crashed-on-approach
- overshot-gate
- vision-dropout
- control-loop-timeout

Each failure mode maps to a module. Prints `bottleneck: gate_detector (62% of failures)` and suggests the hone command. Still human-in-the-loop but removes the eyeballing step.

### Level 2 — Multi-module hone via GEPA's scope selection
GEPA supports multi-artifact optimization natively — pass it `{"planner": planner_code, "state_estimator": state_code, ...}` and it picks which to mutate per iteration based on Pareto reasoning. hone's `custom_candidate_proposer` hook exposes this. Right end-state, heavier to build; only worth it once Level 1 is paying off.

### Level 3 — Autonomous rotation meta-loop
`diagnose` becomes the scheduler: run N iterations on the current bottleneck, read results, pick next module, repeat. Walk away for a weekend, come back to a rotated, more-mutated stack. Full rotations are expensive, so every sub-loop needs to be well-tuned before this is worth it.

## When to start caring

Not yet. Get `controllers/planner.py` evolving and producing measurable improvement on the proxy sim first. That's the validation the loop works. Once there's a working baseline where hone reliably improves a single module, the payoff from rotating to others is real and the machinery above earns its keep. Building the scheduler before the single-module loop is proven is premature optimization — literally.
