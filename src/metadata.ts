import {
  readAiJson,
  readBundledJson,
  resetAiData,
  resolveAiSource,
  forceBundledSource,
  AiSource,
} from "./aiData"
import type { Playground } from "./playgrounds"

export type Platform = "rails" | "react"

/** Rails-flavoured languages; everything else is treated as React. */
export function platformFor(languageId: string): Platform {
  return ["ruby", "erb", "html.erb", "html"].includes(languageId) ? "rails" : "react"
}

export interface PlatformSplit<T> {
  react?: T
  rails?: T
}

export interface DeprecationInfo {
  message?: string
  replacement?: string
  platforms: Platform[]
}

export interface NestedPropShape {
  type: string
  values?: string[]
}

export interface PropMetadata {
  /** React's type when the platforms differ (see typeByPlatform). */
  type: string
  default?: string
  /** Union of every platform's values; use getPropValues for a platform's own. */
  values?: string[]
  typeByPlatform?: PlatformSplit<string>
  valuesByPlatform?: PlatformSplit<string[]>
  defaultByPlatform?: PlatformSplit<string>
  deprecated?: DeprecationInfo
  platforms?: string[]
  required?: boolean
  description?: string
  example?: string
  responsive?: boolean
  properties?: Record<string, NestedPropShape>
}

export interface ExternalDependency {
  packages: string[]
  note?: string
  optional?: boolean
  docs?: string
}

export interface KitVisualInfo {
  looksLike?: string[]
  /** Kits people confuse this one with (and should use instead). */
  not?: string[]
  gotchas?: string[]
  typicalProps?: string[]
}

export interface KitFaq {
  id: string
  platforms?: string[]
  questions: string[]
  answer: string
}

export interface ComponentMetadata {
  rails: string
  react: string
  description: string
  hasChildren: boolean
  props: Record<string, PropMetadata>
  platforms?: string[]
  status?: string
  externalDependencies?: ExternalDependency
  category?: string
  reactImport?: string
  hasGlobalProps?: boolean
  reactExample?: string
  railsExample?: string
  railsNote?: string
  examplePreset?: string
  visual?: KitVisualInfo
  faqs?: KitFaq[]
  /** Deprecated props keyed by snake_case name. */
  deprecatedProps?: Record<string, DeprecationInfo>
}

/** What Playbook publishes about a `Playbook::Forms::Builder` method. */
export interface FormMethodContract {
  signature?: string
  example?: string
  /** Prose from the contract, keyed by topic (binding, validation, ...). */
  notes: Array<{ topic: string; text: string }>
}

export interface FormBuilderField {
  name: string
  kit: string
  props: Record<string, PropMetadata>
  contract?: FormMethodContract
}

export interface FormBuilderMetadata {
  fields: FormBuilderField[]
}

export interface DomSafeWarning {
  description: string
  nonSafeProps: string[]
}

export interface PlaybookMetadata {
  /** Playbook version and origin of the data these docs came from. */
  version?: string
  source?: AiSource
  globalProps?: Record<string, PropMetadata>
  components: Record<string, ComponentMetadata>
  formBuilders?: FormBuilderMetadata
  spacingTokens?: Record<string, string>
  breakpoints?: Record<string, string>
  domSafeWarning?: DomSafeWarning
}

interface RawNestedPropShape {
  type?: string
  values?: unknown[]
}

type RawSplit<T> = T | PlatformSplit<T>

interface RawPropData {
  type?: RawSplit<string>
  default?: unknown
  values?: RawSplit<unknown[]>
  platforms?: string[]
  description?: string
  example?: string
  responsive?: boolean
  properties?: Record<string, RawNestedPropShape>
}

interface RawExternalDependency {
  packages?: string[]
  note?: string
  optional?: boolean
  docs?: string
}

interface RawKit {
  name?: string
  description?: string
  platforms?: string[]
  status?: string
  category?: string
  globalProps?: boolean
  externalDependencies?: RawExternalDependency
  usage?: {
    react?: {
      import?: string
      example?: string
      preset?: string
    }
    rails?: {
      example?: string
      preset?: string
      note?: string
    }
  }
  props?: Record<string, RawPropData>
  faqs?: KitFaq[]
}

interface RawVisualKit {
  looksLike?: string[]
  not?: string[]
  gotchas?: string[]
  cues?: { typicalProps?: string[] }
}

interface RawSchema {
  version?: string
  globalProps?: {
    props?: Record<string, RawPropData>
    spacing?: {
      tokens?: Record<string, string>
    }
    breakpoints?: Record<string, string>
    warnings?: {
      domSafeProps?: {
        description?: string
        nonSafeProps?: string[]
      }
    }
  }
  kits?: Record<string, RawKit>
}

let cachedMetadata: PlaybookMetadata | null = null

/** Forget loaded metadata so the next lookup re-discovers the Playbook source. */
export function resetMetadataCache(): void {
  cachedMetadata = null
  cachedFormBuilderMetadata = null
  resetAiData()
}

export function camelToSnake(str: string): string {
  return str.replace(/([A-Z])/g, "_$1").toLowerCase()
}

export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

/** True for Playbook's `{ react, rails }` platform-split representation. */
function isSplit(value: unknown): value is PlatformSplit<unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  const keys = Object.keys(value)
  return keys.length > 0 && keys.every((k) => k === "react" || k === "rails")
}

