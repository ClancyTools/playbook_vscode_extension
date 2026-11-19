import { ColorTokens, colorHoverLines, isColorProp } from "./colorTokens"
import { PlaybookMetadata, camelToSnake, getPropValues } from "./metadata"
import { IconIndex, iconPreviewDataUri, resolveIcon } from "./playbookIcons"
import { KitColors, kitColorFor } from "./kitColors"
import { resolveComponent, valueAt } from "./usageRules"
import { literalValue } from "./usageScanner"

export interface ValueHover {
  markdown: string
  start: number
  end: number
}

const ICON_PROP = /^icon(_right|_left)?$/

function swatchImage(css: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">` +
    `<rect x="1" y="1" width="18" height="18" rx="3" fill="${css}" stroke="#808080"/></svg>`
  return `![${css}](data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")})`
}

/**
 * Hover for the *value* of a color or icon prop: the real color behind a
 * Playbook token, or a preview of an icon.
 */
export function valueHover(
  text: string,
  languageId: string,
  offset: number,
  metadata: PlaybookMetadata,
  tokens: ColorTokens,
  icons: IconIndex | undefined,
  kitColors: KitColors = {}
): ValueHover | undefined {
  const hit = valueAt(text, languageId, offset)
  const component = hit && resolveComponent(metadata, hit.usage)
  if (!hit || !component || hit.prop.valueStart === undefined || hit.prop.valueEnd === undefined) {
    return undefined
  }
  const value = literalValue(hit.prop)
  if (typeof value !== "string") {
    return undefined
  }
  const snake = hit.usage.platform === "react" ? camelToSnake(hit.prop.name) : hit.prop.name
  const kitProp = component.props[snake]
  if (!kitProp) {
    return undefined
  }
  const range = { start: hit.prop.valueStart, end: hit.prop.valueEnd }

  // Icon / Legend: the color names come from the kit's stylesheet, not the schema.
  const kitColor = kitColorFor(metadata, component.rails, snake, value, kitColors)
  if (kitColor) {
    return { ...range, markdown: [swatchImage(kitColor.css), ...colorHoverLines(value, kitColor.css)].join("  \n") }
  }

  if (tokens[value] && isColorProp(snake, getPropValues(kitProp, languageId), tokens)) {
    return { ...range, markdown: [swatchImage(tokens[value]), ...colorHoverLines(value, tokens[value])].join("  \n") }
  }

  if (icons && ICON_PROP.test(snake)) {
    const resolved = resolveIcon(icons, value)
    if (!resolved) {
      return undefined
    }
    const lines: string[] = []
    const preview = iconPreviewDataUri(resolved.info)
    if (preview) {
      lines.push(`![${resolved.info.name}](${preview})`)
    }
    lines.push(`**${resolved.info.name}** — playbook-icons · ${resolved.info.category}`)
    if (resolved.viaAlias) {
      lines.push(`\`${value}\` is an alias of \`${resolved.info.name}\`.`)
    }
    lines.push("Custom SVG icon. Names that aren't in this set fall back to Font Awesome.")
    return { ...range, markdown: lines.join("  \n") }
  }
  return undefined
}
