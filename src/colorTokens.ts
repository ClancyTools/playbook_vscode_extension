import * as path from "path"
import { readBundledJson, resolveAiSource } from "./aiData"
import { ColorTokens, readTokenDirectory } from "./scssColors"
export { ColorTokens } from "./scssColors"
import { InlineAnnotation } from "./inlineHints"
import { PlaybookMetadata, camelToSnake, getPropValues } from "./metadata"
import { resolveComponent, scanUsages } from "./usageRules"
import { literalValue } from "./usageScanner"

/**
 * Playbook's color tokens (`$text_light: #4B546B !default;`) and a small box
 * showing the real color next to a prop that takes one.
 *
 * Tokens are public Playbook data, so a copy is bundled (`data/ai/color-tokens.json`,
 * written by `npm run sync:data`); a workspace's own `playbook-ui` is preferred
 * so the colors match the installed version.
 */

const cache = new Map<string, ColorTokens>()

export function resetColorTokens(): void {
  cache.clear()
}

/** The workspace's installed tokens when present, else the bundled copy. */
export function loadColorTokens(extensionPath: string): ColorTokens {
  const source = resolveAiSource(extensionPath)
  const key = source.bundled ? "bundled" : source.dir
  const cached = cache.get(key)
  if (cached) {
    return cached
  }
  let tokens: ColorTokens = source.bundled ? {} : readTokenDirectory(path.join(source.dir, "..", "tokens"))
  if (Object.keys(tokens).length === 0) {
    tokens = readBundledJson<ColorTokens>(extensionPath, "ai", "color-tokens.json") ?? {}
  }
  cache.set(key, tokens)
  return tokens
}

/**
 * A prop takes color tokens when its name says color or background *and* most of
 * its allowed values are token names (background_color, card.background,
 * pill_color). All three are needed to avoid drawing the wrong color:
 *   - a semantic value like `default` means something else on Body's `color`
 *     (the default *text* color) than the unrelated token `$default`;
 *   - `Pill variant="primary"` is a pill style, not the `$primary` swatch.
 */
export function isColorProp(propName: string, values: string[] | undefined, tokens: ColorTokens): boolean {
  if (!values || !/color|background/i.test(propName)) {
    return false
  }
  const known = values.filter((v) => tokens[v] !== undefined).length
  const candidates = values.filter((v) => v !== "none" && v !== "").length
  return known >= 3 && known / Math.max(candidates, 1) >= 0.75
}

/** Color boxes after the values of color props. */
export function colorAnnotations(
  text: string,
  languageId: string,
  metadata: PlaybookMetadata,
  tokens: ColorTokens
): InlineAnnotation[] {
  const annotations: InlineAnnotation[] = []
  if (Object.keys(tokens).length === 0) {
    return annotations
  }
  for (const usage of scanUsages(text, languageId)) {
    const component = resolveComponent(metadata, usage)
    if (!component) {
      continue
    }
    for (const prop of usage.props) {
      const snake = usage.platform === "react" ? camelToSnake(prop.name) : prop.name
      const kitProp = component.props[snake]
      const value = literalValue(prop)
      if (!kitProp || typeof value !== "string" || prop.valueEnd === undefined) {
        continue
      }
      if (isColorProp(snake, getPropValues(kitProp, languageId), tokens) && tokens[value]) {
        annotations.push({ offset: prop.valueEnd, swatch: tokens[value] })
      }
    }
  }
  return annotations
}

/** Hover text for a color token value. */
export function colorHoverLines(token: string, css: string): string[] {
  return [`**\`${token}\`** — Playbook color token`, `\`${css}\``]
}
