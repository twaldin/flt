import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { parse } from 'yaml'

export interface RouteDecision {
  preset: string
  escalation: string[]  // ordered list of preset names to try if primary fails
  reason: string
}

const SECURITY_TAGS = new Set(['security', 'auth', 'payments', 'payment', 'pci', 'secrets'])

function fltHome(): string {
  return join(process.env.HOME || homedir(), '.flt')
}

function loadYaml<T>(filePath: string): T {
  return parse(readFileSync(filePath, 'utf-8')) as T
}

interface Policy {
  [role: string]: string
}

interface EscalationOverrides {
  [roleOrWildcard: string]: string
}

interface EscalationTriggers {
  same_step_failed_twice?: EscalationOverrides
  low_confidence_blocker?: EscalationOverrides
  security_tagged_diff?: EscalationOverrides
  hard_debug_reproducible?: EscalationOverrides
}

interface EscalationConfig {
  triggers?: EscalationTriggers
}

function pickOverride(overrides: EscalationOverrides, role: string): string | undefined {
  return overrides[role] ?? overrides['*']
}

export function resolveRoute(
  role: string,
  taskTags?: string[],
  budgetTier?: 'low' | 'medium' | 'high',
): RouteDecision {
  const fltDir = fltHome()
  const policyPath = join(fltDir, 'routing', 'policy.yaml')
  const escalationPath = join(fltDir, 'routing', 'escalation.yaml')

  if (!existsSync(policyPath)) {
    throw new Error(`Routing policy not found at ${policyPath}. Run "flt init" first.`)
  }

  const policy = loadYaml<Policy>(policyPath)
  const preset = policy[role]
  if (!preset) {
    throw new Error(`No routing policy defined for role "${role}".`)
  }

  const escalation: string[] = []
  const reasons: string[] = [`policy: ${role} → ${preset}`]

  const hasSecurityTag = taskTags?.some(t => SECURITY_TAGS.has(t.toLowerCase())) ?? false

  if (existsSync(escalationPath)) {
    const config = loadYaml<EscalationConfig>(escalationPath)
    const triggers = config.triggers ?? {}

    if (hasSecurityTag && triggers.security_tagged_diff) {
      const override = pickOverride(triggers.security_tagged_diff, role)
      if (override && override !== preset && !escalation.includes(override)) {
        escalation.push(override)
        reasons.push(`security tag escalation → ${override}`)
      }
    }
  }

  if (budgetTier === 'low') {
    reasons.push('budget: low (prefer cheaper preset if available)')
  }

  return { preset, escalation, reason: reasons.join('; ') }
}