function stringifyDefault(value: unknown): string {
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)
}

function stringValues(values: unknown[]): string[] {
  return values.map((v) => String(v))
}

function transformValues(raw: RawSplit<unknown[]> | undefined): {
  values?: string[]
  valuesByPlatform?: PlatformSplit<string[]>
} {
  if (Array.isArray(raw)) {
    return { values: stringValues(raw) }
  }
  if (isSplit(raw)) {
    const byPlatform: PlatformSplit<string[]> = {}
    if (Array.isArray(raw.react)) {
      byPlatform.react = stringValues(raw.react)
    }
    if (Array.isArray(raw.rails)) {
      byPlatform.rails = stringValues(raw.rails)
    }
    const union = Array.from(new Set([...(byPlatform.react || []), ...(byPlatform.rails || [])]))
    return { values: union, valuesByPlatform: byPlatform }
  }
  return {}
}

function transformProp(
  raw: RawPropData,
  deprecation?: DeprecationInfo
): PropMetadata {
  const prop: PropMetadata = { type: "string" }

  if (isSplit(raw.type)) {
    const byPlatform: PlatformSplit<string> = {}
    if (raw.type.react !== undefined) {
      byPlatform.react = String(raw.type.react)
    }
    if (raw.type.rails !== undefined) {
      byPlatform.rails = String(raw.type.rails)
    }
    prop.type = byPlatform.react ?? byPlatform.rails ?? "string"
    prop.typeByPlatform = byPlatform
  } else if (typeof raw.type === "string" && raw.type) {
    prop.type = raw.type
  }

  Object.assign(prop, transformValues(raw.values))

  if (isSplit(raw.default)) {
    const byPlatform: PlatformSplit<string> = {}
    if (raw.default.react !== undefined) {
      byPlatform.react = stringifyDefault(raw.default.react)
    }
    if (raw.default.rails !== undefined) {
      byPlatform.rails = stringifyDefault(raw.default.rails)
    }
    prop.default = byPlatform.react ?? byPlatform.rails
    prop.defaultByPlatform = byPlatform
  } else if (raw.default !== undefined) {
    prop.default = stringifyDefault(raw.default)
  }

  if (raw.platforms) {
    prop.platforms = raw.platforms
  }
  if (raw.description !== undefined) {
    prop.description = raw.description
  }
  if (raw.example !== undefined) {
    prop.example = raw.example
  }
  if (raw.responsive !== undefined) {
    prop.responsive = raw.responsive
  }
  if (raw.properties) {
    prop.properties = Object.fromEntries(
      Object.entries(raw.properties).map(([nestedName, nested]) => [
        nestedName,
        {
          type: nested.type || "string",
          values: nested.values?.map((v: unknown) => String(v)),
        },
      ])
    )
  }
  if (deprecation) {
    prop.deprecated = deprecation
  }
  return prop
}

/**
 * Places where Playbook's published schema is wrong for one platform. Each
 * entry removes the enum values for that platform so valid code isn't flagged.
 * Found by running the extension over Nitro's real code; fix upstream, then
 * delete the entry.
 */
const SCHEMA_CORRECTIONS: ReadonlyArray<{
  kit: string
  prop: string
  platform: Platform
  reason: string
}> = [
  {
    kit: "tooltip",
    prop: "position",
    platform: "rails",
    reason:
      "React's position is the CSS strategy (absolute | fixed). Rails passes position to pb_tooltip_position as the placement (\"top\", \"bottom\", ...), but the schema publishes React's values for both.",
  },
]

interface RawDeprecations {
  props?: Record<string, Record<string, DeprecationInfo>>
}

interface RawVisualIndex {
  kits?: Record<string, RawVisualKit>
}

