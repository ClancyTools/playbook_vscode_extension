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
  getPropDeprecation,
  propGuidanceLines,
  ComponentMetadata,
  PlaybookMetadata
} from "./metadata";
import { loadPlayground } from "./playgrounds";
import { axisGuidanceLines, migrationForUsage, resolveOrientation, migrationText } from "./flexAxis";
import { propAt } from "./usageRules";
import { valueHover } from "./valueHover";
import { enabled } from "./settings";
import { loadColorTokens } from "./colorTokens";
import { loadIconIndex } from "./playbookIcons";
import { loadKitColors } from "./kitColors";
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

  /** How the flex axis props apply to this exact usage (orientation resolved from the code). */
  private flexLines(
    document: vscode.TextDocument,
    position: vscode.Position,
    component: ComponentMetadata,
    snakeProp: string
  ): string[] {
    if (!enabled("flexAxis.enabled")) {
      return [];
    }
    const hit = propAt(document.getText(), document.languageId, document.offsetAt(position));
    const resolved = hit ? resolveOrientation(hit.usage, component) : undefined;
    const lines = axisGuidanceLines(component, snakeProp, resolved, platformFor(document.languageId));
    const deprecated = hit && getPropDeprecation(component, snakeProp, document.languageId);
    const migrated = hit && deprecated && migrationForUsage(hit.usage, component, hit.prop);
    if (migrated) {
      lines.push(
        `Migrates to \`${migrationText(migrated.migration, platformFor(document.languageId))}\` (orientation is \`${migrated.resolved.orientation}\`).`
      );
    }
    return lines;
  }

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.Hover> {
    if (!enabled("hover.enabled")) {
      return null;
    }
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

    const value = !enabled("hover.valuePreviews") ? undefined : valueHover(
      document.getText(),
      document.languageId,
      document.offsetAt(position),
      metadata,
      loadColorTokens(this.extensionPath),
      loadIconIndex(),
      loadKitColors(this.extensionPath)
    );
    if (value) {
      const markdown = new vscode.MarkdownString(value.markdown);
      return new vscode.Hover(
        markdown,
        new vscode.Range(document.positionAt(value.start), document.positionAt(value.end))
      );
    }

    const railsComponent = parseRailsComponent(document, position);
    if (railsComponent) {
      const component = findComponentByRailsName(metadata, railsComponent.componentName);
      if (component) {
        const docs = generateComponentDocs(
          railsComponent.componentName,
          component,
          metadata,
          loadPlayground(this.extensionPath, component.rails),
          document.languageId,
          { guidance: enabled("hover.kitGuidance"), globalProps: enabled("hover.globalProps") }
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
          loadPlayground(this.extensionPath, component.rails),
          document.languageId,
          { guidance: enabled("hover.kitGuidance"), globalProps: enabled("hover.globalProps") }
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
            const guidance = !enabled("hover.kitGuidance") ? [] : propGuidanceLines(
              component,
              railsProp.propName,
              loadPlayground(this.extensionPath, component.rails),
              document.languageId
            );
            guidance.push(...this.flexLines(document, position, component, railsProp.propName));
            return new vscode.Hover(
              new vscode.MarkdownString([propDocs, ...guidance].join("  \n")),
              railsProp.range
            );
          }
        } else {
          const hover = this.subcomponentGlobalPropHover(
            metadata,
            componentContext.type,
            componentContext.componentName,
            railsProp.propName,
            railsProp.range,
            document.languageId
          );
          if (hover) {
            return hover;
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
            const guidance = !enabled("hover.kitGuidance") ? [] : propGuidanceLines(
              component,
              snakeCaseProp,
              loadPlayground(this.extensionPath, component.rails),
              document.languageId
            );
            guidance.push(...this.flexLines(document, position, component, snakeCaseProp));
            return new vscode.Hover(
              new vscode.MarkdownString([propDocs, ...guidance].join("  \n")),
              reactProp.range
            );
          }
        } else {
          const hover = this.subcomponentGlobalPropHover(
            metadata,
            "react",
            componentContext.componentName,
            reactProp.propName.replace(/([A-Z])/g, "_$1").toLowerCase(),
            reactProp.range,
            document.languageId,
            reactProp.propName
          );
          if (hover) {
            return hover;
          }
        }
      }
    }

    return null;
  }

  /**
   * Subcomponents (card/card_body, Card.Body) have no schema of their own, but
   * every component takes the global props, so those are documented through the
   * parent kit.
   */
  private subcomponentGlobalPropHover(
    metadata: PlaybookMetadata,
    type: string,
    componentName: string,
    snakeProp: string,
    range: vscode.Range,
    languageId: string,
    displayName: string = snakeProp
  ): vscode.Hover | null {
    const sub =
      type === "rails"
        ? findRailsSubcomponent(metadata, componentName)
        : findReactSubcomponent(metadata, componentName);
    const prop = sub && findGlobalPropForComponent(metadata, sub.parent, snakeProp);
    if (!sub || !prop) {
      return null;
    }
    const docs = generatePropDocs(displayName, prop, true, metadata, languageId);
    return new vscode.Hover(
      new vscode.MarkdownString(
        [docs, `Global prop, available on \`${componentName}\` like on every Playbook component.`].join("  \n")
      ),
      range
    );
  }
}
