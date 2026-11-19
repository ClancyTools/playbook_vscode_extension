import { PlaybookMetadata, camelToSnake, snakeToCamel } from "./metadata"
import { resolveGlobalPropsHost, scanUsages } from "./usageRules"
import { ScannedProp, ScannedUsage, literalValue } from "./usageScanner"

export interface TextEdit {
  start: number
  end: number
  newText: string
}

export interface Combinable {
  /** The first prop's name, where the hint is shown. */
  start: number
  end: number
  message: string
  title: string
  edits: TextEdit[]
}

/**
 * Pairs of side props that can be one axis prop. Verified in Playbook's
 * _spacing.scss: `py` is padding-top + padding-bottom, `px` is padding-left +
 * padding-right, and the same for margin.
 */
const PAIRS: Array<[string, string, string]> = [
  ["paddingTop", "paddingBottom", "paddingY"],
  ["paddingLeft", "paddingRight", "paddingX"],
  ["marginTop", "marginBottom", "marginY"],
  ["marginLeft", "marginRight", "marginX"],
]

const camelOf = (prop: ScannedProp) => snakeToCamel(prop.name)

/** The text to delete so `prop` disappears without leaving a stray comma or blank line. */
export function removalRange(text: string, usage: ScannedUsage, prop: ScannedProp): TextEdit {
  const end = prop.valueEnd ?? prop.nameEnd
  let start = prop.nameStart

  if (usage.platform === "react") {
    while (start > 0 && /\s/.test(text[start - 1])) {
      start--
    }
    return { start, end, newText: "" }
  }

  // Ruby hash: take the separating comma with it.
  let after = end
  while (after < text.length && /[ \t]/.test(text[after])) {
    after++
  }
  if (text[after] === ",") {
    after++
    while (after < text.length && /[ \t]/.test(text[after])) {
      after++
    }
    const lineStart = text.lastIndexOf("\n", start - 1) + 1
    const aloneOnLine = /^[ \t]*$/.test(text.slice(lineStart, start)) && (text[after] === "\n" || text[after] === "\r")
    if (aloneOnLine) {
      const newline = text[after] === "\r" && text[after + 1] === "\n" ? 2 : 1
      return { start: lineStart, end: after + newline, newText: "" }
    }
    return { start, end: after, newText: "" }
  }

  // Last prop: remove the comma before it instead.
  let before = start
  while (before > 0 && /\s/.test(text[before - 1])) {
    before--
  }
  if (text[before - 1] === ",") {
    return { start: before - 1, end, newText: "" }
  }
  return { start, end, newText: "" }
}

/**
 * Where two side props with the same string value could become one axis prop:
 * `paddingTop="sm" paddingBottom="sm"` -> `paddingY="sm"`. Skips usages with a
 * spread (it may set the axis prop), values that aren't plain strings, and pairs
 * whose axis prop is already there.
 */
export function findCombinableSpacing(
  text: string,
  languageId: string,
  metadata: PlaybookMetadata
): Combinable[] {
  const found: Combinable[] = []

  for (const usage of scanUsages(text, languageId)) {
    const component = resolveGlobalPropsHost(metadata, usage)
    if (!component || component.hasGlobalProps === false || usage.hasSpread) {
      continue
    }
    const byName = new Map(usage.props.map((p) => [camelOf(p), p]))

    for (const [a, b, axis] of PAIRS) {
      const first = byName.get(a)
      const second = byName.get(b)
      if (!first || !second || byName.has(axis)) {
        continue
      }
      const value = literalValue(first)
      if (typeof value !== "string" || value !== literalValue(second)) {
        continue
      }

      const [keep, drop] = first.nameStart < second.nameStart ? [first, second] : [second, first]
      const axisName = usage.platform === "rails" ? camelToSnake(axis) : axis
      const valueText = keep.valueText ?? ""
      const replacement = usage.platform === "rails" ? `${axisName}: ${valueText}` : `${axisName}=${valueText}`

      found.push({
        start: keep.nameStart,
        end: keep.nameEnd,
        message: `${first.name} and ${second.name} are both "${value}"; use ${axisName} instead.`,
        title: `Combine into ${axisName}="${value}"`,
        edits: [
          { start: keep.nameStart, end: keep.valueEnd ?? keep.nameEnd, newText: replacement },
          removalRange(text, usage, drop),
        ],
      })
    }
  }
  return found.sort((x, y) => x.start - y.start)
}

/** Applies non-overlapping edits to text (for tests and fix-all previews). */
export function applyEdits(text: string, edits: TextEdit[]): string {
  return [...edits]
    .sort((x, y) => y.start - x.start)
    .reduce((out, e) => out.slice(0, e.start) + e.newText + out.slice(e.end), text)
}