function transformSchema(
  raw: RawSchema,
  extensionPath: string
): PlaybookMetadata {
  const metadata: PlaybookMetadata = {
    components: {},
    globalProps: {},
  }

  // Transform global props (camelCase → snake_case)
  if (raw.globalProps?.props) {
    for (const [camelName, prop] of Object.entries(raw.globalProps.props)) {
      if (camelName.startsWith("$")) {
        continue
      }
      metadata.globalProps![camelToSnake(camelName)] = transformProp(prop)
    }
  }

  // Schema-wide reference data (spacing scale, breakpoints, DOM-safety
  // warnings) — surfaced in prop hover docs rather than duplicated per-prop
  if (raw.globalProps?.spacing?.tokens) {
    metadata.spacingTokens = raw.globalProps.spacing.tokens
  }
  if (raw.globalProps?.breakpoints) {
    metadata.breakpoints = raw.globalProps.breakpoints
  }
  if (raw.globalProps?.warnings?.domSafeProps?.nonSafeProps) {
    metadata.domSafeWarning = {
      description: raw.globalProps.warnings.domSafeProps.description || "",
      nonSafeProps: raw.globalProps.warnings.domSafeProps.nonSafeProps,
    }
  }

  // Hardcoded global props that are always available
  const hardcodedGlobals = [
    "id",
    "data",
    "aria",
    "html_options",
    "children",
    "style",
    "classname",
  ]
  for (const propName of hardcodedGlobals) {
    if (!metadata.globalProps![propName]) {
      metadata.globalProps![propName] = { type: "string" }
    }
  }

  const visualIndex = readAiJson<RawVisualIndex>(extensionPath, "visual-index.json")
  const deprecations = readBundledJson<RawDeprecations>(extensionPath, "deprecations.json")

  // Transform kits → components
  if (raw.kits) {
    for (const [kitName, kit] of Object.entries(raw.kits)) {
      if (kitName.startsWith("$")) {
        continue
      }
      const reactName =
        kit.name ||
        kitName.replace(/(^|_)([a-z])/g, (_: string, __: string, c: string) =>
          c.toUpperCase()
        )
      const railsName = kitName

      // Derive hasChildren from usage examples
      let hasChildren = true // default to true (safe)
      if (kit.usage?.rails?.example) {
        hasChildren = kit.usage.rails.example.includes("do %>")
      }

      const kitDeprecations = deprecations?.props?.[kitName]

      // Transform props: camelCase → snake_case, preserve platform info
      const props: Record<string, PropMetadata> = {}
      if (kit.props) {
        for (const [propCamel, propData] of Object.entries(kit.props)) {
          if (propCamel.startsWith("$")) {
            continue
          }
          const propSnake = camelToSnake(propCamel)
          props[propSnake] = transformProp(propData, kitDeprecations?.[propSnake])
        }
      }

      for (const fix of SCHEMA_CORRECTIONS) {
        const target = fix.kit === kitName ? props[fix.prop] : undefined
        if (target) {
          target.valuesByPlatform = { ...target.valuesByPlatform, [fix.platform]: [] }
          if (fix.platform === "react" || !target.valuesByPlatform.react) {
            target.valuesByPlatform.react = target.valuesByPlatform.react ?? target.values
          }
        }
      }

      const visual = visualIndex?.kits?.[kitName]

      metadata.components[reactName] = {
        rails: railsName,
        react: reactName,
        description: kit.description || `Playbook ${reactName} component`,
        hasChildren,
        props,
        platforms: kit.platforms,
        status: kit.status,
        category: kit.category,
        reactImport: kit.usage?.react?.import,
        reactExample: kit.usage?.react?.example,
        railsExample: kit.usage?.rails?.example,
        railsNote: kit.usage?.rails?.note,
        examplePreset: kit.usage?.react?.preset || kit.usage?.rails?.preset,
        visual: visual
          ? {
              looksLike: visual.looksLike,
              not: visual.not,
              gotchas: visual.gotchas,
              typicalProps: visual.cues?.typicalProps,
            }
          : undefined,
        faqs: kit.faqs,
        deprecatedProps: kitDeprecations,
        // Every kit currently opts in; only treat it as false when the
        // schema explicitly says so, so a future opt-out is respected.
        hasGlobalProps: kit.globalProps !== false,
        externalDependencies: kit.externalDependencies?.packages
          ? {
              packages: kit.externalDependencies.packages,
              note: kit.externalDependencies.note,
              optional: kit.externalDependencies.optional,
              docs: kit.externalDependencies.docs,
            }
          : undefined,
      }
    }
  }

  return metadata
}

function loadFromCurrentSource(extensionPath: string): PlaybookMetadata {
  const source = resolveAiSource(extensionPath)
  const raw = readAiJson<RawSchema>(extensionPath, "all-schemas.json")
  if (!raw) {
    throw new Error(`No readable all-schemas.json in ${source.dir}`)
  }
  const metadata = transformSchema(raw, extensionPath)
  metadata.source = source
  metadata.version = source.version
  console.log(
    `[Playbook] Loaded metadata (${source.bundled ? "bundled" : "workspace"} v${source.version ?? "?"}) from ${source.dir}`
  )
  return metadata
}

export function loadMetadata(extensionPath: string): PlaybookMetadata {
  if (cachedMetadata) {
    return cachedMetadata
  }

  try {
    cachedMetadata = loadFromCurrentSource(extensionPath)
    return cachedMetadata
  } catch (error) {
    console.error(`[Playbook] Failed to load metadata: ${error}`)
  }

  // The workspace's copy was unreadable or an unexpected shape: use ours.
  try {
    forceBundledSource(extensionPath)
    cachedMetadata = loadFromCurrentSource(extensionPath)
    return cachedMetadata
  } catch (error) {
    console.error("Failed to load Playbook metadata:", error)
    return { components: {}, globalProps: {} }
  }
}

export function findComponentByRailsName(
  metadata: PlaybookMetadata,
  railsName: string
): ComponentMetadata | null {
  for (const [, component] of Object.entries(metadata.components)) {
    if (component.rails === railsName) {
      return component
    }
  }
  return null
}

export function findComponentByReactName(
  metadata: PlaybookMetadata,
  reactName: string
): ComponentMetadata | null {
  return metadata.components[reactName] || null
}

export interface SubcomponentMatch {
  parent: ComponentMetadata
  subName: string
}

function splitSubcomponentName(
  name: string,
  separator: string
): { parentName: string; subName: string } | null {
  const index = name.indexOf(separator)
  if (index === -1) {
    return null
  }
  return {
    parentName: name.substring(0, index),
    subName: name.substring(index + separator.length),
  }
}

