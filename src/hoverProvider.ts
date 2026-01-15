import * as vscode from "vscode"
import {
  loadMetadata,
  findComponentByRailsName,
  findComponentByReactName,
  generateComponentDocs,
  generatePropDocs
} from "./metadata"
import {
  parseRailsComponent,
  parseReactComponent,
  parseRailsProps,
  parseReactProps,
  findComponentContext
} from "./parser"

export class PlaybookHoverProvider implements vscode.HoverProvider {
  private extensionPath: string

  constructor(extensionPath: string) {
    this.extensionPath = extensionPath
  }

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.Hover> {
    const metadata = loadMetadata(this.extensionPath)

    // Try to parse as component name
    const railsComponent = parseRailsComponent(document, position)
    if (railsComponent) {
      const component = findComponentByRailsName(metadata, railsComponent.componentName)
      if (component) {
        const docs = generateComponentDocs(railsComponent.componentName, component)
        return new vscode.Hover(new vscode.MarkdownString(docs), railsComponent.range)
      }
    }

    const reactComponent = parseReactComponent(document, position)
    if (reactComponent) {
      const component = findComponentByReactName(metadata, reactComponent.componentName)
      if (component) {
        const docs = generateComponentDocs(reactComponent.componentName, component)
        return new vscode.Hover(new vscode.MarkdownString(docs), reactComponent.range)
      }
    }

    // Try to parse as prop name
    const railsProp = parseRailsProps(document, position)
    if (railsProp) {
      const componentContext = findComponentContext(document, position)
      if (componentContext) {
        const component =
          componentContext.type === "rails"
            ? findComponentByRailsName(metadata, componentContext.componentName)
            : findComponentByReactName(metadata, componentContext.componentName)

        if (component && component.props[railsProp.propName]) {
          const propDocs = generatePropDocs(railsProp.propName, component.props[railsProp.propName])
          return new vscode.Hover(new vscode.MarkdownString(propDocs), railsProp.range)
        }
      }
    }

    const reactProp = parseReactProps(document, position)
    if (reactProp) {
      const componentContext = findComponentContext(document, position)
      if (componentContext) {
        const component = findComponentByReactName(metadata, componentContext.componentName)

        if (component) {
          // Convert camelCase to snake_case to find prop
          const snakeCaseProp = reactProp.propName.replace(/([A-Z])/g, "_$1").toLowerCase()

          if (component.props[snakeCaseProp]) {
            const propDocs = generatePropDocs(reactProp.propName, component.props[snakeCaseProp])
            return new vscode.Hover(new vscode.MarkdownString(propDocs), reactProp.range)
          }
        }
      }
    }

    return null
  }
}
