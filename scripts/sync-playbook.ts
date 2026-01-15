#!/usr/bin/env ts-node

/**
 * Playbook Sync Script
 *
 * This script scans the Playbook UI repository and:
 * 1. Extracts component metadata from Ruby class files
 * 2. Generates dynamic snippets for ERB and React
 * 3. Updates data/playbook.json with current component information
 *
 * Usage: npm run sync
 */

import * as fs from "fs"
import * as path from "path"

// Configuration
const PLAYBOOK_REPO_PATH =
  process.env.PLAYBOOK_REPO_PATH ||
  path.join(__dirname, "../../playbook/playbook/app/pb_kits/playbook")
const OUTPUT_DIR = path.join(__dirname, "..")
const SNIPPETS_DIR = path.join(OUTPUT_DIR, "snippets")
const DATA_DIR = path.join(OUTPUT_DIR, "data")

interface PropDefinition {
  name: string
  type: string
  default?: string
  values?: string[]
  required?: boolean
}

interface ComponentMetadata {
  name: string
  railsName: string
  reactName: string
  description?: string
  props: PropDefinition[]
  hasChildren: boolean
}

/**
 * Extract global props from globalProps.ts in utilities directory
 */
function extractGlobalPropsFromTypeScript(playbookPath: string): Record<string, any> {
  // Go up from .../playbook/app/pb_kits/playbook to .../playbook/playbook
  const playbookRoot = path.dirname(path.dirname(path.dirname(playbookPath)))
  const globalPropsPath = path.join(playbookRoot, "app/pb_kits/playbook/utilities/globalProps.ts")

  if (!fs.existsSync(globalPropsPath)) {
    console.warn(`Could not find globalProps.ts at ${globalPropsPath}`)
    return {}
  }

  const content = fs.readFileSync(globalPropsPath, "utf-8")
  const globalProps: Record<string, any> = {}

  // Parse type definitions: type TypeName = { propName?: "value1" | "value2" | ... }
  // We need to extract each propName from the object definition and convert to snake_case
  const typeDefRegex = /type\s+\w+\s*=\s*\{([^}]+)\}/g
  let typeMatch

  while ((typeMatch = typeDefRegex.exec(content)) !== null) {
    const typeBody = typeMatch[1]

    // Extract individual property definitions from the type body
    // Pattern: propName?: type
    const propRegex = /(\w+)\?:\s*([^,\n]+)/g
    let propMatch

    while ((propMatch = propRegex.exec(typeBody)) !== null) {
      const propNameCamelCase = propMatch[1]
      const valuesDef = propMatch[2].trim()

      // Skip reserved words and utility props
      if (
        propNameCamelCase === "break" ||
        propNameCamelCase === "default" ||
        propNameCamelCase.length <= 1
      ) {
        continue
      }

      // Convert camelCase to snake_case for Rails
      const propName = propNameCamelCase.replace(/([A-Z])/g, "_$1").toLowerCase()

      // Skip if we've already processed this prop
      if (globalProps[propName]) {
        continue
      }

      // Extract enum values from the type definition
      const enumValues: string[] = []

      // Match quoted strings like "value1" | "value2"
      const quotedValuesRegex = /"([^"]+)"/g
      let valueMatch
      while ((valueMatch = quotedValuesRegex.exec(valuesDef)) !== null) {
        enumValues.push(valueMatch[1])
      }

      // Determine type
      let propType = "string"
      if (valuesDef.includes("boolean")) {
        propType = "boolean"
      } else if (
        valuesDef.includes("Binary") ||
        valuesDef.match(/\b[0-9]\s*\|/) ||
        valuesDef.match(/^\d/)
      ) {
        propType = "number"
      }

      // Store the prop
      globalProps[propName] = {
        type: propType,
        ...(enumValues.length > 0 && { values: enumValues })
      }
    }
  }

  // Add spacing props manually as they have complex definitions
  const spacingValues = ["none", "xxs", "xs", "sm", "md", "lg", "xl", "auto", "initial", "inherit"]
  const spacingProps = [
    "padding",
    "padding_top",
    "padding_bottom",
    "padding_left",
    "padding_right",
    "padding_x",
    "padding_y",
    "margin",
    "margin_top",
    "margin_bottom",
    "margin_left",
    "margin_right",
    "margin_x",
    "margin_y"
  ]

  spacingProps.forEach((prop) => {
    if (!globalProps[prop]) {
      globalProps[prop] = { type: "string", values: spacingValues }
    }
  })

  // Add other commonly used global props from the PROP_CATEGORIES object
  if (!globalProps.dark) globalProps.dark = { type: "boolean" }
  if (!globalProps.shadow)
    globalProps.shadow = { type: "string", values: ["none", "deep", "deeper", "deepest"] }
  if (!globalProps.position)
    globalProps.position = {
      type: "string",
      values: ["relative", "absolute", "fixed", "sticky", "static"]
    }
  if (!globalProps.z_index)
    globalProps.z_index = {
      type: "number",
      values: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]
    }
  if (!globalProps.display)
    globalProps.display = {
      type: "string",
      values: ["block", "inline_block", "inline", "flex", "inline_flex", "none"]
    }
  if (!globalProps.group_hover) globalProps.group_hover = { type: "boolean" }
  if (!globalProps.truncate)
    globalProps.truncate = { type: "string", values: ["none", "1", "2", "3", "4", "5"] }
  if (!globalProps.width) globalProps.width = { type: "string" }
  if (!globalProps.min_width) globalProps.min_width = { type: "string" }
  if (!globalProps.max_width) globalProps.max_width = { type: "string" }
  if (!globalProps.height) globalProps.height = { type: "string" }
  if (!globalProps.min_height) globalProps.min_height = { type: "string" }
  if (!globalProps.max_height) globalProps.max_height = { type: "string" }
  if (!globalProps.gap)
    globalProps.gap = { type: "string", values: ["none", "xxs", "xs", "sm", "md", "lg", "xl"] }
  if (!globalProps.column_gap)
    globalProps.column_gap = {
      type: "string",
      values: ["none", "xxs", "xs", "sm", "md", "lg", "xl"]
    }
  if (!globalProps.row_gap)
    globalProps.row_gap = { type: "string", values: ["none", "xxs", "xs", "sm", "md", "lg", "xl"] }
  if (!globalProps.order)
    globalProps.order = {
      type: "string",
      values: ["none", "first", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]
    }
  if (!globalProps.top) globalProps.top = { type: "string" }
  if (!globalProps.right) globalProps.right = { type: "string" }
  if (!globalProps.bottom) globalProps.bottom = { type: "string" }
  if (!globalProps.left) globalProps.left = { type: "string" }
  if (!globalProps.hover) globalProps.hover = { type: "string" }

  return globalProps
}

