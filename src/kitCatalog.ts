import {
  ComponentMetadata,
  Platform,
  PlaybookMetadata,
  isComponentValidForPlatform,
} from "./metadata"
import { Playground } from "./playgrounds"
import { RenderedPreset, renderPresets } from "./presets"

/**
 * The browsable list of Playbook kits, grouped by Playbook's own categories.
 * Pure data shaping; the QuickPick and tree view render it.
 */

export interface CatalogKit {
  /** React name, e.g. "DateRangeInline". */
  react: string
  /** Rails name, e.g. "date_range_inline". */
  rails: string
  description: string
  category: string
  status?: string
  platforms: Platform[]
  /** Phrases describing what the kit looks like, used for searching. */
  looksLike: string[]
}

export interface CatalogCategory {
  id: string
  label: string
  description?: string
  kits: CatalogKit[]
}

const UNCATEGORISED = "other"

export function categoryLabel(id: string): string {
  const words = id.replace(/_/g, " ").trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function buildCatalog(
  metadata: PlaybookMetadata,
  categoryDescriptions: Record<string, string> = {},
  platform?: Platform
): CatalogCategory[] {
  const byCategory = new Map<string, CatalogKit[]>()

  for (const component of Object.values(metadata.components)) {
    if (platform && !isComponentValidForPlatform(component, platform === "rails" ? "erb" : "typescriptreact")) {
      continue
    }
    const category = component.category || UNCATEGORISED
    const kits = byCategory.get(category) || []
    kits.push({
      react: component.react,
      rails: component.rails,
      description: component.description,
      category,
      status: component.status,
      platforms: (component.platforms as Platform[] | undefined) || ["react", "rails"],
      looksLike: component.visual?.looksLike || [],
    })
    byCategory.set(category, kits)
  }

  return Array.from(byCategory.entries())
    .map(([id, kits]) => ({
      id,
      label: categoryLabel(id),
      description: categoryDescriptions[id],
      kits: kits.sort((a, b) => a.react.localeCompare(b.react)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** Kits matching every word of the query in their name, description, category or look-alike phrases. */
export function filterCatalog(catalog: CatalogCategory[], query: string): CatalogCategory[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return catalog
  }
  return catalog
    .map((category) => ({
      ...category,
      kits: category.kits.filter((kit) => {
        const haystack = [kit.react, kit.rails.replace(/_/g, " "), kit.description, category.label, ...kit.looksLike]
          .join(" ")
          .toLowerCase()
        return words.every((word) => haystack.includes(word))
      }),
    }))
    .filter((category) => category.kits.length > 0)
}

/** Playbook's documented example for the kit on a platform. */
export function exampleFor(component: ComponentMetadata, platform: Platform): string | undefined {
  return platform === "rails" ? component.railsExample : component.reactExample
}

export interface KitAction {
  label: string
  description?: string
  /** Text to insert; undefined for actions that don't insert (open docs, ...). */
  text?: string
  kind: "example" | "preset" | "docs" | "copy"
}

/**
 * What can be done with a kit for the platform of the file being edited.
 * With no platform (no editor open) the examples for both are offered as copies.
 */
export function kitActions(
  component: ComponentMetadata,
  playground: Playground | undefined,
  platform: Platform | undefined
): KitAction[] {
  const actions: KitAction[] = []
  const example = platform && exampleFor(component, platform)

  if (platform) {
    if (example) {
      actions.push({
        label: "Insert example",
        description: component.examplePreset ? `"${component.examplePreset}"` : undefined,
        text: example,
        kind: "example",
      })
    }
    const languageId = platform === "rails" ? "erb" : "typescriptreact"
    for (const preset of renderPresets(component, playground, languageId)) {
      actions.push({
        label: `Insert preset: ${preset.name}`,
        text: presetText(component, preset, platform),
        kind: "preset",
      })
    }
  } else {
    for (const p of ["react", "rails"] as Platform[]) {
      const text = exampleFor(component, p)
      if (text && (!component.platforms || component.platforms.includes(p))) {
        actions.push({ label: `Copy ${p === "react" ? "React" : "Rails"} example`, text, kind: "copy" })
      }
    }
  }
  actions.push({ label: "Open Playbook docs", kind: "docs" })
  return actions
}

function presetText(component: ComponentMetadata, preset: RenderedPreset, platform: Platform): string {
  if (platform === "rails") {
    return component.hasChildren
      ? `<%= pb_rails("${component.rails}", props: { ${preset.rails} }) do %>\n  \n<% end %>`
      : `<%= pb_rails("${component.rails}", props: { ${preset.rails} }) %>`
  }
  return component.hasChildren
    ? `<${component.react} ${preset.react}>\n  \n</${component.react}>`
    : `<${component.react} ${preset.react} />`
}
