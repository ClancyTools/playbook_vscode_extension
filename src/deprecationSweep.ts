import { PlaybookMetadata } from "./metadata"
import { checkUsages, resolveComponent, scanUsages } from "./usageRules"

export interface DeprecatedUsage {
  kind: "prop" | "kit"
  kit: string
  /** snake_case prop name; undefined when the whole kit is deprecated. */
  prop?: string
  line: number
  column: number
  message: string
  replacement?: string
}

function lineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 0
  let lineStart = 0
  for (let i = text.indexOf("\n"); i !== -1 && i < offset; i = text.indexOf("\n", i + 1)) {
    line++
    lineStart = i + 1
  }
  return { line, column: offset - lineStart }
}

/** Deprecated kits and props used in one file's text. */
export function sweepText(
  text: string,
  languageId: string,
  metadata: PlaybookMetadata
): DeprecatedUsage[] {
  const found: DeprecatedUsage[] = []

  for (const usage of scanUsages(text, languageId)) {
    const component = resolveComponent(metadata, usage)
    if (component?.status === "deprecated") {
      found.push({
        kind: "kit",
        kit: component.rails,
        ...lineColumn(text, usage.componentStart),
        message: `Kit "${usage.component}" is deprecated.`,
      })
    }
  }

  const props = checkUsages(text, {
    languageId,
    metadata,
    getPlayground: () => undefined,
    options: { deprecations: true, propDependencies: false, externalDependencies: false },
  })
  for (const finding of props) {
    if (finding.code === "deprecated-prop" && finding.kit && finding.prop) {
      found.push({
        kind: "prop",
        kit: finding.kit,
        prop: finding.prop,
        ...lineColumn(text, finding.start),
        message: finding.message,
        replacement: finding.replacement,
      })
    }
  }
  return found.sort((a, b) => a.line - b.line || a.column - b.column)
}

export interface DeprecationGroup {
  /** "flex · horizontal" or "caption (kit)". */
  label: string
  kit: string
  prop?: string
  replacement?: string
  count: number
}

/** Counts per deprecated kit/prop, most used first. */
export function summarize(items: Array<DeprecatedUsage & { file?: string }>): DeprecationGroup[] {
  const groups = new Map<string, DeprecationGroup>()
  for (const item of items) {
    const label = item.prop ? `${item.kit} · ${item.prop}` : `${item.kit} (kit)`
    const group = groups.get(label) || {
      label,
      kit: item.kit,
      prop: item.prop,
      replacement: item.replacement,
      count: 0,
    }
    group.count++
    groups.set(label, group)
  }
  return Array.from(groups.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}
