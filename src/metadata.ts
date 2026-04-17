import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"

export interface PropMetadata {
  type: string
  default?: string
  values?: string[]
  platforms?: string[]
  required?: boolean
}

export interface ComponentMetadata {
  rails: string
  react: string
  description: string
  hasChildren: boolean
  props: Record<string, PropMetadata>
}

export interface FormBuilderField {
  name: string
  kit: string
  props: Record<string, PropMetadata>
}

export interface FormBuilderMetadata {
  fields: FormBuilderField[]
}

export interface PlaybookMetadata {
  globalProps?: Record<string, PropMetadata>
  components: Record<string, ComponentMetadata>
  formBuilders?: FormBuilderMetadata
}

let cachedMetadata: PlaybookMetadata | null = null

function camelToSnake(str: string): string {
  return str.replace(/([A-Z])/g, "_$1").toLowerCase()
}

function transformSchema(raw: any): PlaybookMetadata {
  const metadata: PlaybookMetadata = {
    components: {},
    globalProps: {},
  }

  // Transform global props (camelCase → snake_case)
  if (raw.globalProps?.props) {
    for (const [camelName, prop] of Object.entries<any>(
      raw.globalProps.props
    )) {
      if (camelName.startsWith("$")) {
        continue
      }
      const snakeName = camelToSnake(camelName)
      metadata.globalProps![snakeName] = {
        type: prop.type || "string",
        values: prop.values?.map((v: any) => String(v)),
        default: prop.default !== undefined ? String(prop.default) : undefined,
      }
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
    for (const [kitName, kit] of Object.entries<any>(raw.kits)) {
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
        for (const [propCamel, propData] of Object.entries<any>(kit.props)) {
          if (propCamel.startsWith("$")) {
            continue
          }
          const propSnake = camelToSnake(propCamel)
          props[propSnake] = {
            type: propData.type || "string",
            values: propData.values?.map((v: any) => String(v)),
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
 * @param languageId The VS Code language ID (e.g., 'erb', 'typescriptreact')
 * @returns The appropriate values array for the context
 */
export function getPropValues(
  prop: PropMetadata,
  languageId: string
): string[] | undefined {
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

export function generateComponentDocs(
  componentName: string,
  component: ComponentMetadata,
  metadata: PlaybookMetadata
): string {
  const lines: string[] = []

  lines.push(`# ${componentName}`)
  lines.push("")
  lines.push(component.description)
  lines.push("")

  lines.push("**Rails/ERB:**")
  lines.push("```erb")
  if (component.hasChildren) {
    lines.push(`<%= pb_rails("${component.rails}", props: {}) do %>`)
    lines.push("  Content")
    lines.push("<% end %>")
  } else {
    lines.push(`<%= pb_rails("${component.rails}", props: {}) %>`)
  }
  lines.push("```")
  lines.push("")

  lines.push("**React:**")
  lines.push("```tsx")
  if (component.hasChildren) {
    lines.push(`<${componentName}>`)
    lines.push("  Content")
    lines.push(`</${componentName}>`)
  } else {
    lines.push(`<${componentName} />`)
  }
  lines.push("```")
  lines.push("")

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
  isGlobal: boolean = false
): string {
  const lines: string[] = []

  lines.push(`**${propName}**${isGlobal ? " *(global prop)*" : ""}`)
  lines.push(`Type: \`${prop.type}\``)

  if (prop.values && prop.values.length > 0) {
    lines.push(`Values: ${prop.values.map(v => `\`${v}\``).join(", ")}`)
  }

  if (prop.default !== undefined) {
    lines.push(`Default: \`${prop.default}\``)
  }

  if (prop.required) {
    lines.push("**Required**")
  }

  return lines.join("  \n")
}
