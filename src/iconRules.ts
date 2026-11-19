import { PlaybookMetadata, camelToSnake } from "./metadata"
import { IconIndex, iconSuggestions, resolveIcon } from "./playbookIcons"
import { resolveComponent, scanUsages, Finding } from "./usageRules"
import { ScannedProp, ScannedUsage, literalValue } from "./usageScanner"

/**
 * Icon props: `icon`, `iconRight`, `iconLeft` on kits whose schema has them
 * (not `iconColor`, `iconSize`, `iconFontFamily`, ...).
 */
const ICON_PROP = /^icon(_right|_left)?$/

const EMOJI = /\p{Extended_Pictographic}/u

function iconName(usage: ScannedUsage, prop: ScannedProp, hasProp: (snake: string) => boolean): string | undefined {
  const snake = usage.platform === "react" ? camelToSnake(prop.name) : prop.name
  if (!ICON_PROP.test(snake) || !hasProp(snake)) {
    return undefined
  }
  const value = literalValue(prop)
  return typeof value === "string" && value.trim() !== "" && !EMOJI.test(value) ? value : undefined
}

/**
 * Likely typos only: a name that is missing from the icon set *and* has a close
 * match. A missing name with no close match may be a Font Awesome icon (the Icon
 * kit falls back to Font Awesome), so it is left alone.
 */
export function checkIcons(
  text: string,
  languageId: string,
  metadata: PlaybookMetadata,
  index: IconIndex
): Finding[] {
  const findings: Finding[] = []
  for (const usage of scanUsages(text, languageId)) {
    const component = resolveComponent(metadata, usage)
    if (!component) {
      continue
    }
    for (const prop of usage.props) {
      const name = iconName(usage, prop, (snake) => !!component.props[snake])
      if (!name || prop.valueStart === undefined || prop.valueEnd === undefined || resolveIcon(index, name)) {
        continue
      }
      const [closest] = iconSuggestions(index, name, 1)
      if (closest) {
        findings.push({
          start: prop.valueStart,
          end: prop.valueEnd,
          message: `Icon "${name}" isn't in playbook-icons. Did you mean "${closest}"? (Ignore this if it is a Font Awesome icon.)`,
          severity: "information",
          code: "unknown-icon",
        })
      }
    }
  }
  return findings
}