/**
 * Rails subcomponents are invoked as pb_rails("<kit>/<sub_name>", ...), e.g.
 * pb_rails("table/table_row"). Playbook's shared metadata doesn't ship a
 * schema for the subcomponent itself, so this only confirms the parent kit
 * exists rather than validating the subcomponent's own props.
 */
export function findRailsSubcomponent(
  metadata: PlaybookMetadata,
  railsName: string
): SubcomponentMatch | null {
  const split = splitSubcomponentName(railsName, "/")
  if (!split) {
    return null
  }
  const parent = findComponentByRailsName(metadata, split.parentName)
  return parent ? { parent, subName: split.subName } : null
}

/**
 * React subcomponents use dot notation, e.g. <Table.Row>. Same caveat as
 * findRailsSubcomponent: only the parent kit is validated.
 */
export function findReactSubcomponent(
  metadata: PlaybookMetadata,
  reactName: string
): SubcomponentMatch | null {
  const split = splitSubcomponentName(reactName, ".")
  if (!split) {
    return null
  }
  const parent = findComponentByReactName(metadata, split.parentName)
  return parent ? { parent, subName: split.subName } : null
}

export function generateSubcomponentDocs(
  fullName: string,
  match: SubcomponentMatch
): string {
  const lines: string[] = []
  lines.push(`# ${fullName}`)
  lines.push("")
  lines.push(
    `Subcomponent of **${match.parent.react}** (\`${match.parent.rails}\`).`
  )
  lines.push("")
  lines.push(match.parent.description)
  lines.push("")

  const docLinks = docsLinksFor(match.parent)
  if (docLinks) {
    lines.push(`📖 ${docLinks} _(parent kit)_`)
    lines.push("")
  }

  lines.push(
    `_Playbook's shared metadata doesn't publish per-subcomponent props for "${match.subName}" yet, so only the parent kit's info is shown here._`
  )
  return lines.join("\n")
}

let cachedFormBuilderMetadata: FormBuilderMetadata | null = null

interface RawFormMethod {
  name: string
  kit?: string
  signature?: string
  example?: string
  binding?: { name?: string; value?: string }
  submission?: { value?: string }
  htmlOptions?: { description?: string; overrides?: string }
  validation?: { required?: string; indicator?: string; client?: string; error?: { description?: string } }
  block?: { description?: string }
}

interface RawForms {
  methods?: RawFormMethod[]
}

function contractFor(method: RawFormMethod): FormMethodContract {
  const notes: Array<{ topic: string; text: string }> = []
  const add = (topic: string, text?: string) => {
    if (text) {
      notes.push({ topic, text })
    }
  }
  add("Binding", method.binding?.value)
  add("HTML options", method.htmlOptions?.description)
  add("Required", method.validation?.required)
  add("Errors", method.validation?.error?.description)
  add("Client validation", method.validation?.client)
  return { signature: method.signature, example: method.example, notes }
}

/**
 * data/form-builders.json was gathered from Playbook's file names, which differ
 * from the method names for these (`checkbox_field.rb` defines `check_box`).
 */
const LEGACY_FIELD_NAMES: Record<string, string> = {
  check_box: "checkbox_field",
}

/**
 * Builder methods come from Playbook's own contract (`forms.json`), so the
 * names match what `Playbook::Forms::Builder` really defines (`check_box`,
 * `select`, `date_picker`, ...). Each method's props are its kit's Rails
 * props plus the builder-level props gathered in data/form-builders.json.
 */
export function loadFormBuilderMetadata(
  extensionPath: string
): FormBuilderMetadata {
  if (cachedFormBuilderMetadata) {
    return cachedFormBuilderMetadata
  }

  const legacy = readBundledJson<FormBuilderMetadata>(extensionPath, "form-builders.json")
  const forms = readAiJson<RawForms>(extensionPath, "forms.json")

  if (!forms?.methods) {
    cachedFormBuilderMetadata = legacy || { fields: [] }
    return cachedFormBuilderMetadata
  }

  const metadata = loadMetadata(extensionPath)
  const fields: FormBuilderField[] = forms.methods
    .filter((m) => m.kit)
    .map((method) => {
      const kit = method.kit as string
      const legacyNames = [method.name, `${method.name}_field`, LEGACY_FIELD_NAMES[method.name]]
      const legacyField = legacy?.fields.find((f) => legacyNames.includes(f.name))
      const props: Record<string, PropMetadata> = { ...(legacyField?.props || {}) }
      const component = findComponentByRailsName(metadata, kit)
      for (const [name, prop] of Object.entries(component?.props || {})) {
        if (isPropValidForPlatform(prop, "erb")) {
          props[name] = prop
        }
      }
      return { name: method.name, kit, props, contract: contractFor(method) }
    })

  cachedFormBuilderMetadata = { fields }
  return cachedFormBuilderMetadata
}

/** Markdown for hovering a form builder method such as `f.check_box`. */
export function generateFormMethodDocs(field: FormBuilderField): string {
  const lines: string[] = []
  lines.push(`# ${field.name}`)
  lines.push("")
  lines.push(`Playbook form builder method, rendering the \`${field.kit}\` kit.`)
  lines.push("")
  if (field.contract?.signature) {
    lines.push("```ruby")
    lines.push(field.contract.signature)
    lines.push("```")
    lines.push("")
  }
  if (field.contract?.example) {
    lines.push("```erb")
    lines.push(field.contract.example)
    lines.push("```")
    lines.push("")
  }
  for (const note of field.contract?.notes || []) {
    lines.push(`**${note.topic}:** ${note.text}`)
    lines.push("")
  }
  lines.push(`Props are the \`${field.kit}\` kit's Rails props; HTML attributes go in \`props: { input_options: { ... } }\`.`)
  return lines.join("\n")
}

