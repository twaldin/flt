Implemented delivery abstraction in `src/delivery.ts` with:

- `export function deliver(agent: AgentState, text: string): void`
- `export function deliverKeys(agent: AgentState, keys: string[]): void`

Throw-message wording used for non-local branches:
- `"<location-type> delivery not yet implemented in this phase — see docs/ssh-sandbox-design.md"`

Exhaustive-check pattern used in both switches:
- `default: { const _exhaustive: never = loc; return _exhaustive }`
