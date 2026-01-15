import * as fs from "fs"
import * as path from "path"

export interface PropMetadata {
  type: string
  default?: string
  values?: string[]
  required?: boolean
}

export interface ComponentMetadata {
  rails: string
  react: string
  description: string
  hasChildren: boolean
  props: Record<string, PropMetadata>
}

export interface PlaybookMetadata {
  globalProps?: Record<string, PropMetadata>
  components: Record<string, ComponentMetadata>
}

let cachedMetadata: PlaybookMetadata | null = null

/**
 * Load Playbook component metadata from data/playbook.json
 */
export function loadMetadata(extensionPath: string): PlaybookMetadata {
  if (cachedMetadata) {
    return cachedMetadata
  }

  const metadataPath = path.join(extensionPath, "data", "playbook.json")

  try {
    const content = fs.readFileSync(metadataPath, "utf-8")
    const data = JSON.parse(content)
    cachedMetadata = data
    return data
  } catch (error) {
    console.error("Failed to load Playbook metadata:", error)
    return { components: {}, globalProps: {} }
  }
}

/**
 * Find component metadata by Rails name (e.g., "button")
 */
export function findComponentByRailsName(
  metadata: PlaybookMetadata,
  railsName: string
): ComponentMetadata | null {
  for (const [componentName, component] of Object.entries(metadata.components)) {
    if (component.rails === railsName) {
      return component
    }
  }
  return null
}

/**
 * Find component metadata by React name (e.g., "Button")
 */
export function findComponentByReactName(
  metadata: PlaybookMetadata,
  reactName: string
): ComponentMetadata | null {
  return metadata.components[reactName] || null
}

/**
 * Generate markdown documentation for a component
 */
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

  // Rails usage
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

  // React usage
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

  // Component-specific Props
  if (Object.keys(component.props).length > 0) {
    lines.push("## Props")
    lines.push("")

    for (const [propName, prop] of Object.entries(component.props)) {
      const camelCaseProp = propName.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
      lines.push(`**${propName}** (${camelCaseProp} in React)`)
      lines.push(`- Type: \`${prop.type}\``)

      if (prop.values && prop.values.length > 0) {
        lines.push(`- Values: ${prop.values.map((v) => `\`${v}\``).join(", ")}`)
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

  // Global Props
  if (metadata.globalProps && Object.keys(metadata.globalProps).length > 0) {
    lines.push("## Global Props")
    lines.push("")
    lines.push("*These props are available on all Playbook components:*")
    lines.push("")

    const globalPropsList: string[] = []
    for (const [propName, prop] of Object.entries(metadata.globalProps)) {
      const camelCaseProp = propName.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
      let propDesc = `**${propName}** (${camelCaseProp})`

      if (prop.values && prop.values.length > 0) {
        // For props with many values, show type and first few values
        if (prop.values.length > 5) {
          propDesc += ` - \`${prop.type}\`: ${prop.values
            .slice(0, 5)
            .map((v) => `\`${v}\``)
            .join(", ")}...`
        } else {
          propDesc += ` - ${prop.values.map((v) => `\`${v}\``).join(", ")}`
        }
      } else {
        propDesc += ` - \`${prop.type}\``
      }

      globalPropsList.push(propDesc)
    }

    // Display in columns for better readability
    lines.push(globalPropsList.join("  \n"))
    lines.push("")
  }

  return lines.join("\n")
}

/**
 * Generate markdown documentation for a specific prop
 */
export function generatePropDocs(
  propName: string,
  prop: PropMetadata,
  isGlobal: boolean = false
): string {
  const lines: string[] = []

  lines.push(`**${propName}**${isGlobal ? " *(global prop)*" : ""}`)
  lines.push(`Type: \`${prop.type}\``)

  if (prop.values && prop.values.length > 0) {
    lines.push(`Values: ${prop.values.map((v) => `\`${v}\``).join(", ")}`)
  }

  if (prop.default !== undefined) {
    lines.push(`Default: \`${prop.default}\``)
  }

  if (prop.required) {
    lines.push("**Required**")
  }

  return lines.join("  \n")
}