/**
 * Extract global props list from pb_forms_global_props_helper.rb (legacy/fallback)
 */
function extractGlobalPropsList(playbookPath: string): string[] {
  // Go up from .../playbook/app/pb_kits/playbook to .../playbook/playbook
  const playbookRoot = path.dirname(path.dirname(path.dirname(playbookPath)))
  const helperPath = path.join(playbookRoot, "lib/playbook/pb_forms_global_props_helper.rb")

  if (!fs.existsSync(helperPath)) {
    console.warn(
      `Could not find pb_forms_global_props_helper.rb at ${helperPath}, using fallback global props`
    )
    return [
      "padding",
      "padding_top",
      "padding_bottom",
      "padding_left",
      "padding_right",
      "padding_x",
      "padding_y",
      "margin",
      "margin_top",
      "margin_bottom",
      "margin_left",
      "margin_right",
      "margin_x",
      "margin_y",
      "shadow",
      "width",
      "min_width",
      "max_width",
      "height",
      "min_height",
      "max_height",
      "position",
      "vertical_alignment",
      "z_index",
      "line_height",
      "number_spacing",
      "border_radius",
      "text_size",
      "letter_spacing",
      "display",
      "cursor",
      "hover",
      "text_align",
      "overflow",
      "overflow_x",
      "overflow_y",
      "truncate",
      "group_hover"
    ]
  }

  const content = fs.readFileSync(helperPath, "utf-8")
  const match = content.match(/global_props\s*=\s*%i\[([^\]]+)\]/)

  if (!match) {
    console.warn("Could not parse global_props from helper file")
    return []
  }

  return match[1]
    .split(/\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
}

/**
 * Extract values for a global prop from its module file in lib/playbook
 */