export function findFormBuilderField(
  metadata: FormBuilderMetadata,
  fieldName: string
): FormBuilderField | null {
  return metadata.fields.find(field => field.name === fieldName) || null
}

/**
 * Get the appropriate prop values based on the language context
 * @param prop The prop metadata
 * @returns The appropriate values array for the context
 */
export function getPropValues(
  prop: PropMetadata,
  languageId?: string
): string[] | undefined {
  if (languageId && prop.valuesByPlatform) {
    const own = prop.valuesByPlatform[platformFor(languageId)]
    if (own) {
      return own
    }
  }
  return prop.values
}

/** The prop's type as seen from the given language (React vs Rails). */
export function getPropType(prop: PropMetadata, languageId?: string): string {
  if (languageId && prop.typeByPlatform) {
    return prop.typeByPlatform[platformFor(languageId)] ?? prop.type
  }
  return prop.type
}

/** True when "boolean" is the prop's type or one member of a union type. */
export function isBooleanProp(prop: PropMetadata, languageId?: string): boolean {
  return getPropType(prop, languageId)
    .split("|")
    .some((t) => t.trim() === "boolean")
}

export function getPropDefault(
  prop: PropMetadata,
  languageId?: string
): string | undefined {
  if (languageId && prop.defaultByPlatform) {
    const own = prop.defaultByPlatform[platformFor(languageId)]
    if (own !== undefined) {
      return own
    }
  }
  return prop.default
}

/**
 * The prop's deprecation if it applies to the given language. Deprecations
 * that are recorded only for the other platform return undefined.
 */
export function getPropDeprecation(
  component: ComponentMetadata,
  snakeProp: string,
  languageId: string
): DeprecationInfo | undefined {
  const info = component.props[snakeProp]?.deprecated ?? component.deprecatedProps?.[snakeProp]
  if (!info) {
    return undefined
  }
  return info.platforms.includes(platformFor(languageId)) ? info : undefined
}

/**
 * Check if a prop is valid for the given platform context
 */
export function isPropValidForPlatform(
  prop: PropMetadata,
  languageId: string
): boolean {
  if (!prop.platforms || prop.platforms.length === 0) {
    return true
  }
  const isRailsContext = ["ruby", "erb", "html.erb", "html"].includes(
    languageId
  )
  return isRailsContext
    ? prop.platforms.includes("rails")
    : prop.platforms.includes("react")
}

/**
 * Check if a whole component/kit supports the given platform context. Some
 * kits are React-only (e.g. "map") or Rails-only (e.g. "form") — unlike
 * props, this is a hard error, not a per-prop mismatch.
 */
export function isComponentValidForPlatform(
  component: ComponentMetadata,
  languageId: string
): boolean {
  if (!component.platforms || component.platforms.length === 0) {
    return true
  }
  const isRailsContext = ["ruby", "erb", "html.erb", "html"].includes(
    languageId
  )
  return isRailsContext
    ? component.platforms.includes("rails")
    : component.platforms.includes("react")
}

/**
 * Look up a global prop for a specific component, respecting a kit's
 * globalProps: false opt-out. Every kit currently opts in, so this only
 * matters once Playbook ships a kit that explicitly disables global props.
 */
export function findGlobalPropForComponent(
  metadata: PlaybookMetadata,
  component: ComponentMetadata,
  propName: string
): PropMetadata | undefined {
  if (component.hasGlobalProps === false) {
    return undefined
  }
  return metadata.globalProps?.[propName]
}

const PLAYBOOK_DOCS_BASE = "https://playbook.powerapp.cloud/kits"

export function docsUrlFor(component: ComponentMetadata, platform: Platform): string {
  return `${PLAYBOOK_DOCS_BASE}/${component.rails}/${platform}`
}

function docsLinksFor(component: ComponentMetadata): string {
  const platforms =
    component.platforms && component.platforms.length > 0
      ? component.platforms
      : ["react", "rails"]
  return platforms
    .filter(p => p === "react" || p === "rails")
    .map(
      p => `[${p === "react" ? "React" : "Rails"} docs](${PLAYBOOK_DOCS_BASE}/${component.rails}/${p})`
    )
    .join(" · ")
}

/**
 * How Playbook's global props are grouped for documentation. First match wins;
 * anything unmatched lands in "Other".
 */
const GLOBAL_PROP_CATEGORIES: Array<{ title: string; matches: RegExp }> = [
  { title: "Spacing", matches: /^(margin|padding)/ },
  {
    title: "Flexbox",
    matches: /^(align(Content|Items|Self)|flex(Direction|Grow|Shrink|Wrap)?|justify(Content|Self)|order|gap|rowGap|columnGap)$/,
  },
  { title: "Grid", matches: /^(grid|justifyItems)/ },
  { title: "Sizing", matches: /^(width|height|minWidth|maxWidth|minHeight|maxHeight)$/ },
  { title: "Position", matches: /^(position|top|right|bottom|left|inset|zIndex)$/ },
  { title: "Border and effects", matches: /^(border|shadow|hover|groupHover)/ },
  { title: "Display and overflow", matches: /^(display|overflow|truncate|cursor)/ },
  { title: "Text", matches: /^(lineHeight|textAlign|verticalAlign|numberSpacing)$/ },
]

