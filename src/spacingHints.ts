import { PlaybookMetadata, camelToSnake } from "./metadata"
import { InlineAnnotation, InlineHints } from "./inlineHints"
import { resolveComponent, scanUsages } from "./usageRules"
import { ScannedUsage } from "./usageScanner"

export type SpacingAnnotation = InlineAnnotation

/**
 * Spacing props are the global props that take the shared spacing scale
 * (margin*, padding*): enum props that support responsive objects and list
 * the scale's steps.
 */
export function spacingPropNames(metadata: PlaybookMetadata): Set<string> {
  const names = new Set<string>()
  for (const [name, prop] of Object.entries(metadata.globalProps || {})) {
    if (prop.responsive && prop.values?.includes("sm") && prop.values.includes("md")) {
      names.add(name)
    }
  }
  return names
}

const TOKEN_IN_VALUE = /(["'])([a-z]+)\1/g

/**
 * Pixel hints for spacing tokens: `padding="md"` → `24px`. Also reads tokens
 * inside responsive objects (`{{ default: "sm", md: "lg" }}`).
 */
export function spacingAnnotations(
  text: string,
  languageId: string,
  metadata: PlaybookMetadata
): SpacingAnnotation[] {
  const tokens = metadata.spacingTokens
  if (!tokens) {
    return []
  }
  const spacingProps = spacingPropNames(metadata)
  const annotations: SpacingAnnotation[] = []

  for (const usage of scanUsages(text, languageId)) {
    if (!appliesSpacing(usage, metadata)) {
      continue
    }
    for (const prop of usage.props) {
      const snake = usage.platform === "react" ? camelToSnake(prop.name) : prop.name
      if (!spacingProps.has(snake) || prop.valueText === undefined || prop.valueStart === undefined) {
        continue
      }
      TOKEN_IN_VALUE.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = TOKEN_IN_VALUE.exec(prop.valueText)) !== null) {
        const px = tokens[match[2]]
        if (px) {
          annotations.push({ offset: prop.valueStart + match.index + match[0].length, label: px })
        }
      }
    }
  }
  return annotations
}

function appliesSpacing(usage: ScannedUsage, metadata: PlaybookMetadata): boolean {
  const component = resolveComponent(metadata, usage)
  return !!component && component.hasGlobalProps !== false
}

/** Shows spacing pixel hints after tokens in open Playbook files. */
export class SpacingHints extends InlineHints {
  constructor(extensionPath: string) {
    super(extensionPath, "spacingHints", spacingAnnotations)
  }
}