function extractGlobalPropValues(propName: string, playbookPath: string): string[] | undefined {
  // Map prop name to file name (e.g., "number_spacing" -> "number_spacing.rb")
  // Go up from .../playbook/app/pb_kits/playbook to .../playbook/playbook
  const playbookRoot = path.dirname(path.dirname(path.dirname(playbookPath)))
  const libPath = path.join(playbookRoot, "lib/playbook", `${propName}.rb`)

  if (!fs.existsSync(libPath)) {
    return undefined
  }

  const content = fs.readFileSync(libPath, "utf-8")

  // Look for def <prop>_values method
  const valuesMatch = content.match(
    new RegExp(`def\\s+${propName}_values\\s+%w\\[([^\\]]+)\\]`, "i")
  )

  if (!valuesMatch) {
    return undefined
  }

  return valuesMatch[1]
    .split(/\s+/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
}

/**
 * Parse a Ruby prop definition line
 * Example: prop :text, type: Playbook::Props::String, default: "Click"
 */
function parsePropLine(line: string): PropDefinition | null {
  const propMatch = line.match(/prop\s+:(\w+)(?:,\s*(.+))?/)
  if (!propMatch) return null

  const name = propMatch[1]
  const rest = propMatch[2] || ""

  const prop: PropDefinition = { name, type: "any" }

  // Extract type
  const typeMatch = rest.match(/type:\s*Playbook::Props::(\w+)/)
  if (typeMatch) {
    prop.type = typeMatch[1].toLowerCase()
  }

  // Extract default
  const defaultMatch = rest.match(/default:\s*([^,\n]+)/)
  if (defaultMatch) {
    prop.default = defaultMatch[1].trim()
  }

  // Extract enum values
  const valuesMatch = rest.match(/values:\s*%w\[([^\]]+)\]|values:\s*\[([^\]]+)\]/)
  if (valuesMatch) {
    const valuesStr = valuesMatch[1] || valuesMatch[2]
    prop.values = valuesStr
      .split(/[\s,]+/)
      .map((v) => v.replace(/["']/g, "").trim())
      .filter((v) => v && v !== "nil" && v.length > 0)
  }

  return prop
}

/**
 * Parse a Ruby component file to extract metadata
 */
function parseRubyComponent(filePath: string, componentName: string): ComponentMetadata | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8")
    const lines = content.split("\n")

    const props: PropDefinition[] = []
    let inPropSection = false
    let currentPropLines: string[] = []

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // Start looking for props after class definition
      if (line.includes("class") && line.includes("Playbook::KitBase")) {
        inPropSection = true
        continue
      }

      // Stop at first method definition
      if (inPropSection && line.match(/^\s*def\s+/)) {
        break
      }

      // Handle multi-line prop definitions
      if (inPropSection && line.includes("prop :")) {
        currentPropLines = [line]

        // Collect continuation lines (indented further than prop line)
        while (i + 1 < lines.length) {
          const nextLine = lines[i + 1]
          // If next line is indented continuation or has prop attributes
          if (nextLine.match(/^\s{20,}/) || nextLine.trim().match(/^(values|default|type):/)) {
            currentPropLines.push(nextLine)
            i++
          } else {
            break
          }
        }

        const fullPropDef = currentPropLines.join(" ")
        const prop = parsePropLine(fullPropDef)
        if (prop) {
          props.push(prop)
        }
        currentPropLines = []
      }
    }

    // Check if component typically has children (block content)
    const hasChildren =
      content.includes("content_tag") ||
      content.includes("yield") ||
      componentName.match(/card|flex|layout|section|collapsible/i) !== null

    // Convert pb_button to Button, or flex/flex_item to FlexItem
    // For subcomponents (with /), use only the last part for React name
    let reactName: string
    if (componentName.includes("/")) {
      // For subcomponents like "flex/flex_item", just use "FlexItem"
      const subComponentName = componentName.split("/").pop()!
      reactName = subComponentName
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join("")
    } else {
      // For regular components like "button", use "Button"
      reactName = componentName
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join("")
    }

    return {
      name: componentName,
      railsName: componentName,
      reactName,
      props,
      hasChildren
    }
  } catch (error) {
    console.error(`Error parsing ${filePath}:`, error)
    return null
  }
}

/**
 * Scan the Playbook repository for all components
 */