export interface GlobalPropRow {
  /** Props that share a type and value list, alphabetized, in the platform's spelling. */
  names: string[]
  type: string
  values?: string[]
  responsive: boolean
}

export interface GlobalPropGroup {
  title: string
  rows: GlobalPropRow[]
}

function categoryTitle(camelName: string): string {
  return GLOBAL_PROP_CATEGORIES.find((c) => c.matches.test(camelName))?.title ?? "Other"
}

/**
 * Global props by purpose, alphabetized. Within a group, props with the same
 * type and values (margin, marginTop, padding, … all take the spacing scale) are
 * one row, so each value list is written once and nothing has to be shortened.
 */
export function buildGlobalPropGroups(metadata: PlaybookMetadata, platform: Platform): GlobalPropGroup[] {
  const languageId = platform === "rails" ? "erb" : "typescriptreact"
  const byTitle = new Map<string, Map<string, GlobalPropRow>>()

  for (const [snake, prop] of Object.entries(metadata.globalProps || {})) {
    const camel = snakeToCamel(snake)
    const values = getPropValues(prop, languageId)
    const type = getPropType(prop, languageId)
    const signature = JSON.stringify([type, values ?? null, !!prop.responsive])
    const title = categoryTitle(camel)
    const rows = byTitle.get(title) ?? new Map<string, GlobalPropRow>()
    const row = rows.get(signature) ?? { names: [], type, values, responsive: !!prop.responsive }
    row.names.push(platform === "rails" ? snake : camel)
    rows.set(signature, row)
    byTitle.set(title, rows)
  }

  const order = [...GLOBAL_PROP_CATEGORIES.map((c) => c.title), "Other"]
  return order
    .filter((title) => byTitle.has(title))
    .map((title) => ({
      title,
      rows: [...byTitle.get(title)!.values()]
        .map((row) => ({ ...row, names: row.names.sort((x, y) => x.localeCompare(y)) }))
        .sort((x, y) => x.names[0].localeCompare(y.names[0])),
    }))
}

/**
 * The global props section of a kit hover: every name, grouped and alphabetized,
 * without values (hover a prop for those, or open the full reference).
 */
export function globalPropsSummaryLines(metadata: PlaybookMetadata, platform: Platform): string[] {
  const groups = buildGlobalPropGroups(metadata, platform)
  if (groups.length === 0) {
    return []
  }
  const lines: string[] = ["## Global Props", ""]
  lines.push("_On every Playbook kit. Hover one for its values; **Playbook: Show Global Props** has the full reference._")
  lines.push("")
  for (const group of groups) {
    const names = group.rows.flatMap((row) => row.names).sort((x, y) => x.localeCompare(y))
    lines.push(`**${group.title}** (${names.length}) — ${names.map((n) => `\`${n}\``).join(" ")}`)
    lines.push("")
  }
  const tokens = metadata.spacingTokens
  if (tokens) {
    const scale = Object.entries(tokens).map(([name, px]) => `\`${name}\` ${px}`).join(" · ")
    lines.push(`**Spacing scale:** ${scale}`)
    lines.push("")
  }
  return lines
}

/** The complete reference: every global prop with its full value list, as Markdown tables. */
export function generateGlobalPropsDocs(metadata: PlaybookMetadata, platform: Platform): string {
  const lines: string[] = []
  lines.push("# Playbook global props")
  lines.push("")
  lines.push(
    "Available on every Playbook kit. " +
      (platform === "rails"
        ? "Showing Rails names (snake_case); React uses camelCase (margin_bottom → marginBottom)."
        : "Showing React names (camelCase); Rails uses snake_case (marginBottom → margin_bottom).")
  )
  lines.push("")
  if (metadata.breakpoints) {
    const legend = Object.entries(metadata.breakpoints).map(([bp, range]) => `\`${bp}\` ${range}`).join(" · ")
    lines.push(
      "**Responsive** props (↔) also take an object keyed by breakpoint, e.g. " +
        (platform === "rails" ? '`{ default: "sm", md: "lg" }`' : "`{{ default: 'sm', md: 'lg' }}`") +
        `. Breakpoints: ${legend}.`
    )
    lines.push("")
  }
  if (metadata.spacingTokens) {
    const scale = Object.entries(metadata.spacingTokens).map(([name, px]) => `\`${name}\` ${px}`).join(" · ")
    lines.push(`**Spacing scale:** ${scale}`)
    lines.push("")
  }
  for (const group of buildGlobalPropGroups(metadata, platform)) {
    lines.push(`## ${group.title}`)
    lines.push("")
    lines.push("| Props | Values | ↔ |")
    lines.push("|---|---|:-:|")
    for (const row of group.rows) {
      const names = row.names.map((n) => `\`${n}\``).join(" ")
      // "enum | responsive" has a pipe that would split the table cell; the ↔ column already says responsive.
      const typeText = row.type.replace(/\s*\|\s*responsive/g, "").replace(/\|/g, "\\|")
      const values = row.values && row.values.length > 0 ? row.values.map((v) => `\`${v}\``).join(" ") : `_${typeText}_`
      lines.push(`| ${names} | ${values} | ${row.responsive ? "↔" : ""} |`)
    }
    lines.push("")
  }
  return lines.join("\n")
}

