import * as vscode from "vscode"
import {
  loadMetadata,
  ComponentMetadata,
  getPropValues,
  getPropType,
  getPropDefault,
  isBooleanProp,
  isPropValidForPlatform,
  isComponentValidForPlatform,
  findGlobalPropForComponent,
  PlaybookMetadata,
  PropMetadata,
  findFormBuilderField,
  generateFormMethodDocs,
  loadFormBuilderMetadata,
  platformFor,
} from "./metadata"
import { findComponentContext, findFormBuilderContext } from "./parser"
import { loadPlayground } from "./playgrounds"
import { renderPresets } from "./presets"
import { axisLabel, axisLabelBothWays, axisRole, resolveOrientation } from "./flexAxis"
import { usageAt } from "./usageRules"

export class PlaybookCompletionProvider
  implements vscode.CompletionItemProvider
{
  private extensionPath: string

  constructor(extensionPath: string) {
    this.extensionPath = extensionPath
    console.log(
      `[PlaybookCompletionProvider] Created with extension path: ${extensionPath}`
    )
  }

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
    console.log(
      `[PlaybookCompletionProvider] Completion requested at ${document.languageId}:${position.line}:${position.character}, trigger: ${context.triggerCharacter || "manual"}`
    )

    const metadata = loadMetadata(this.extensionPath)
    const line = document.lineAt(position.line).text
    const linePrefix = line.substring(0, position.character)
    console.log(`[PlaybookCompletionProvider] Line prefix: "${linePrefix}"`)

    if (
      platformFor(document.languageId) === "rails" &&
      /\b(?:f|form|builder)\.\w*$/.test(linePrefix)
    ) {
      return this.provideFormMethodCompletions()
    }

    const completionType = this.detectCompletionType(
      linePrefix,
      document,
      position
    )
    console.log(
      `[PlaybookCompletionProvider] Detected completion type: ${completionType}`
    )

    switch (completionType) {
      case "rails-component":
        return [
          ...this.provideRailsComponentCompletions(metadata),
          ...this.provideRailsPresetCompletions(metadata, document, position),
        ]
      case "react-component":
        return [
          ...this.provideReactComponentCompletions(metadata),
          ...this.provideReactPresetCompletions(metadata, document),
        ]
      case "rails-prop-name":
        return this.provideRailsPropNameCompletions(
          document,
          position,
          metadata
        )
      case "react-prop-name":
        return this.provideReactPropNameCompletions(
          document,
          position,
          metadata
        )
      case "rails-prop-value":
        return this.providePropValueCompletions(
          document,
          position,
          metadata,
          "rails"
        )
      case "react-prop-value":
        return this.providePropValueCompletions(
          document,
          position,
          metadata,
          "react"
        )
      default:
        console.log(
          `[PlaybookCompletionProvider] No completions for type: ${completionType}`
        )
        return []
    }
  }

  private detectCompletionType(
    linePrefix: string,
    document: vscode.TextDocument,
    position: vscode.Position
  ): string {
    if (linePrefix.match(/pb_rails\(\s*["']$/)) {
      return "rails-component"
    }

    const propsContext = this.findPropsContext(document, position)

    if (
      (linePrefix.includes("props:") && linePrefix.includes("{")) ||
      propsContext
    ) {
      const lastBraceIndex = linePrefix.lastIndexOf("{")
      const afterBrace =
        lastBraceIndex !== -1
          ? linePrefix.substring(lastBraceIndex + 1)
          : linePrefix
      const propValueMatch = afterBrace.match(/(\w+):\s*["']?([^",}]*)$/)

      if (propValueMatch) {
        return "rails-prop-value"
      }
      return "rails-prop-name"
    }

    if (linePrefix.match(/<[A-Z]?\w*$/)) {
      return "react-component"
    }

    const reactTagMatch = linePrefix.match(/<([A-Z][a-zA-Z0-9]*)\s+/)
    if (reactTagMatch) {
      const afterTag = linePrefix.substring(
        linePrefix.indexOf(reactTagMatch[1]) + reactTagMatch[1].length
      )

      if (afterTag.match(/\w+\s*=\s*["'{]?$/)) {
        return "react-prop-value"
      }

      return "react-prop-name"
    }

    const reactComponentContext = this.findReactComponentContext(
      document,
      position
    )
    if (reactComponentContext) {
      if (linePrefix.match(/\w+\s*=\s*["'{]?$/)) {
        return "react-prop-value"
      }
      return "react-prop-name"
    }

    return "none"
  }

  private findReactComponentContext(
    document: vscode.TextDocument,
    position: vscode.Position
  ): string | null {
    for (
      let lineNum = position.line;
      lineNum >= Math.max(0, position.line - 20);
      lineNum--
    ) {
      const line = document.lineAt(lineNum).text

      const componentMatch = line.match(/<([A-Z][a-zA-Z0-9]*)(?:\s|$)/)
      if (componentMatch) {
        const componentName = componentMatch[1]

        let foundClosing = false
        for (let checkLine = lineNum; checkLine <= position.line; checkLine++) {
          const checkText = document.lineAt(checkLine).text
          if (
            checkText.includes("/>") ||
            checkText.includes(`</${componentName}>`)
          ) {
            if (
              checkLine < position.line ||
              (checkLine === position.line &&
                checkText.indexOf("/>") < position.character)
            ) {
              foundClosing = true
              break
            }
          }
        }

        if (!foundClosing) {
          return componentName
        }
      }
    }

    return null
  }

  private findPropsContext(
    document: vscode.TextDocument,
    position: vscode.Position
  ): boolean {
    let openBraces = 0
    let foundPropsStart = false

    for (
      let lineNum = position.line;
      lineNum >= Math.max(0, position.line - 20);
      lineNum--
    ) {
      const line = document.lineAt(lineNum).text
      const searchText =
        lineNum === position.line ? line.substring(0, position.character) : line

      for (let i = searchText.length - 1; i >= 0; i--) {
        const char = searchText[i]
        if (char === "}") {
          openBraces++
        } else if (char === "{") {
          openBraces--

          if (openBraces < 0) {
            const beforeBrace = searchText.substring(0, i).trim()
            if (beforeBrace.endsWith("props:")) {
              foundPropsStart = true
              break
            }
            return false
          }
        }
      }

      if (foundPropsStart) {
        break
      }

      if (line.includes("pb_rails") && !foundPropsStart) {
        return false
      }
    }

    return foundPropsStart
  }

  /**
   * One completion per named Playbook preset ("dropdown: Create tags") that
   * writes the kit name and its props. Typed after `pb_rails("`, so it also
   * swallows an auto-closed `")` and re-adds the paren after the props.
   */
  private provideRailsPresetCompletions(
    metadata: PlaybookMetadata,
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = []
    const rest = document.lineAt(position.line).text.substring(position.character)
    const closing = /^["']\)/.test(rest) ? 2 : /^["']/.test(rest) ? 1 : 0

    for (const component of Object.values<ComponentMetadata>(metadata.components)) {
      if (!isComponentValidForPlatform(component, "erb")) {
        continue
      }
      const presets = renderPresets(
        component,
        loadPlayground(this.extensionPath, component.rails),
        "erb"
      )
      presets.forEach((preset, index) => {
        const label = `${component.rails}: ${preset.name}`
        const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet)
        item.detail = "Playbook preset"
        item.filterText = `${component.rails} ${preset.name}`
        item.sortText = `${component.rails}~${String(index).padStart(2, "0")}`
        item.insertText = `${component.rails}", props: { ${preset.rails} }${closing === 2 ? ")" : ""}`
        item.range = new vscode.Range(position, position.translate(0, closing))
        item.documentation = new vscode.MarkdownString(
          `\`\`\`erb\n<%= pb_rails("${component.rails}", props: { ${preset.rails} }) %>\n\`\`\``
        )
        items.push(item)
      })
    }
    return items
  }

  /** One completion per named Playbook preset ("Dropdown: Create tags") that writes the whole tag. */
  private provideReactPresetCompletions(
    metadata: PlaybookMetadata,
    document: vscode.TextDocument
  ): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = []

    for (const [componentName, component] of Object.entries<ComponentMetadata>(
      metadata.components
    )) {
      if (!isComponentValidForPlatform(component, document.languageId)) {
        continue
      }
      const presets = renderPresets(
        component,
        loadPlayground(this.extensionPath, component.rails),
        document.languageId
      )
      presets.forEach((preset, index) => {
        const item = new vscode.CompletionItem(
          `${componentName}: ${preset.name}`,
          vscode.CompletionItemKind.Snippet
        )
        item.detail = "Playbook preset"
        item.filterText = `${componentName} ${preset.name}`
        item.sortText = `${componentName}~${String(index).padStart(2, "0")}`

        const snippet = new vscode.SnippetString()
        snippet.appendText(`${componentName} ${preset.react}`)
        if (component.hasChildren) {
          snippet.appendText(">\n\t").appendTabstop(0).appendText(`\n</${componentName}>`)
        } else {
          snippet.appendText(" />")
        }
        item.insertText = snippet
        item.documentation = new vscode.MarkdownString(
          `\`\`\`tsx\n<${componentName} ${preset.react}${component.hasChildren ? `>…</${componentName}>` : " />"}\n\`\`\``
        )
        items.push(item)
      })
    }
    return items
  }

  private provideRailsComponentCompletions(
    metadata: PlaybookMetadata
  ): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = []

    for (const [componentName, component] of Object.entries<ComponentMetadata>(
      metadata.components
    )) {
      if (!isComponentValidForPlatform(component, "erb")) {
        continue
      }

      const item = new vscode.CompletionItem(
        component.rails,
        vscode.CompletionItemKind.Class
      )
      item.detail = `Playbook ${componentName}`
      item.documentation = new vscode.MarkdownString(component.description)

      item.insertText = component.rails

      if (component.status === "deprecated") {
        item.tags = [vscode.CompletionItemTag.Deprecated]
        item.documentation.appendMarkdown(`\n\n⚠️ Deprecated`)
      }

      if (Object.keys(component.props).length > 0) {
        const propNames = Object.keys(component.props).slice(0, 3).join(", ")
        item.documentation.appendMarkdown(`\n\nProps: ${propNames}...`)
      }

      items.push(item)
    }

    return items.sort((a, b) =>
      a.label.toString().localeCompare(b.label.toString())
    )
  }

  private provideReactComponentCompletions(
    metadata: PlaybookMetadata
  ): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = []

    for (const [componentName, component] of Object.entries<ComponentMetadata>(
      metadata.components
    )) {
      if (!isComponentValidForPlatform(component, "typescriptreact")) {
        continue
      }

      const item = new vscode.CompletionItem(
        componentName,
        vscode.CompletionItemKind.Class
      )
      item.detail = `Playbook ${componentName}`
      item.documentation = new vscode.MarkdownString(component.description)

      if (component.status === "deprecated") {
        item.tags = [vscode.CompletionItemTag.Deprecated]
        item.documentation.appendMarkdown(`\n\n⚠️ Deprecated`)
      }

      const commonProps = Object.entries(component.props).slice(0, 2)
      if (commonProps.length > 0) {
        let snippet = componentName
        commonProps.forEach(([propName], index) => {
          const camelProp = propName.replace(/_([a-z])/g, (_, letter) =>
            letter.toUpperCase()
          )
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

    return items.sort((a, b) =>
      a.label.toString().localeCompare(b.label.toString())
    )
  }

  private provideRailsPropNameCompletions(
    document: vscode.TextDocument,
    position: vscode.Position,
    metadata: PlaybookMetadata
  ): vscode.CompletionItem[] {
    const componentContext = findComponentContext(document, position)
    const formContext = findFormBuilderContext(document, position)

    // A form builder call closer to the cursor than any pb_rails call wins.
    if (
      formContext &&
      (!componentContext ||
        componentContext.type !== "rails" ||
        formContext.line >= componentContext.range.start.line)
    ) {
      const field = findFormBuilderField(
        loadFormBuilderMetadata(this.extensionPath),
        formContext.fieldName
      )
      return field ? this.railsPropItems(field.props, metadata, document, true) : []
    }

    if (!componentContext || componentContext.type !== "rails") {
      return []
    }

    let component: ComponentMetadata | undefined
    for (const [, comp] of Object.entries<ComponentMetadata>(
      metadata.components
    )) {
      if (comp.rails === componentContext.componentName) {
        component = comp
        break
      }
    }

    if (!component) {
      return []
    }

    return this.railsPropItems(
      component.props,
      metadata,
      document,
      component.hasGlobalProps !== false
    )
  }

  /** Completion items for a kit's own props, then (optionally) the global props. */
  private railsPropItems(
    props: Record<string, PropMetadata>,
    metadata: PlaybookMetadata,
    document: vscode.TextDocument,
    includeGlobals: boolean
  ): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = []
    const languageId = document.languageId

    for (const [propName, prop] of Object.entries(props)) {
      if (!isPropValidForPlatform(prop, languageId)) {
        continue
      }
      items.push(this.railsPropItem(propName, prop, languageId, false))
    }

    if (includeGlobals && metadata.globalProps) {
      for (const [propName, prop] of Object.entries<PropMetadata>(metadata.globalProps)) {
        if (props[propName]) {
          continue
        }
        items.push(this.railsPropItem(propName, prop, languageId, true))
      }
    }
    return items
  }

  private railsPropItem(
    propName: string,
    prop: PropMetadata,
    languageId: string,
    isGlobal: boolean
  ): vscode.CompletionItem {
    const type = getPropType(prop, languageId)
    const validValues = getPropValues(prop, languageId)
    const defaultValue = getPropDefault(prop, languageId)

    const item = new vscode.CompletionItem(propName, vscode.CompletionItemKind.Property)
    item.detail = isGlobal ? `${type} (global)` : `${type}${prop.required ? " (required)" : ""}`

    let doc = `Type: \`${type}\`${isGlobal ? " (global prop)" : ""}`
    if (validValues && validValues.length > 0) {
      doc += `\nValues: ${validValues.map(v => `\`${v}\``).join(", ")}`
    }
    if (!isGlobal && defaultValue !== undefined) {
      doc += `\nDefault: \`${defaultValue}\``
    }
    if (prop.deprecated) {
      item.tags = [vscode.CompletionItemTag.Deprecated]
      doc += "\n\n⚠️ Deprecated"
    }
    item.documentation = new vscode.MarkdownString(doc)

    if (validValues && validValues.length > 0) {
      item.insertText = new vscode.SnippetString(`${propName}: "\${1|${validValues.join(",")}|}"`)
    } else if (isBooleanProp(prop, languageId)) {
      item.insertText = new vscode.SnippetString(`${propName}: \${1|true,false|}`)
    } else {
      item.insertText = new vscode.SnippetString(`${propName}: "\${1}"`)
    }

    item.kind = vscode.CompletionItemKind.Snippet
    if (isGlobal) {
      item.sortText = "z" + propName
    }
    return item
  }

  /** `f.` → the builder methods Playbook defines, as snippets. */
  private provideFormMethodCompletions(): vscode.CompletionItem[] {
    return loadFormBuilderMetadata(this.extensionPath).fields.map((field) => {
      const item = new vscode.CompletionItem(field.name, vscode.CompletionItemKind.Method)
      item.detail = `Playbook form field (${field.kit})`
      item.documentation = new vscode.MarkdownString(generateFormMethodDocs(field))
      item.insertText = new vscode.SnippetString(`${field.name} :\${1:attribute}, props: { \${2} }`)
      return item
    })
  }

  private provideReactPropNameCompletions(
    document: vscode.TextDocument,
    position: vscode.Position,
    metadata: PlaybookMetadata
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

    for (const [propName, prop] of Object.entries<PropMetadata>(
      component.props
    )) {
      if (!isPropValidForPlatform(prop, document.languageId)) {
        continue
      }
      const camelProp = propName.replace(/_([a-z])/g, (_, letter: string) =>
        letter.toUpperCase()
      )
      const item = new vscode.CompletionItem(
        camelProp,
        vscode.CompletionItemKind.Property
      )
      item.detail = `${getPropType(prop, document.languageId)}${prop.required ? " (required)" : ""}`

      const values = getPropValues(prop, document.languageId)
      let doc = `Type: \`${getPropType(prop, document.languageId)}\``
      if (values && values.length > 0) {
        doc += `\nValues: ${values.map((v: string) => `\`${v}\``).join(", ")}`
      }
      if (getPropDefault(prop, document.languageId) !== undefined) {
        doc += `\nDefault: \`${getPropDefault(prop, document.languageId)}\``
      }

      item.documentation = new vscode.MarkdownString(doc)

      if (values && values.length > 0) {
        const choices = values.map((v: string) => `"${v}"`).join(",")
        item.insertText = new vscode.SnippetString(
          `${camelProp}={\${1|${choices}|}}`
        )
      } else if (isBooleanProp(prop, document.languageId)) {
        item.insertText = new vscode.SnippetString(
          `${camelProp}={$\{1|true,false|}}`
        )
      } else {
        item.insertText = new vscode.SnippetString(`${camelProp}="\${1}"`)
      }

      item.kind = vscode.CompletionItemKind.Snippet
      items.push(item)
    }

    if (metadata.globalProps && component.hasGlobalProps !== false) {
      for (const [propName, prop] of Object.entries<PropMetadata>(
        metadata.globalProps
      )) {
        const camelProp = propName.replace(/_([a-z])/g, (_, letter: string) =>
          letter.toUpperCase()
        )
        const item = new vscode.CompletionItem(
          camelProp,
          vscode.CompletionItemKind.Property
        )
        item.detail = `${getPropType(prop, document.languageId)} (global)`

        const values = getPropValues(prop, document.languageId)
        let doc = `Type: \`${getPropType(prop, document.languageId)}\` (global prop)`
        if (values && values.length > 0) {
          doc += `\nValues: ${values.map((v: string) => `\`${v}\``).join(", ")}`
        }

        item.documentation = new vscode.MarkdownString(doc)

        if (values && values.length > 0) {
          const choices = values.map((v: string) => `"${v}"`).join(",")
          item.insertText = new vscode.SnippetString(
            `${camelProp}={\${1|${choices}|}}`
          )
        } else if (isBooleanProp(prop, document.languageId)) {
          item.insertText = new vscode.SnippetString(
            `${camelProp}={$\{1|true,false|}}`
          )
        } else {
          item.insertText = new vscode.SnippetString(`${camelProp}="\${1}"`)
        }

        item.kind = vscode.CompletionItemKind.Snippet
        item.sortText = "z" + camelProp
        items.push(item)
      }
    }

    return items
  }

  private providePropValueCompletions(
    document: vscode.TextDocument,
    position: vscode.Position,
    metadata: PlaybookMetadata,
    type: "rails" | "react"
  ): vscode.CompletionItem[] {
    const componentContext = findComponentContext(document, position)
    if (!componentContext) {
      return []
    }

    const component =
      type === "rails"
        ? Object.values<ComponentMetadata>(metadata.components).find(
            c => c.rails === componentContext.componentName
          )
        : metadata.components[componentContext.componentName]

    if (!component) {
      return []
    }

    const line = document.lineAt(position.line).text
    const beforeCursor = line.substring(0, position.character)

    let propName: string | null = null
    let insideString = false

    if (type === "rails") {
      const match = beforeCursor.match(/(\w+):\s*["']?([^",}]*)$/)
      if (match) {
        propName = match[1]
        const afterColon = beforeCursor.substring(
          beforeCursor.lastIndexOf(propName) + propName.length + 1
        )
        insideString = /["']/.test(afterColon)
      }
    } else {
      const match = beforeCursor.match(/(\w+)\s*=\s*["'{]?([^"'}]*)$/)
      if (match) {
        propName = match[1].replace(/([A-Z])/g, "_$1").toLowerCase()
        const afterEquals = beforeCursor.substring(
          beforeCursor.lastIndexOf("=") + 1
        )
        insideString = /["']/.test(afterEquals)
      }
    }

    if (!propName) {
      return []
    }

    const prop =
      component.props[propName] ||
      findGlobalPropForComponent(metadata, component, propName)
    if (!prop) {
      return []
    }

    const items: vscode.CompletionItem[] = []

    // justify/align (and justifyContent/alignItems) point along different axes
    // depending on orientation, so say where each value puts the items.
    const role = axisRole(component, propName)
    const orientation = role
      ? (() => {
          const usage = usageAt(document.getText(), document.languageId, document.offsetAt(position))
          return usage ? resolveOrientation(usage, component) : undefined
        })()
      : undefined

    const validValues = getPropValues(prop, document.languageId)
    if (validValues && validValues.length > 0) {
      for (const value of validValues) {
        const item = new vscode.CompletionItem(
          value,
          vscode.CompletionItemKind.EnumMember
        )
        item.detail = `Valid value for ${propName}`
        if (role) {
          const where = orientation
            ? axisLabel(role, orientation.orientation, value)
            : axisLabelBothWays(role, value)
          if (where) {
            item.detail += ` — ${where}`
          }
        }

        if (insideString) {
          item.insertText = value
        } else {
          item.insertText = `"${value}"`
        }

        if (value === getPropDefault(prop, document.languageId)?.replace(/["']/g, "")) {
          item.detail += " (default)"
          item.sortText = "0" + value
        }

        items.push(item)
      }
    }

    if (isBooleanProp(prop, document.languageId)) {
      const trueItem = new vscode.CompletionItem(
        "true",
        vscode.CompletionItemKind.Value
      )
      trueItem.insertText = "true"
      const falseItem = new vscode.CompletionItem(
        "false",
        vscode.CompletionItemKind.Value
      )
      falseItem.insertText = "false"

      if (getPropDefault(prop, document.languageId) === "true") {
        trueItem.detail = "(default)"
        trueItem.sortText = "0true"
      } else if (getPropDefault(prop, document.languageId) === "false") {
        falseItem.detail = "(default)"
        falseItem.sortText = "0false"
      }

      items.push(trueItem, falseItem)
    }

    return items
  }
}
