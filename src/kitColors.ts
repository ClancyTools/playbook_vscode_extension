import { readBundledJson } from "./aiData"
import { InlineAnnotation } from "./inlineHints"
import { PlaybookMetadata, camelToSnake } from "./metadata"
import { ColorTokens } from "./scssColors"
import { suggest } from "./suggestions"
import { resolveComponent, scanUsages, Finding } from "./usageRules"
import { literalValue } from "./usageScanner"

/**
 * Kits whose `color` prop has no enum in Playbook's schema (Icon, Legend): the
 * names they accept come from the kit's stylesheet, extracted by
 * `npm run sync:data` into `data/ai/kit-colors.json`.
 *
 *   Icon:   `color_<name>` classes for the merged color maps in colors.scss
 *   Legend: data_1 … data_8, or a hex string (`#0056CF`)
 *
 * A name's value is "" when it is valid but its color couldn't be worked out.
 */
export type KitColors = Record<string, ColorTokens>

const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const KITS_WITH_COLOR_PROP = new Set(["icon", "legend"])

let cached: KitColors | undefined

export function resetKitColors(): void {
  cached = undefined
}

export function loadKitColors(extensionPath: string): KitColors {
  cached ??= readBundledJson<KitColors>(extensionPath, "ai", "kit-colors.json") ?? {}
  return cached
}

/** The key in kit-colors.json for a kit's prop: the kit for `color`, else `<kit>.<prop>`. */
export function kitColorKey(kit: string, snakeProp: string): string {
  return snakeProp === "color" ? kit : `${kit}.${snakeProp}`
}

/** Whether this prop's values mean the kit's own colors (swatches, hover). */
function usesKitColor(kit: string, snakeProp: string, colors: KitColors): boolean {
  return !!colors[kitColorKey(kit, snakeProp)]
}

/** Whether names are checked against the stylesheet (only props with no enum). */
function checksKitColor(kit: string, snakeProp: string, colors: KitColors): boolean {
  return KITS_WITH_COLOR_PROP.has(kit) && snakeProp === "color" && !!colors[kit]
}

/** The color to draw for a value, or undefined (no swatch). */
export function kitColorCss(kit: string, value: string, colors: KitColors): string | undefined {
  const known = colors[kit]
  if (!known) {
    return undefined
  }
  if (known[value]) {
    return known[value]
  }
  return kit === "legend" && HEX.test(value) ? value : undefined
}

/**
 * Whether Playbook gives a color to this name. Icon matches classes by prefix
 * (`[class*="color_<key>"]`), so `primary_action` is covered by `primary`; Legend
 * also accepts any hex string. Values that can't be checked count as known.
 */
export function isKnownKitColor(kit: string, value: string, colors: KitColors): boolean {
  const known = colors[kit]
  if (!known || value.trim() === "" || value.startsWith("#") || /[#$<{]/.test(value)) {
    return true
  }
  if (value in known) {
    return true
  }
  return kit === "icon" && Object.keys(known).some((key) => value.startsWith(key))
}

/**
 * Subcomponents have no schema, but Card's header takes the colors Card's data
 * describes (`header_color`), so it is mapped to its kit by hand.
 */
const SUBCOMPONENT_KITS: Record<string, string> = { "card/card_header": "card", "Card.Header": "card" }

/** Color boxes for color props that take a kit's own colors (Icon, Legend, Body, Card, …). */
export function kitColorAnnotations(
  text: string,
  languageId: string,
  metadata: PlaybookMetadata,
  colors: KitColors
): InlineAnnotation[] {
  const annotations: InlineAnnotation[] = []
  for (const usage of scanUsages(text, languageId)) {
    const component = resolveComponent(metadata, usage)
    const subKit = SUBCOMPONENT_KITS[usage.component]
    const kit = component?.rails ?? subKit
    if (!kit) {
      continue
    }
    for (const prop of usage.props) {
      const snake = usage.platform === "react" ? camelToSnake(prop.name) : prop.name
      const value = literalValue(prop)
      if (!usesKitColor(kit, snake, colors) || typeof value !== "string" || prop.valueEnd === undefined) {
        continue
      }
      const css = kitColorCss(kitColorKey(kit, snake), value, colors)
      if (css) {
        annotations.push({ offset: prop.valueEnd, swatch: css })
      }
    }
  }
  return annotations
}

/** The kit-specific color behind a value, for hover. */
export function kitColorFor(
  metadata: PlaybookMetadata,
  kit: string,
  snakeProp: string,
  value: string,
  colors: KitColors
): { css: string } | undefined {
  if (!usesKitColor(kit, snakeProp, colors) || !metadata.components) {
    return undefined
  }
  const css = kitColorCss(kitColorKey(kit, snakeProp), value, colors)
  return css ? { css } : undefined
}

/**
 * A color name the kit doesn't define: Playbook applies the color through a class
 * named after it, so nothing matches and no color is applied. Checked against the
 * kit's own stylesheet, never guessed.
 */
export function checkKitColors(
  text: string,
  languageId: string,
  metadata: PlaybookMetadata,
  colors: KitColors
): Finding[] {
  const findings: Finding[] = []
  for (const usage of scanUsages(text, languageId)) {
    const component = resolveComponent(metadata, usage)
    if (!component || usage.hasSpread) {
      continue
    }
    for (const prop of usage.props) {
      const snake = usage.platform === "react" ? camelToSnake(prop.name) : prop.name
      const value = literalValue(prop)
      if (
        !checksKitColor(component.rails, snake, colors) ||
        typeof value !== "string" ||
        prop.valueStart === undefined ||
        prop.valueEnd === undefined ||
        isKnownKitColor(component.rails, value, colors)
      ) {
        continue
      }
      const close = suggest(value, Object.keys(colors[component.rails]), 1)[0]
      findings.push({
        start: prop.valueStart,
        end: prop.valueEnd,
        message:
          `${component.react} has no color named "${value}", so none is applied.` +
          (close ? ` Did you mean "${close}"?` : ""),
        severity: "information",
        code: "unknown-kit-color",
      })
    }
  }
  return findings
}

export function kitColorSuggestions(kit: string, value: string, colors: KitColors, limit = 3): string[] {
  return colors[kit] ? suggest(value, Object.keys(colors[kit]), limit) : []
}
