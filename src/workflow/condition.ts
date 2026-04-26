export function evaluateCondition(expr: string, vars: Record<string, unknown>): boolean {
  const parsed = parseCondition(expr)
  const left = resolveOperand(parsed.left, expr, vars)
  const right = resolveOperand(parsed.right, expr, vars)
  if (parsed.op === '==') {
    return String(left) === String(right)
  }

  return String(left) !== String(right)
}

type Operator = '==' | '!='

function parseCondition(expr: string): { left: string; op: Operator; right: string } {
  let quote: "'" | '"' | null = null
  let braceDepth = 0

  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i]

    if (quote) {
      if (ch === quote) {
        quote = null
      }
      continue
    }

    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }

    if (ch === '{') {
      braceDepth += 1
      continue
    }

    if (ch === '}') {
      if (braceDepth > 0) {
        braceDepth -= 1
      }
      continue
    }

    if (braceDepth === 0 && (ch === '=' || ch === '!') && expr[i + 1] === '=') {
      const op = expr.slice(i, i + 2)
      if (op === '==' || op === '!=') {
        return {
          left: expr.slice(0, i).trim(),
          op,
          right: expr.slice(i + 2).trim(),
        }
      }
    }
  }

  if (quote) {
    throw new Error(`condition: unclosed quote in: ${expr}`)
  }

  if (braceDepth > 0) {
    throw new Error(`condition: unclosed brace in: ${expr}`)
  }

  throw new Error('condition: missing operator (use == or !=)')
}

function resolveOperand(text: string, expr: string, vars: Record<string, unknown>): string {
  if (text.startsWith('{')) {
    if (!text.endsWith('}')) {
      throw new Error(`condition: unclosed brace in: ${expr}`)
    }

    const path = text.slice(1, -1)
    const resolved = getByPath(vars, path)
    if (resolved === undefined || resolved === null) {
      return ''
    }
    return String(resolved)
  }

  if (text.startsWith("'")) {
    if (!text.endsWith("'")) {
      throw new Error(`condition: unclosed quote in: ${expr}`)
    }

    return text.slice(1, -1)
  }

  if (text.startsWith('"')) {
    if (!text.endsWith('"')) {
      throw new Error(`condition: unclosed quote in: ${expr}`)
    }

    return text.slice(1, -1)
  }

  throw new Error(`condition: invalid operand: ${text}`)
}

function getByPath(source: Record<string, unknown>, path: string): unknown {
  if (!path) {
    return ''
  }

  const parts = path.split('.')
  let current: unknown = source

  for (const part of parts) {
    if (!current || typeof current !== 'object' || !(part in current)) {
      return ''
    }
    current = (current as Record<string, unknown>)[part]
  }

  return current
}
