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

    // Convert pb_button to Button
    const reactName = componentName
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join("")

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

    // Look for the Ruby class file
    const rubyFile = path.join(componentDir, `${entry.replace("pb_", "")}.rb`)
    if (fs.existsSync(rubyFile)) {
      const metadata = parseRubyComponent(rubyFile, entry.replace("pb_", ""))
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
    const railsSnippetName = `Playbook ${component.reactName}`
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
  const metadata: any = {
    $schema: "./playbook-schema.json",
    generatedAt: new Date().toISOString(),
    components: {}
  }

  for (const component of components) {
    metadata.components[component.reactName] = {
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
