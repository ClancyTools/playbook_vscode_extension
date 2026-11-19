/**
 * "Did you mean…" matching for prop names, values and kit names.
 */

/** Case-, camelCase- and snake_case-insensitive form used for comparison. */
export function normalizeName(name: string): string {
  return name.replace(/[_\-\s]/g, "").toLowerCase()
}

export function levenshtein(a: string, b: string): number {
  if (a === b) {
    return 0
  }
  if (!a.length) {
    return b.length
  }
  if (!b.length) {
    return a.length
  }
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    previous = current
  }
  return previous[b.length]
}

/**
 * Best matches for `input` among `candidates`, closest first.
 *
 * A candidate qualifies when it is an exact match ignoring case/underscores
 * (`marginbottom` → `margin_bottom`), contains or is contained by the input
 * (`bottom_margin`-style word swaps are covered by edit distance on short
 * names only), or is within a length-scaled edit distance.
 */
export function suggest(input: string, candidates: Iterable<string>, limit = 3): string[] {
  const target = normalizeName(input)
  if (!target) {
    return []
  }
  const maxDistance = target.length <= 4 ? 1 : target.length <= 8 ? 2 : 3

  const scored: Array<{ candidate: string; score: number }> = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (seen.has(candidate) || candidate === input) {
      continue
    }
    seen.add(candidate)
    const normalized = normalizeName(candidate)
    if (!normalized) {
      continue
    }

    let score: number | undefined
    if (normalized === target) {
      score = 0
    } else if (sameWords(input, candidate)) {
      score = 0.5
    } else {
      const distance = levenshtein(target, normalized)
      if (distance <= maxDistance) {
        score = distance
      } else if (
        target.length >= 4 &&
        (normalized.startsWith(target) || target.startsWith(normalized))
      ) {
        score = maxDistance + 0.5
      }
    }
    if (score !== undefined) {
      scored.push({ candidate, score })
    }
  }

  return scored
    .sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate))
    .slice(0, limit)
    .map((s) => s.candidate)
}

/** `bottom_margin` and `margin_bottom` use the same words in a different order. */
function sameWords(a: string, b: string): boolean {
  const words = (s: string) =>
    s
      .replace(/([a-z])([A-Z])/g, "$1_$2")
      .toLowerCase()
      .split(/[_\-\s]+/)
      .filter(Boolean)
      .sort()
      .join("|")
  return words(a) === words(b)
}