function scanPlaybookComponents(): ComponentMetadata[] {
  const components: ComponentMetadata[] = []

  if (!fs.existsSync(PLAYBOOK_REPO_PATH)) {
    console.error(`Playbook repository not found at: ${PLAYBOOK_REPO_PATH}`)
    console.error("Set PLAYBOOK_REPO_PATH environment variable to the correct path.")
    process.exit(1)
  }

  const entries = fs.readdirSync(PLAYBOOK_REPO_PATH)

  for (const entry of entries) {
    // Skip non-component directories
    if (!entry.startsWith("pb_") || entry === "pb_kit" || entry === "pb_docs") {
      continue
    }

    const componentDir = path.join(PLAYBOOK_REPO_PATH, entry)
    const stats = fs.statSync(componentDir)

    if (!stats.isDirectory()) continue

    // Look for the Ruby class file (main component)
    const rubyFile = path.join(componentDir, `${entry.replace("pb_", "")}.rb`)
    if (fs.existsSync(rubyFile)) {
      const metadata = parseRubyComponent(rubyFile, entry.replace("pb_", ""))
      if (metadata) {
        components.push(metadata)
      }
    }

    // Look for subcomponents in the same directory
    const subComponentFiles = fs
      .readdirSync(componentDir)
      .filter((file) => file.endsWith(".rb") && file !== `${entry.replace("pb_", "")}.rb`)

    for (const subFile of subComponentFiles) {
      const subComponentPath = path.join(componentDir, subFile)
      const subComponentName = subFile.replace(".rb", "")
      const fullComponentName = `${entry.replace("pb_", "")}/${subComponentName}`

      const metadata = parseRubyComponent(subComponentPath, fullComponentName)
      if (metadata) {
        components.push(metadata)
      }
    }
  }

  return components.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Generate ERB snippet for a component
 */
function generateERBSnippet(component: ComponentMetadata): any {
  const { name, props, hasChildren } = component
  const prefix = `pb_${name}`

  // Build prop suggestions
  const propLines: string[] = []
  let tabIndex = 1

  // Prioritize common props
  const priorityProps = ["text", "variant", "size"]
  const orderedProps = [
    ...props.filter((p) => priorityProps.includes(p.name)),
    ...props.filter((p) => !priorityProps.includes(p.name))
  ]

  for (const prop of orderedProps.slice(0, 5)) {
    // Limit to first 5 props
    if (prop.values && prop.values.length > 0) {
      const choices = prop.values.join(",")
      propLines.push(`\t${prop.name}: "\${${tabIndex}|${choices}|}\",`)
    } else if (prop.default !== undefined && prop.default !== "nil" && prop.default !== "false") {
      propLines.push(`\t${prop.name}: "\${${tabIndex}:${prop.default.replace(/"/g, "")}}\",`)
    } else {
      propLines.push(`\t${prop.name}: "\${${tabIndex}}\",`)
    }
    tabIndex++
  }

  const body: string[] = []

  if (hasChildren) {
    body.push(`<%= pb_rails("${name}", props: {`)
    if (propLines.length > 0) {
      body.push(...propLines)
    }
    body.push(`\t$0`)
    body.push(`}) do %>`)
    body.push(`\t\${${tabIndex}:Content}`)
    body.push(`<% end %>`)
  } else {
    body.push(`<%= pb_rails("${name}", props: {`)
    if (propLines.length > 0) {
      body.push(...propLines)
    }
    body.push(`\t$0`)
    body.push(`}) %>`)
  }

  return {
    prefix,
    body,
    description: `Playbook ${component.reactName} component for Rails/ERB`
  }
}

/**
 * Generate React snippet for a component
 */
function generateReactSnippet(component: ComponentMetadata): any {
  const { reactName, props, hasChildren } = component
  const prefix = `pb${reactName}`

  const propLines: string[] = []
  let tabIndex = 1

  // Prioritize common props
  const priorityProps = ["text", "variant", "size"]
  const orderedProps = [
    ...props.filter((p) => priorityProps.includes(p.name)),
    ...props.filter((p) => !priorityProps.includes(p.name))
  ]

  for (const prop of orderedProps.slice(0, 5)) {
    // Limit to first 5 props
    const propName = prop.name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())

    if (prop.values && prop.values.length > 0) {
      const choices = prop.values.map((v) => `\\"${v}\\"`).join(",")
      propLines.push(`\t${propName}={\${${tabIndex}|${choices}|}}`)
    } else if (prop.type === "boolean") {
      propLines.push(`\t${propName}={\${${tabIndex}|true,false|}}`)
    } else if (prop.default !== undefined && prop.default !== "nil" && prop.default !== "false") {
      propLines.push(`\t${propName}="\${${tabIndex}:${prop.default.replace(/"/g, "")}}"`)
    } else {
      propLines.push(`\t${propName}="\${${tabIndex}}"`)
    }
    tabIndex++
  }

  const body: string[] = []

  if (hasChildren) {
    body.push(`<${reactName}`)
    if (propLines.length > 0) {
      body.push(...propLines)
    }
    body.push(`\t$0`)
    body.push(`>`)
    body.push(`\t\${${tabIndex}:Content}`)
    body.push(`</${reactName}>`)
  } else {
    body.push(`<${reactName}`)
    if (propLines.length > 0) {
      body.push(...propLines)
    }
    body.push(`\t$0`)
    body.push(`/>`)
  }

  return {
    prefix,
    body,
    description: `Playbook ${reactName} component for React`
  }
}

