Implemented Node 3 refactor in `src/commands/send.ts` and added the requested unit lock-in test.

Replaced blocks:
- Parent-routing send block:
  - Before: `src/commands/send.ts` old lines ~70-76 (`tmux.pasteBuffer`/`tmux.sendLiteral` + `tmux.sendKeys`)
  - After: `src/commands/send.ts` current lines ~68-72 (`deliver(parentAgent, tagged)` + `deliverKeys(parentAgent, submitKeys)` with existing `await sleep(300)` preserved)
- Agent-target send block:
  - Before: `src/commands/send.ts` old lines ~95-101 (`tmux.pasteBuffer`/`tmux.sendLiteral` + `tmux.sendKeys`)
  - After: `src/commands/send.ts` current lines ~94-98 (`deliver(agent, tagged)` + `deliverKeys(agent, submitKeys)` with existing `await sleep(300)` preserved)

New test:
- `tests/unit/send-uses-deliver.test.ts`
  - Verifies `sendDirect({ target: 'someAgent', message: 'hi' })` calls:
    - `deliver` with the full `AgentState` object (not a session string)
    - `deliverKeys` with the adapter submit keys.

Additional stabilization from retry failure:
- `src/harness.ts`: restored `tokens_in` reporting to raw input tokens so `tests/unit/harness.test.ts` and full `bun test` pass again.

Verification:
- `bun test tests/unit/send-uses-deliver.test.ts` ✅
- `bun test tests/unit/spawn.test.ts` ✅
- `bun test` ✅
- `npx tsc --noEmit` ❌ blocked by pre-existing unrelated type errors in out-of-scope files.
- `rg -n "tmux\.(sendLiteral|sendKeys|pasteBuffer)" src/commands/send.ts` ✅ zero hits.
