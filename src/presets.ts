import { ComponentMetadata, camelToSnake, isPropValidForPlatform } from "./metadata"
import { Playground, Preset } from "./playgrounds"

export interface RenderedPreset {
  name: string
  /** `key: value, other: true` — the inside of `props: { ... }`. */
  rails: string
  /** `variant="x" multiSelect` — the attributes of the JSX tag. */
  react: string
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

function jsString(value: string): string {
  return JSON.stringify(value)
}

function jsLiteral(value: unknown): string {
  if (value === null || value === undefined) {
    return "null"
  }
  if (typeof value === "string") {
    return jsString(value)
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(jsLiteral).join(", ")}]`
  }
  const entries = Object.entries(value as Record<string, unknown>).map(
    ([k, v]) => `${IDENTIFIER.test(k) ? k : jsString(k)}: ${jsLiteral(v)}`
  )
  return entries.length ? `{ ${entries.join(", ")} }` : "{}"
}

/**
 * Top-level props are Rails names (snake_case). Keys nested inside a value are
 * data the kit hands to its JavaScript as-is (`timePeriod`), so they keep
 * their spelling.
 */
function rubyKey(key: string, topLevel: boolean): string {
  const name = topLevel ? camelToSnake(key) : key
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? `${name}:` : `${JSON.stringify(name)}:`
}

function rubyLiteral(value: unknown): string {
  if (value === null || value === undefined) {
    return "nil"
  }
  if (typeof value === "string") {
    return JSON.stringify(value).replace(/#\{/g, "\\#{")
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(rubyLiteral).join(", ")}]`
  }
  const entries = Object.entries(value as Record<string, unknown>).map(
    ([k, v]) => `${rubyKey(k, false)} ${rubyLiteral(v)}`
  )
  return entries.length ? `{ ${entries.join(", ")} }` : "{}"
}

function jsxAttribute(name: string, value: unknown): string {
  if (value === true) {
    return name
  }
  if (typeof value === "string" && !/["\n\\]/.test(value)) {
    return `${name}=${jsString(value)}`
  }
  return `${name}={${jsLiteral(value)}}`
}

function platformProps(
  component: ComponentMetadata,
  preset: Preset,
  languageId: string
): Array<[string, unknown]> {
  return Object.entries(preset.props || {}).filter(([camel]) => {
    const prop = component.props[camelToSnake(camel)]
    // Global props and unknown names are kept; only props the schema says are
    // for the other platform are dropped.
    return !prop || isPropValidForPlatform(prop, languageId)
  })
}

/**
 * Presets from Playbook's playground that can be inserted as plain props.
 * Presets that describe a composition (`structureMode`: async, rich, ...) need
 * wrapper code, so they are left to Playbook's docs.
 */
export function renderPresets(
  component: ComponentMetadata,
  playground: Playground | undefined,
  languageId: string
): RenderedPreset[] {
  const rendered: RenderedPreset[] = []
  const seen = new Set<string>()

  for (const preset of playground?.presets || []) {
    if (preset.structureMode || seen.has(preset.name)) {
      continue
    }
    const entries = platformProps(component, preset, languageId)
    if (entries.length === 0) {
      continue // nothing useful to insert on this platform
    }
    seen.add(preset.name)
    rendered.push({
      name: preset.name,
      rails: entries.map(([k, v]) => `${rubyKey(k, true)} ${rubyLiteral(v)}`).join(", "),
      react: entries.map(([k, v]) => jsxAttribute(k, v)).join(" "),
    })
  }
  return rendered
}
