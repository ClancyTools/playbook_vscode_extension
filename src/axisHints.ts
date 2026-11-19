import { InlineAnnotation, InlineHints } from "./inlineHints"
import { PlaybookMetadata, camelToSnake } from "./metadata"
import { axisLabel, axisRole, resolveOrientation } from "./flexAxis"
import { resolveComponent, scanUsages } from "./usageRules"
import { literalValue } from "./usageScanner"

/**
 * Shows which way a flex value points: `justify="center"` → `↔ center` in a
 * row, `↕ middle` in a column. Skipped when the orientation can't be known
 * from the code (a variable, a spread), since a wrong hint is worse than none.
 */
export function axisAnnotations(
  text: string,
  languageId: string,
  metadata: PlaybookMetadata
): InlineAnnotation[] {
  const annotations: InlineAnnotation[] = []

  for (const usage of scanUsages(text, languageId)) {
    const component = resolveComponent(metadata, usage)
    if (!component) {
      continue
    }
    const resolved = resolveOrientation(usage, component)
    if (!resolved) {
      continue
    }
    for (const prop of usage.props) {
      const snake = usage.platform === "react" ? camelToSnake(prop.name) : prop.name
      const role = axisRole(component, snake)
      const value = literalValue(prop)
      if (!role || typeof value !== "string" || prop.valueEnd === undefined) {
        continue
      }
      const label = axisLabel(role, resolved.orientation, value)
      if (label) {
        annotations.push({ offset: prop.valueEnd, label })
      }
    }
  }
  return annotations
}

/** Shows the axis flex values point along (playbook.axisHints). */
export class AxisHints extends InlineHints {
  constructor(extensionPath: string) {
    super(extensionPath, "axisHints", axisAnnotations)
  }
}
