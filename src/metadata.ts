import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"

export interface NestedPropShape {
  type: string
  values?: string[]
}

export interface PropMetadata {
  type: string
  default?: string
  values?: string[]
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
}

export interface FormBuilderField {
  name: string
  kit: string
  props: Record<string, PropMetadata>
}

export interface FormBuilderMetadata {
  fields: FormBuilderField[]
}

export interface DomSafeWarning {
  description: string
  nonSafeProps: string[]
}

export interface PlaybookMetadata {
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

interface RawPropData {
  type?: string
  default?: unknown
  values?: unknown[]
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
}

interface RawSchema {
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

function camelToSnake(str: string): string {
  return str.replace(/([A-Z])/g, "_$1").toLowerCase()
}

function transformSchema(raw: RawSchema): PlaybookMetadata {
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
      const snakeName = camelToSnake(camelName)
      const properties: Record<string, NestedPropShape> | undefined = prop.properties
        ? Object.fromEntries(
            Object.entries(prop.properties).map(([nestedName, nestedProp]) => [
              nestedName,
              {
                type: nestedProp.type || "string",
                values: nestedProp.values?.map((v: unknown) => String(v)),
              },
            ])
          )
        : undefined
      metadata.globalProps![snakeName] = {
        type: prop.type || "string",
        values: prop.values?.map((v: unknown) => String(v)),
        default: prop.default !== undefined ? String(prop.default) : undefined,
        description: prop.description,
        example: prop.example,
        responsive: prop.responsive,
        properties,
      }
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

      // Transform props: camelCase → snake_case, preserve platform info
      const props: Record<string, PropMetadata> = {}
      if (kit.props) {
        for (const [propCamel, propData] of Object.entries(kit.props)) {
          if (propCamel.startsWith("$")) {
            continue
          }
          const propSnake = camelToSnake(propCamel)
          props[propSnake] = {
            type: propData.type || "string",
            values: propData.values?.map((v: unknown) => String(v)),
            default:
              propData.default !== undefined
                ? String(propData.default)
                : undefined,
            platforms: propData.platforms,
          }
        }
      }

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

export function loadMetadata(extensionPath: string): PlaybookMetadata {
  if (cachedMetadata) {
    return cachedMetadata
  }

  // Try loading from workspace's node_modules first
  const workspaceFolders = vscode.workspace.workspaceFolders
  if (workspaceFolders) {
    for (const folder of workspaceFolders) {
      const wsPath = path.join(
        folder.uri.fsPath,
        "node_modules",
        "playbook-ui",
        "dist",
        "ai",
        "all-schemas.json"
      )
      if (fs.existsSync(wsPath)) {
        try {
          const content = fs.readFileSync(wsPath, "utf-8")
          const raw = JSON.parse(content)
          cachedMetadata = transformSchema(raw)
          console.log(`[Playbook] Loaded metadata from workspace: ${wsPath}`)
          return cachedMetadata
        } catch (error) {
          console.error(
            `[Playbook] Failed to load workspace metadata: ${error}`
          )
        }
      }
    }
  }

  // Fall back to bundled schema
  const bundledPath = path.join(extensionPath, "data", "all-schemas.json")
  try {
    const content = fs.readFileSync(bundledPath, "utf-8")
    const raw = JSON.parse(content)
    cachedMetadata = transformSchema(raw)
    console.log(
      `[Playbook] Loaded metadata from bundled schema: ${bundledPath}`
    )
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

export function loadFormBuilderMetadata(
  extensionPath: string
): FormBuilderMetadata {
  if (cachedFormBuilderMetadata) {
    return cachedFormBuilderMetadata
  }

  const metadataPath = path.join(extensionPath, "data", "form-builders.json")

  try {
    const content = fs.readFileSync(metadataPath, "utf-8")
    const data = JSON.parse(content)
    cachedFormBuilderMetadata = data
    return data
  } catch (error) {
    console.error("Failed to load form builder metadata:", error)
    return { fields: [] }
  }
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
export function getPropValues(prop: PropMetadata): string[] | undefined {
  return prop.values
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

export function generateComponentDocs(
  componentName: string,
  component: ComponentMetadata,
  metadata: PlaybookMetadata
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

    for (const [propName, prop] of Object.entries(component.props)) {
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

      lines.push("")
    }
  }

  if (metadata.globalProps && Object.keys(metadata.globalProps).length > 0) {
    lines.push("## Global Props")
    lines.push("")
    lines.push("*These props are available on all Playbook components:*")
    lines.push("")

    const globalPropsList: string[] = []
    for (const [propName, prop] of Object.entries(metadata.globalProps)) {
      const camelCaseProp = propName.replace(/_([a-z])/g, (_, letter) =>
        letter.toUpperCase()
      )
      let propDesc = `**${propName}** (${camelCaseProp})`

      if (prop.values && prop.values.length > 0) {
        if (prop.values.length > 5) {
          propDesc += ` - \`${prop.type}\`: ${prop.values
            .slice(0, 5)
            .map(v => `\`${v}\``)
            .join(", ")}...`
        } else {
          propDesc += ` - ${prop.values.map(v => `\`${v}\``).join(", ")}`
        }
      } else {
        propDesc += ` - \`${prop.type}\``
      }

      if (prop.description) {
        propDesc += ` — ${prop.description}`
      }

      globalPropsList.push(propDesc)
    }

    lines.push(globalPropsList.join("  \n"))
    lines.push("")
  }

  return lines.join("\n")
}

export function generatePropDocs(
  propName: string,
  prop: PropMetadata,
  isGlobal: boolean = false,
  metadata?: PlaybookMetadata
): string {
  const lines: string[] = []

  lines.push(`**${propName}**${isGlobal ? " *(global prop)*" : ""}`)

  if (prop.description) {
    lines.push(prop.description)
  }

  lines.push(`Type: \`${prop.type}\``)

  if (prop.values && prop.values.length > 0) {
    const spacingTokens = metadata?.spacingTokens
    lines.push(
      `Values: ${prop.values
        .map(v => {
          const px = spacingTokens?.[v]
          return px ? `\`${v}\` (${px})` : `\`${v}\``
        })
        .join(", ")}`
    )
  }

  if (prop.default !== undefined) {
    lines.push(`Default: \`${prop.default}\``)
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
