export function permuteTreatmentMap(n: number, presets: string[], seed: number): Record<string, string> {
  if (n < 1 || n > 26) {
    throw new Error('n must be between 1 and 26')
  }

  if (presets.length !== n) {
    throw new Error('presets.length must equal n')
  }

  const rand = mulberry32(seed)
  const shuffled = presets.slice()

  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = shuffled[i]
    shuffled[i] = shuffled[j]
    shuffled[j] = tmp
  }

  const map: Record<string, string> = {}
  for (let i = 0; i < n; i += 1) {
    map[String.fromCharCode(97 + i)] = shuffled[i]
  }

  return map
}

function mulberry32(seed: number): () => number {
  let t = seed
  return () => {
    t += 0x6D2B79F5
    let x = Math.imul(t ^ (t >>> 15), t | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}