/**
 * Guidance Playbook publishes alongside a kit: what it is easily confused with,
 * known gotchas, named presets, and answers to common questions.
 */
export function kitGuidanceLines(
  component: ComponentMetadata,
  playground?: Playground
): string[] {
  const lines: string[] = []
  const visual = component.visual

  if (visual?.not && visual.not.length > 0) {
    lines.push(
      `_Often confused with:_ ${visual.not.map(n => `\`${n}\``).join(", ")}`
    )
    lines.push("")
  }

  if (visual?.gotchas && visual.gotchas.length > 0) {
    lines.push("**Good to know**")
    for (const gotcha of visual.gotchas) {
      lines.push(`- ${gotcha}`)
    }
    lines.push("")
  }

  const presets = playground?.presets?.map(p => p.name) || []
  if (presets.length > 0) {
    const shown = presets.slice(0, 6).map(n => `\`${n}\``).join(", ")
    const more = presets.length > 6 ? ` and ${presets.length - 6} more` : ""
    lines.push(`**Presets:** ${shown}${more} — insert one from the completion list.`)
    lines.push("")
  }

  if (component.faqs && component.faqs.length > 0) {
    lines.push("**FAQ**")
    for (const faq of component.faqs) {
      lines.push(`- _${faq.questions[0]}_ ${faq.answer}`)
    }
    lines.push("")
  }

  const deprecated = Object.entries(component.deprecatedProps || {})
  if (deprecated.length > 0) {
    lines.push(
      `⚠️ **Deprecated props:** ${deprecated
        .map(([name, d]) => (d.replacement ? `\`${name}\` → \`${d.replacement}\`` : `\`${name}\``))
        .join(", ")}`
    )
    lines.push("")
  }
  return lines
}

/**
 * Extra hover lines for one prop: deprecation, what it pairs with, and the
 * playground hints that apply when it is set.
 */
export function propGuidanceLines(
  component: ComponentMetadata,
  snakeProp: string,
  playground: Playground | undefined,
  languageId: string
): string[] {
  const lines: string[] = []
  const platform = platformFor(languageId)
  const name = (snake: string) => (platform === "rails" ? snake : snakeToCamel(snake))

  const deprecation = getPropDeprecation(component, snakeProp, languageId)
  if (deprecation) {
    let line = "⚠️ **Deprecated.**"
    if (deprecation.replacement) {
      line += ` Use \`${name(deprecation.replacement)}\` instead.`
    } else if (deprecation.message) {
      line += ` ${deprecation.message}`
    }
    lines.push(line)
  }

  const camel = snakeToCamel(snakeProp)
  const requires = playground?.conditionals?.[camel]?.requires
  if (requires) {
    const parts =
      typeof requires === "string"
        ? [`\`${name(camelToSnake(requires))}\``]
        : Object.entries(requires).map(([key, value]) =>
            value === true
              ? `\`${name(camelToSnake(key))}\``
              : `\`${name(camelToSnake(key))}\` = \`${JSON.stringify(value)}\``
          )
    lines.push(`Used together with ${parts.join(" and ")}.`)
  }

  for (const hint of Object.values(playground?.hints || {})) {
    if (hint.when && Object.prototype.hasOwnProperty.call(hint.when, camel)) {
      lines.push(`${hint.type === "warning" ? "⚠️" : "ℹ️"} ${hint.message}`)
    }
  }
  return lines
}

