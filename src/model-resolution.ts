// Model normalization for flt spawn paths.
// Mirrors harness-ts src/model-normalization.ts semantics (v0.2.x) until
// harness-ts exports a public resolver API.

const KNOWN_PROVIDERS = new Set([
  'anthropic',
  'azure',
  'azure-openai-responses',
  'bedrock',
  'deepseek',
  'gemini',
  'google',
  'groq',
  'mistral',
  'ollama',
  'openai',
  'openai-codex',
  'openrouter',
  'qwen',
  'vertex',
  'xai',
])

const BARE_MODEL_HARNESSES = new Set([
  'claude-code',
  'codex',
  'continue-cli',
  'gemini',
  'openclaude',
  'qwen',
])

const PROVIDER_MODEL_HARNESSES = new Set([
  'aider',
  'kilo',
  'opencode',
  'swe-agent',
])

const PRESERVE_EXPLICIT_PROVIDER_HARNESSES = new Set([
  'crush',
])

function stripKnownProviderPrefixes(model: string): string {
  let normalized = model.trim()
  while (true) {
    const slash = normalized.indexOf('/')
    if (slash < 0) return normalized
    const head = normalized.slice(0, slash).toLowerCase()
    if (!KNOWN_PROVIDERS.has(head)) return normalized
    normalized = normalized.slice(slash + 1).trim()
  }
}

function inferProviderForModel(model: string, defaultProvider = 'openai'): string {
  const m = model.trim().toLowerCase()
  if (!m) return defaultProvider
  if (m === 'sonnet' || m === 'opus' || m === 'haiku') return 'anthropic'
  if (m.startsWith('claude') || m.startsWith('sonnet') || m.startsWith('opus') || m.startsWith('haiku')) return 'anthropic'
  if (m.startsWith('gemini')) return 'google'
  if (m.startsWith('qwen')) return 'qwen'
  if (m.startsWith('deepseek')) return 'deepseek'
  if (m.startsWith('grok')) return 'xai'
  if (m.startsWith('mistral')) return 'mistral'
  return defaultProvider
}

function ensureProviderPrefix(model: string, defaultProvider = 'openai'): string {
  const normalized = model.trim()
  if (!normalized) return normalized

  const slash = normalized.indexOf('/')
  if (slash > 0) {
    const head = normalized.slice(0, slash).toLowerCase()
    if (KNOWN_PROVIDERS.has(head)) return normalized
  }

  const provider = inferProviderForModel(normalized, defaultProvider)
  return `${provider}/${normalized}`
}

export function resolveModelForCli(cli: string, model: string | undefined, noResolve = false): string | undefined {
  if (model === undefined) return undefined
  const normalized = model.trim()
  if (!normalized || noResolve) return normalized

  if (cli === 'pi') {
    if (normalized.includes('/')) {
      return ensureProviderPrefix(normalized, 'openai-codex')
    }
    if (normalized.toLowerCase().startsWith('gpt-5')) {
      return ensureProviderPrefix(normalized, 'openai-codex')
    }
    return normalized
  }

  if (cli === 'factory-droid') {
    const bare = stripKnownProviderPrefixes(normalized)
    if (bare.startsWith('custom:')) return bare
    return `custom:${bare}`
  }

  if (PROVIDER_MODEL_HARNESSES.has(cli)) {
    return ensureProviderPrefix(normalized)
  }

  if (PRESERVE_EXPLICIT_PROVIDER_HARNESSES.has(cli) && normalized.includes('/')) {
    return normalized
  }

  if (BARE_MODEL_HARNESSES.has(cli)) {
    return stripKnownProviderPrefixes(normalized)
  }

  return normalized
}