/**
 * Generate snippet files
 */
function generateSnippets(components: ComponentMetadata[]): void {
  const railsSnippets: Record<string, any> = {}
  const reactSnippets: Record<string, any> = {}

  for (const component of components) {
    // Use unique names to avoid collisions between standalone and subcomponents
    // For subcomponents like "layout/body", create a unique snippet name
    const railsSnippetName = component.railsName.includes("/")
      ? `Playbook ${component.railsName
          .split("/")
          .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
          .join("")}`
      : `Playbook ${component.reactName}`
    const reactSnippetName = `Playbook ${component.reactName}`

    railsSnippets[railsSnippetName] = generateERBSnippet(component)
    reactSnippets[reactSnippetName] = generateReactSnippet(component)
  }

  // Add import snippet for React
  reactSnippets["Playbook import"] = {
    prefix: "pbImport",
    body: ["import { ${1:Button} } from 'playbook-ui'$0"],
    description: "Import Playbook components"
  }

  // Write files
  fs.writeFileSync(path.join(SNIPPETS_DIR, "rails.json"), JSON.stringify(railsSnippets, null, 2))

  fs.writeFileSync(path.join(SNIPPETS_DIR, "react.json"), JSON.stringify(reactSnippets, null, 2))

  console.log(`✅ Generated ${Object.keys(railsSnippets).length} Rails snippets`)
  console.log(`✅ Generated ${Object.keys(reactSnippets).length} React snippets`)
}

/**
 * Generate metadata file
 */
function generateMetadata(components: ComponentMetadata[]): void {
  // Extract global props dynamically from Playbook TypeScript source
  const globalProps = extractGlobalPropsFromTypeScript(PLAYBOOK_REPO_PATH)

  console.log(
    `✅ Extracted ${Object.keys(globalProps).length} global props from TypeScript definitions`
  )
  const metadata: any = {
    $schema: "./playbook-schema.json",
    generatedAt: new Date().toISOString(),
    globalProps,
    components: {}
  }

  // Use railsName as key to avoid collisions (e.g., "body" vs "layout/body")
  for (const component of components) {
    // Create a unique key: for subcomponents use full path, for regular use react name
    const key = component.railsName.includes("/") ? component.railsName : component.reactName

    metadata.components[key] = {
      rails: component.railsName,
      react: component.reactName,
      description: `Playbook ${component.reactName} component`,
      hasChildren: component.hasChildren,
      props: component.props.reduce(
        (acc, prop) => {
          acc[prop.name] = {
            type: prop.type,
            ...(prop.default !== undefined && { default: prop.default }),
            ...(prop.values && { values: prop.values }),
            ...(prop.required && { required: prop.required })
          }
          return acc
        },
        {} as Record<string, any>
      )
    }
  }

  fs.writeFileSync(path.join(DATA_DIR, "playbook.json"), JSON.stringify(metadata, null, 2))

  console.log(`✅ Generated metadata for ${components.length} components`)
}

/**
 * Main execution
 */
function main() {
  console.log("🔄 Syncing with Playbook UI repository...\n")
  console.log(`Scanning: ${PLAYBOOK_REPO_PATH}\n`)

  const components = scanPlaybookComponents()

  console.log(`Found ${components.length} components:\n`)
  components
    .slice(0, 10)
    .forEach((c) => console.log(`  - ${c.reactName} (${c.props.length} props)`))
  if (components.length > 10) {
    console.log(`  ... and ${components.length - 10} more\n`)
  }

  generateSnippets(components)
  generateMetadata(components)

  console.log("\n✨ Sync complete!")
}

main()
