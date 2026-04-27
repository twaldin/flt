import { execSync } from 'child_process'

function gitCommitterEmail(cwd: string): string | null {
  try {
    const value = execSync('git config user.email', {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim().toLowerCase()
    return value || null
  } catch {
    return null
  }
}

export function redactSecrets(text: string): string {
  const allowEmail = gitCommitterEmail(process.cwd())
  const specs: Array<{ kind: string; re: RegExp }> = [
    { kind: 'API_KEY', re: /\bAPI_KEY\b\s*[=:]\s*\S+/g },
    { kind: 'AUTH_TOKEN', re: /\bAUTH_TOKEN\b\s*[=:]\s*\S+/g },
    { kind: 'BEARER', re: /\bBearer\s+[A-Za-z0-9._\-]+/gi },
    { kind: 'SK', re: /\bsk-[A-Za-z0-9_-]{8,}\b/g },
    { kind: 'PK', re: /\bpk-[A-Za-z0-9_-]{8,}\b/g },
    { kind: 'GHP', re: /\bghp_[A-Za-z0-9]{8,}\b/g },
    { kind: 'GITHUB_PAT', re: /\bgithub_pat_[A-Za-z0-9_]{8,}\b/g },
    { kind: 'AWS_KEY', re: /\bAKIA[A-Z0-9]+\b/g },
    { kind: 'EMAIL', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
    { kind: 'RANDOM', re: /\b[A-Za-z0-9]{32,}\b/g },
  ]

  let redacted = text
  for (const spec of specs) {
    redacted = redacted.replace(spec.re, (match: string) => {
      if (spec.kind === 'EMAIL' && allowEmail && match.toLowerCase() === allowEmail) return match
      return `<REDACTED:${spec.kind}>`
    })
  }
  return redacted
}