export function generateComponentDocs(
  componentName: string,
  component: ComponentMetadata,
  metadata: PlaybookMetadata,
  playground?: Playground,
  languageId?: string,
  options: { guidance?: boolean; globalProps?: boolean } = {}
): string {
  const lines: string[] = []

  lines.push(`# ${componentName}`)
  lines.push("")

  if (component.status && component.status !== "stable") {
    if (component.status === "deprecated") {
      lines.push(`⚠️ **Deprecated** — this component is no longer recommended.`)
    } else {
      lines.push(`**Status:** ${component.status}`)
    }
    lines.push("")
  }

  lines.push(component.description)
  lines.push("")

  if (component.category) {
    lines.push(`_Category: ${component.category}_`)
    lines.push("")
  }

  if (options.guidance !== false) {
    lines.push(...kitGuidanceLines(component, playground))
  }

  const supportsReact =
    !component.platforms || component.platforms.includes("react")
  const supportsRails =
    !component.platforms || component.platforms.includes("rails")

  if (component.reactImport && supportsReact) {
    lines.push(`\`${component.reactImport}\``)
    lines.push("")
  }

  const docLinks = docsLinksFor(component)
  if (docLinks) {
    lines.push(`📖 ${docLinks}`)
    lines.push("")
  }

  if (component.platforms && component.platforms.length === 1) {
    lines.push(
      `_${component.platforms[0] === "react" ? "React" : "Rails"} only — no ${
        component.platforms[0] === "react" ? "Rails" : "React"
      } implementation exists for this kit._`
    )
    lines.push("")
  }

  if (component.externalDependencies) {
    const dep = component.externalDependencies
    lines.push("## Requires")
    lines.push("")
    lines.push(
      `This kit wraps ${dep.packages.map(p => `\`${p}\``).join(", ")}. The host app must already have ${
        dep.packages.length > 1 ? "these packages" : "this package"
      } installed — do not install them automatically.`
    )
    if (dep.note) {
      lines.push("")
      lines.push(dep.note)
    }
    if (dep.docs) {
      lines.push("")
      lines.push(`Docs: ${dep.docs}`)
    }
    lines.push("")
  }

  if (
    component.examplePreset &&
    component.examplePreset !== "Default" &&
    (component.railsExample || component.reactExample)
  ) {
    lines.push(`_Example shown: "${component.examplePreset}" variant_`)
    lines.push("")
  }

  if (supportsRails) {
    lines.push("**Rails/ERB:**")
    lines.push("```erb")
    if (component.railsExample) {
      lines.push(component.railsExample)
    } else if (component.hasChildren) {
      lines.push(`<%= pb_rails("${component.rails}", props: {}) do %>`)
      lines.push("  Content")
      lines.push("<% end %>")
    } else {
      lines.push(`<%= pb_rails("${component.rails}", props: {}) %>`)
    }
    lines.push("```")
    lines.push("")

    if (component.railsNote) {
      lines.push(component.railsNote)
      lines.push("")
    }
  }

  if (supportsReact) {
    lines.push("**React:**")
    lines.push("```tsx")
    if (component.reactExample) {
      lines.push(component.reactExample)
    } else if (component.hasChildren) {
      lines.push(`<${componentName}>`)
      lines.push("  Content")
      lines.push(`</${componentName}>`)
    } else {
      lines.push(`<${componentName} />`)
    }
    lines.push("```")
    lines.push("")
  }

  if (Object.keys(component.props).length > 0) {
    lines.push("## Props")
    lines.push("")

    for (const [propName, prop] of Object.entries(component.props).sort(([x], [y]) => x.localeCompare(y))) {
      const camelCaseProp = propName.replace(/_([a-z])/g, (_, letter) =>
        letter.toUpperCase()
      )
      lines.push(`**${propName}** (${camelCaseProp} in React)`)
      lines.push(`- Type: \`${prop.type}\``)

      if (prop.values && prop.values.length > 0) {
        lines.push(`- Values: ${prop.values.map(v => `\`${v}\``).join(", ")}`)
      }

      if (prop.default !== undefined) {
        lines.push(`- Default: \`${prop.default}\``)
      }

      if (prop.required) {
        lines.push("- **Required**")
      }

      if (prop.deprecated) {
        lines.push("- ⚠️ **Deprecated**")
      }

      lines.push("")
    }
  }

  if (component.hasGlobalProps !== false && options.globalProps !== false) {
    lines.push(...globalPropsSummaryLines(metadata, platformFor(languageId ?? "typescriptreact")))
  }

  return lines.join("\n")
}

export function generatePropDocs(
  propName: string,
  prop: PropMetadata,
  isGlobal: boolean = false,
  metadata?: PlaybookMetadata,
  languageId?: string
): string {
  const lines: string[] = []
  const values = getPropValues(prop, languageId)
  const defaultValue = getPropDefault(prop, languageId)

  lines.push(`**${propName}**${isGlobal ? " *(global prop)*" : ""}`)

  if (prop.description) {
    lines.push(prop.description)
  }

  lines.push(`Type: \`${getPropType(prop, languageId)}\``)

  if (values && values.length > 0) {
    const spacingTokens = metadata?.spacingTokens
    lines.push(
      `Values: ${values
        .map(v => {
          const px = spacingTokens?.[v]
          return px ? `\`${v}\` (${px})` : `\`${v}\``
        })
        .join(", ")}`
    )
  }

  if (defaultValue !== undefined) {
    lines.push(`Default: \`${defaultValue}\``)
  }

  if (prop.properties && Object.keys(prop.properties).length > 0) {
    const shape = Object.entries(prop.properties)
      .map(([nestedName, nestedProp]) => {
        const values = nestedProp.values?.length
          ? `: ${nestedProp.values.map(v => `\`${v}\``).join(", ")}`
          : ""
        return `\`${nestedName}\` (${nestedProp.type}${values})`
      })
      .join(", ")
    lines.push(`Shape: ${shape}`)
  }

  if (prop.responsive) {
    const breakpoints = metadata?.breakpoints
    if (breakpoints) {
      const legend = Object.entries(breakpoints)
        .map(([bp, range]) => `\`${bp}\` (${range})`)
        .join(", ")
      lines.push(`Supports responsive breakpoint objects: ${legend}`)
    } else {
      lines.push("Supports responsive breakpoint objects.")
    }
  }

  if (prop.example) {
    lines.push(`Example: \`${prop.example}\``)
  }

  if (prop.required) {
    lines.push("**Required**")
  }

  const camelCaseProp = propName.replace(/_([a-z])/g, (_, letter) =>
    letter.toUpperCase()
  )
  if (metadata?.domSafeWarning?.nonSafeProps.includes(camelCaseProp)) {
    lines.push(
      `⚠️ Not DOM-safe — filter with \`domSafeProps()\` before spreading onto a native element.`
    )
  }

  return lines.join("  \n")
}
