- Updated `sendBootstrap` signature in `src/commands/spawn.ts` to:
  - `sendBootstrap(agent: AgentState, adapter, message, workDir)`
- Updated bootstrap call site in `spawnDirect` to pass the registered `agentState` object instead of a session string:
  - `await sendBootstrap(agentState, adapter, bootstrap, workDir)`
- Kept the `waitForReady` dialog path direct (out of scope by design):
  - `tmux.sendKeys(session, keys)` inside `waitForReady()` remains unchanged.

Additional test-harness fixes made to get unit coverage running in this workspace:
- `tests/unit/spawn.test.ts`
  - strengthened `@twaldin/harness-ts` mock to include `getAdapter`
  - mocked `getLocation` in state mock
  - added `tmux.resizeWindow` mock
  - switched `spawnDirect` import to dynamic import after mocks
- `tests/unit/spawn-bootstrap-uses-deliver.test.ts`
  - strengthened `@twaldin/harness-ts` mock to include `getAdapter`
  - switched `spawnDirect` import to dynamic import after mocks
