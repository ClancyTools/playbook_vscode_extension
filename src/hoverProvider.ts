import * as vscode from "vscode";
import {
  loadMetadata,
  findComponentByRailsName,
  findComponentByReactName,
  findRailsSubcomponent,
  findReactSubcomponent,
  findGlobalPropForComponent,
  generateComponentDocs,
  generateSubcomponentDocs,
  generatePropDocs,
  generateFormMethodDocs,
  loadFormBuilderMetadata,
  findFormBuilderField,
  platformFor,
  propGuidanceLines,
  PlaybookMetadata
} from "./metadata";
import { loadPlayground } from "./playgrounds";
import {
  parseRailsComponent,
  parseReactComponent,
  parseRailsProps,
  parseFormBuilderMethod,
  parseReactProps,
  findComponentContext
} from "./parser";

export class PlaybookHoverProvider implements vscode.HoverProvider {
  private extensionPath: string;

  constructor(extensionPath: string) {
    this.extensionPath = extensionPath;
    console.log(`[PlaybookHoverProvider] Created with extension path: ${extensionPath}`);
  }

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.Hover> {
    console.log(
      `[PlaybookHoverProvider] Hover requested at ${document.languageId}:${position.line}:${position.character}`
    );

    const metadata: PlaybookMetadata = loadMetadata(this.extensionPath);

    if (platformFor(document.languageId) === "rails") {
      const method = parseFormBuilderMethod(document, position);
      const field =
        method && findFormBuilderField(loadFormBuilderMetadata(this.extensionPath), method.methodName);
      if (method && field) {
        return new vscode.Hover(
          new vscode.MarkdownString(generateFormMethodDocs(field)),
          method.range
        );
      }
    }

    const railsComponent = parseRailsComponent(document, position);
    if (railsComponent) {
      const component = findComponentByRailsName(metadata, railsComponent.componentName);
      if (component) {
        const docs = generateComponentDocs(
          railsComponent.componentName,
          component,
          metadata,
          loadPlayground(this.extensionPath, component.rails)
        );
        return new vscode.Hover(new vscode.MarkdownString(docs), railsComponent.range);
      }

      const subcomponent = findRailsSubcomponent(metadata, railsComponent.componentName);
      if (subcomponent) {
        const docs = generateSubcomponentDocs(railsComponent.componentName, subcomponent);
        return new vscode.Hover(new vscode.MarkdownString(docs), railsComponent.range);
      }
    }

    const reactComponent = parseReactComponent(document, position);
    if (reactComponent) {
      const component = findComponentByReactName(metadata, reactComponent.componentName);
      if (component) {
        const docs = generateComponentDocs(
          reactComponent.componentName,
          component,
          metadata,
          loadPlayground(this.extensionPath, component.rails)
        );
        return new vscode.Hover(new vscode.MarkdownString(docs), reactComponent.range);
      }

      const subcomponent = findReactSubcomponent(metadata, reactComponent.componentName);
      if (subcomponent) {
        const docs = generateSubcomponentDocs(reactComponent.componentName, subcomponent);
        return new vscode.Hover(new vscode.MarkdownString(docs), reactComponent.range);
      }
    }

    const railsProp = parseRailsProps(document, position);
    if (railsProp) {
      const componentContext = findComponentContext(document, position);
      if (componentContext) {
        const component =
          componentContext.type === "rails"
            ? findComponentByRailsName(metadata, componentContext.componentName)
            : findComponentByReactName(metadata, componentContext.componentName);

        if (component) {
          const prop =
            component.props[railsProp.propName] ||
            findGlobalPropForComponent(metadata, component, railsProp.propName);
          if (prop) {
            const propDocs = generatePropDocs(
              railsProp.propName,
              prop,
              !component.props[railsProp.propName],
              metadata,
              document.languageId
            );
            const guidance = propGuidanceLines(
              component,
              railsProp.propName,
              loadPlayground(this.extensionPath, component.rails),
              document.languageId
            );
            return new vscode.Hover(
              new vscode.MarkdownString([propDocs, ...guidance].join("  \n")),
              railsProp.range
            );
          }
        }
      }
    }

    const reactProp = parseReactProps(document, position);
    if (reactProp) {
      const componentContext = findComponentContext(document, position);
      if (componentContext) {
        const component = findComponentByReactName(metadata, componentContext.componentName);

        if (component) {
          const snakeCaseProp = reactProp.propName.replace(/([A-Z])/g, "_$1").toLowerCase();

          const prop =
            component.props[snakeCaseProp] ||
            findGlobalPropForComponent(metadata, component, snakeCaseProp);
          if (prop) {
            const propDocs = generatePropDocs(
              reactProp.propName,
              prop,
              !component.props[snakeCaseProp],
              metadata,
              document.languageId
            );
            const guidance = propGuidanceLines(
              component,
              snakeCaseProp,
              loadPlayground(this.extensionPath, component.rails),
              document.languageId
            );
            return new vscode.Hover(
              new vscode.MarkdownString([propDocs, ...guidance].join("  \n")),
              reactProp.range
            );
          }
        }
      }
    }

    return null;
  }
}
