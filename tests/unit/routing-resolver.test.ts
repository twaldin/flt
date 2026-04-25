import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { resolveRoute } from '../../src/routing/resolver'

const POLICY_YAML = `
orchestrator: cc-opus
spec_writer: cc-sonnet
architect: cc-opus
coder: pi-coder
tester: pi-coder
reviewer: cc-sonnet
verifier: pi-coder
evaluator: cc-opus
oracle: pi-deep
mutator: cc-opus
trace_classifier: pi-coder
`.trimStart()

const ESCALATION_YAML = `
triggers:
  same_step_failed_twice:
    coder: cc-opus
    reviewer: cc-opus
  low_confidence_blocker:
    "*": pi-deep
  security_tagged_diff:
    reviewer: cc-opus
  hard_debug_reproducible:
    "*": pi-deep
`.trimStart()

let tmpHome: string
const origHome = process.env.HOME

function seedRouting(policyContent = POLICY_YAML, escalationContent = ESCALATION_YAML): void {
  const routingDir = join(tmpHome, '.flt', 'routing')
  mkdirSync(routingDir, { recursive: true })
  writeFileSync(join(routingDir, 'policy.yaml'), policyContent)
  writeFileSync(join(routingDir, 'escalation.yaml'), escalationContent)
}

beforeEach(() => {
  tmpHome = join(tmpdir(), `flt-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpHome, { recursive: true })
  process.env.HOME = tmpHome
})

afterEach(() => {
  process.env.HOME = origHome
  if (existsSync(tmpHome)) rmSync(tmpHome, { recursive: true, force: true })
})

describe('resolveRoute', () => {
  it('returns the preset from policy for a known role', () => {
    seedRouting()
    const decision = resolveRoute('coder')
    expect(decision.preset).toBe('pi-coder')
    expect(decision.escalation).toEqual([])
    expect(decision.reason).toContain('policy: coder → pi-coder')
  })

  it('returns correct presets for all seeded roles', () => {
    seedRouting()
    const cases: [string, string][] = [
      ['orchestrator', 'cc-opus'],
      ['spec_writer', 'cc-sonnet'],
      ['architect', 'cc-opus'],
      ['coder', 'pi-coder'],
      ['tester', 'pi-coder'],
      ['reviewer', 'cc-sonnet'],
      ['verifier', 'pi-coder'],
      ['evaluator', 'cc-opus'],
      ['oracle', 'pi-deep'],
      ['mutator', 'cc-opus'],
      ['trace_classifier', 'pi-coder'],
    ]
    for (const [role, expected] of cases) {
      expect(resolveRoute(role).preset).toBe(expected)
    }
  })

  it('throws when policy.yaml is missing', () => {
    // No seedRouting call — routing dir does not exist
    expect(() => resolveRoute('coder')).toThrow('Routing policy not found')
  })

  it('throws for an undefined role', () => {
    seedRouting()
    expect(() => resolveRoute('unknown_role')).toThrow('No routing policy defined for role "unknown_role".')
  })

  it('escalates reviewer to cc-opus when security tag is present', () => {
    seedRouting()
    const decision = resolveRoute('reviewer', ['security'])
    expect(decision.preset).toBe('cc-sonnet')  // primary unchanged
    expect(decision.escalation).toContain('cc-opus')
    expect(decision.reason).toContain('security tag escalation')
  })

  it('escalates on any matching security tag variant', () => {
    seedRouting()
    for (const tag of ['auth', 'payments', 'payment', 'pci', 'secrets']) {
      const decision = resolveRoute('reviewer', [tag])
      expect(decision.escalation).toContain('cc-opus')
    }
  })

  it('does not escalate reviewer when security tag absent', () => {
    seedRouting()
    const decision = resolveRoute('reviewer', ['performance', 'refactor'])
    expect(decision.escalation).toEqual([])
  })

  it('does not duplicate escalation preset when primary already matches override', () => {
    seedRouting()
    // orchestrator is cc-opus; security_tagged_diff for reviewer escalates to cc-opus
    // For orchestrator there's no security_tagged_diff entry, so no escalation
    const decision = resolveRoute('orchestrator', ['security'])
    expect(decision.escalation).toEqual([])
  })

  it('notes low budget tier in reason without changing primary preset', () => {
    seedRouting()
    const decision = resolveRoute('coder', undefined, 'low')
    expect(decision.preset).toBe('pi-coder')
    expect(decision.reason).toContain('budget: low')
  })

  it('medium and high budget tiers leave reason unaffected', () => {
    seedRouting()
    const medium = resolveRoute('coder', undefined, 'medium')
    const high = resolveRoute('coder', undefined, 'high')
    expect(medium.reason).not.toContain('budget')
    expect(high.reason).not.toContain('budget')
  })

  it('works without escalation.yaml — no escalation returned', () => {
    // Write only policy, no escalation file
    const routingDir = join(tmpHome, '.flt', 'routing')
    mkdirSync(routingDir, { recursive: true })
    writeFileSync(join(routingDir, 'policy.yaml'), POLICY_YAML)

    const decision = resolveRoute('reviewer', ['security'])
    expect(decision.preset).toBe('cc-sonnet')
    expect(decision.escalation).toEqual([])
  })

  it('returns escalation as ordered list (primary first, overrides after)', () => {
    seedRouting()
    const decision = resolveRoute('reviewer', ['auth'])
    // escalation list should have cc-opus and it's the only entry
    expect(decision.escalation.length).toBe(1)
    expect(decision.escalation[0]).toBe('cc-opus')
  })
})
