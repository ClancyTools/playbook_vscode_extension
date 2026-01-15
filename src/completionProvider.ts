import * as vscode from "vscode"
import { loadMetadata, ComponentMetadata } from "./metadata"
import { findComponentContext } from "./parser"

export class PlaybookCompletionProvider implements vscode.CompletionItemProvider {
  private extensionPath: string

  constructor(extensionPath: string) {
    this.extensionPath = extensionPath
  }

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
    const metadata = loadMetadata(this.extensionPath)
    const line = document.lineAt(position.line).text
    const linePrefix = line.substring(0, position.character)

    // Check what kind of completion we need
    const completionType = this.detectCompletionType(linePrefix, document, position)

    switch (completionType) {
      case "rails-component":
        return this.provideRailsComponentCompletions(metadata)
      case "react-component":
        return this.provideReactComponentCompletions(metadata)
      case "rails-prop-name":
        return this.provideRailsPropNameCompletions(document, position, metadata)
      case "react-prop-name":
        return this.provideReactPropNameCompletions(document, position, metadata)
      case "rails-prop-value":
        return this.providePropValueCompletions(document, position, metadata, "rails")
      case "react-prop-value":
        return this.providePropValueCompletions(document, position, metadata, "react")
      default:
        return []
    }
  }

  /**
   * Detect what type of completion is needed based on context
   */
  private detectCompletionType(
    linePrefix: string,
    document: vscode.TextDocument,
    position: vscode.Position
  ): string {
    // Rails component name: pb_rails("...")
    if (linePrefix.match(/pb_rails\(\s*["']$/)) {
      return "rails-component"
    }

    // Rails prop name: props: { ... }
    if (linePrefix.match(/props:\s*\{[^}]*$/)) {
      const hasColon = linePrefix.match(/(\w+):\s*$/)
      if (!hasColon) {
        // We're typing a prop name
        return "rails-prop-name"
      } else {
        // We're typing a prop value
        return "rails-prop-value"
      }
    }

    // Rails prop value after colon
    if (linePrefix.match(/(\w+):\s*["']?$/)) {
      if (linePrefix.includes("pb_rails")) {
        return "rails-prop-value"
      }
    }

    // React component: < at start of tag
    if (linePrefix.match(/<[A-Z]?\w*$/)) {
      return "react-component"
    }

    // React prop name: <Component ...
    const reactTagMatch = linePrefix.match(/<([A-Z][a-zA-Z0-9]*)\s+/)
    if (reactTagMatch) {
      const afterTag = linePrefix.substring(
        linePrefix.indexOf(reactTagMatch[1]) + reactTagMatch[1].length
      )

      // Check if we're typing a value
      if (afterTag.match(/\w+\s*=\s*["'{]?$/)) {
        return "react-prop-value"
      }

      // Otherwise typing prop name
      return "react-prop-name"
    }

    return "none"
  }

  /**
   * Provide Rails component name completions
   */
  private provideRailsComponentCompletions(metadata: any): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = []

    for (const [componentName, component] of Object.entries<ComponentMetadata>(
      metadata.components
    )) {
      const item = new vscode.CompletionItem(component.rails, vscode.CompletionItemKind.Class)
      item.detail = `Playbook ${componentName}`
      item.documentation = new vscode.MarkdownString(component.description)

      // Insert just the component name (the quotes and pb_rails are already there)
      item.insertText = component.rails

      // Add snippet for props if component has them
      if (Object.keys(component.props).length > 0) {
        const propNames = Object.keys(component.props).slice(0, 3).join(", ")
        item.documentation.appendMarkdown(`\n\nProps: ${propNames}...`)
      }

      items.push(item)
    }

    return items.sort((a, b) => a.label.toString().localeCompare(b.label.toString()))
  }

  /**
   * Provide React component name completions
   */
  private provideReactComponentCompletions(metadata: any): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = []

    for (const [componentName, component] of Object.entries<ComponentMetadata>(
      metadata.components
    )) {
      const item = new vscode.CompletionItem(componentName, vscode.CompletionItemKind.Class)
      item.detail = `Playbook ${componentName}`
      item.documentation = new vscode.MarkdownString(component.description)

      // Create snippet with common props
      const commonProps = Object.entries(component.props).slice(0, 2)
      if (commonProps.length > 0) {
        let snippet = componentName
        commonProps.forEach(([propName, prop], index) => {
          const camelProp = propName.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
          snippet += `\n\t${camelProp}={$${index + 1}}`
        })

        if (component.hasChildren) {
          snippet += "\n>\n\t$0\n</" + componentName + ">"
        } else {
          snippet += "\n\t$0\n/>"
        }

        item.insertText = new vscode.SnippetString(snippet)
        item.kind = vscode.CompletionItemKind.Snippet
      }

      items.push(item)
    }

    return items.sort((a, b) => a.label.toString().localeCompare(b.label.toString()))
  }

  /**
   * Provide Rails prop name completions
   */
  private provideRailsPropNameCompletions(
    document: vscode.TextDocument,
    position: vscode.Position,
    metadata: any
  ): vscode.CompletionItem[] {
    const componentContext = findComponentContext(document, position)
    if (!componentContext || componentContext.type !== "rails") {
      return []
    }

    const items: vscode.CompletionItem[] = []

    for (const [componentName, component] of Object.entries<ComponentMetadata>(
      metadata.components
    )) {
      if (component.rails === componentContext.componentName) {
        for (const [propName, prop] of Object.entries(component.props)) {
          const item = new vscode.CompletionItem(propName, vscode.CompletionItemKind.Property)
          item.detail = `${prop.type}${prop.required ? " (required)" : ""}`

          let doc = `Type: \`${prop.type}\``
          if (prop.values && prop.values.length > 0) {
            doc += `\nValues: ${prop.values.map((v) => `\`${v}\``).join(", ")}`
          }
          if (prop.default !== undefined) {
            doc += `\nDefault: \`${prop.default}\``
          }

          item.documentation = new vscode.MarkdownString(doc)

          // Add snippet with value placeholder
          if (prop.values && prop.values.length > 0) {
            const choices = prop.values.join(",")
            item.insertText = new vscode.SnippetString(`${propName}: "\${1|${choices}|}"`)
          } else if (prop.type === "boolean") {
            item.insertText = new vscode.SnippetString(`${propName}: \${1|true,false|}`)
          } else {
            item.insertText = new vscode.SnippetString(`${propName}: "\${1}"`)
          }

          item.kind = vscode.CompletionItemKind.Snippet
          items.push(item)
        }
        break
      }
    }

    return items
  }

  /**
   * Provide React prop name completions
   */
  private provideReactPropNameCompletions(
    document: vscode.TextDocument,
    position: vscode.Position,
    metadata: any
  ): vscode.CompletionItem[] {
    const componentContext = findComponentContext(document, position)
    if (!componentContext || componentContext.type !== "react") {
      return []
    }

    const component = metadata.components[componentContext.componentName]
    if (!component) {
      return []
    }

    const items: vscode.CompletionItem[] = []

    for (const [propName, prop] of Object.entries(component.props)) {
      const camelProp = propName.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
      const item = new vscode.CompletionItem(camelProp, vscode.CompletionItemKind.Property)
      item.detail = `${(prop as any).type}${(prop as any).required ? " (required)" : ""}`

      let doc = `Type: \`${(prop as any).type}\``
      if ((prop as any).values && (prop as any).values.length > 0) {
        doc += `\nValues: ${(prop as any).values.map((v: string) => `\`${v}\``).join(", ")}`
      }
      if ((prop as any).default !== undefined) {
        doc += `\nDefault: \`${(prop as any).default}\``
      }

      item.documentation = new vscode.MarkdownString(doc)

      // Add snippet with value placeholder
      if ((prop as any).values && (prop as any).values.length > 0) {
        const choices = (prop as any).values.map((v: string) => `"${v}"`).join(",")
        item.insertText = new vscode.SnippetString(`${camelProp}={\${1|${choices}|}}`)
      } else if ((prop as any).type === "boolean") {
        item.insertText = new vscode.SnippetString(`${camelProp}={$\{1|true,false|}}`)
      } else {
        item.insertText = new vscode.SnippetString(`${camelProp}="\${1}"`)
      }

      item.kind = vscode.CompletionItemKind.Snippet
      items.push(item)
    }

    return items
  }

  /**
   * Provide prop value completions for enums
   */
  private providePropValueCompletions(
    document: vscode.TextDocument,
    position: vscode.Position,
    metadata: any,
    type: "rails" | "react"
  ): vscode.CompletionItem[] {
    const componentContext = findComponentContext(document, position)
    if (!componentContext) {
      return []
    }

    const component =
      type === "rails"
        ? Object.values<ComponentMetadata>(metadata.components).find(
            (c) => c.rails === componentContext.componentName
          )
        : metadata.components[componentContext.componentName]

    if (!component) {
      return []
    }

    // Find which prop we're completing
    const line = document.lineAt(position.line).text
    const beforeCursor = line.substring(0, position.character)

    let propName: string | null = null

    if (type === "rails") {
      const match = beforeCursor.match(/(\w+):\s*["']?$/)
      if (match) {
        propName = match[1]
      }
    } else {
      const match = beforeCursor.match(/(\w+)\s*=\s*["'{]?$/)
      if (match) {
        // Convert camelCase to snake_case
        propName = match[1].replace(/([A-Z])/g, "_$1").toLowerCase()
      }
    }

    if (!propName || !component.props[propName]) {
      return []
    }

    const prop = component.props[propName]
    const items: vscode.CompletionItem[] = []

    // Provide enum value completions
    if (prop.values && prop.values.length > 0) {
      for (const value of prop.values) {
        const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.EnumMember)
        item.detail = `Valid value for ${propName}`
        item.insertText = value

        if (value === prop.default?.replace(/["']/g, "")) {
          item.detail += " (default)"
          // Sort default value first
          item.sortText = "0" + value
        }

        items.push(item)
      }
    }

    // Provide boolean completions
    if (prop.type === "boolean") {
      const trueItem = new vscode.CompletionItem("true", vscode.CompletionItemKind.Value)
      trueItem.insertText = "true"
      const falseItem = new vscode.CompletionItem("false", vscode.CompletionItemKind.Value)
      falseItem.insertText = "false"

      if (prop.default === "true") {
        trueItem.detail = "(default)"
        trueItem.sortText = "0true"
      } else if (prop.default === "false") {
        falseItem.detail = "(default)"
        falseItem.sortText = "0false"
      }

      items.push(trueItem, falseItem)
    }

    return items
  }
}
