import * as vscode from "vscode"
import { readAiJson } from "./aiData"
import {
  CatalogCategory,
  CatalogKit,
  KitAction,
  buildCatalog,
  filterCatalog,
  kitActions,
} from "./kitCatalog"
import {
  ComponentMetadata,
  Platform,
  docsUrlFor,
  findComponentByRailsName,
  loadMetadata,
} from "./metadata"
import { loadPlayground } from "./playgrounds"

const RAILS_LANGUAGES = ["ruby", "erb", "html.erb", "html"]
const REACT_LANGUAGES = ["javascript", "javascriptreact", "typescript", "typescriptreact"]

/** The platform to write for, from the file being edited; undefined if it is neither. */
export function platformForEditor(editor: vscode.TextEditor | undefined): Platform | undefined {
  const id = editor?.document.languageId
  if (!id) {
    return undefined
  }
  if (RAILS_LANGUAGES.includes(id)) {
    return "rails"
  }
  return REACT_LANGUAGES.includes(id) ? "react" : undefined
}

function categoryDescriptions(extensionPath: string): Record<string, string> {
  const index = readAiJson<{ categories?: Record<string, { description?: string }> }>(
    extensionPath,
    "visual-index.json"
  )
  return Object.fromEntries(
    Object.entries(index?.categories || {}).flatMap(([id, c]) =>
      c.description ? [[id, c.description]] : []
    )
  )
}

export function catalogFor(extensionPath: string, platform?: Platform): CatalogCategory[] {
  return buildCatalog(loadMetadata(extensionPath), categoryDescriptions(extensionPath), platform)
}

interface KitPickItem extends vscode.QuickPickItem {
  kit?: CatalogKit
}

/** Pick any kit, grouped by category, then choose what to do with it. */
export async function browseKits(extensionPath: string): Promise<void> {
  const editor = vscode.window.activeTextEditor
  const platform = platformForEditor(editor)
  const items: KitPickItem[] = []

  for (const category of catalogFor(extensionPath, platform)) {
    items.push({ label: category.label, kind: vscode.QuickPickItemKind.Separator })
    for (const kit of category.kits) {
      items.push({
        label: `$(symbol-class) ${platform === "rails" ? kit.rails : kit.react}`,
        description: kit.status === "deprecated" ? "deprecated" : platform === "rails" ? kit.react : kit.rails,
        detail: kit.description,
        kit,
      })
    }
  }

  const picked = await vscode.window.showQuickPick(items, {
    title: platform ? `Playbook kits (${platform === "rails" ? "Rails" : "React"})` : "Playbook kits",
    placeHolder: "Search by name or by what it looks like (e.g. \"sidebar\", \"progress\", \"tag\")",
    matchOnDescription: true,
    matchOnDetail: true,
  })
  if (picked?.kit) {
    await runKitActions(extensionPath, picked.kit.rails, editor)
  }
}

interface ActionPickItem extends vscode.QuickPickItem {
  action: KitAction
}

/** Insert an example/preset into the editor, copy it, or open the docs. */
export async function runKitActions(
  extensionPath: string,
  railsName: string,
  editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor
): Promise<void> {
  const component = findComponentByRailsName(loadMetadata(extensionPath), railsName)
  if (!component) {
    return
  }
  const platform = platformForEditor(editor)
  const actions = kitActions(component, loadPlayground(extensionPath, component.rails), platform)

  const picked = await vscode.window.showQuickPick<ActionPickItem>(
    actions.map((action) => ({
      label: action.label,
      description: action.description,
      detail: action.text?.split("\n")[0],
      action,
    })),
    { title: `${component.react} / ${component.rails}`, matchOnDetail: true }
  )
  if (picked) {
    await performAction(component, picked.action, platform, editor)
  }
}

async function performAction(
  component: ComponentMetadata,
  action: KitAction,
  platform: Platform | undefined,
  editor: vscode.TextEditor | undefined
): Promise<void> {
  if (action.kind === "docs") {
    const target = platform ?? (component.platforms?.[0] as Platform | undefined) ?? "react"
    await vscode.env.openExternal(vscode.Uri.parse(docsUrlFor(component, target)))
    return
  }
  if (!action.text) {
    return
  }
  if (action.kind === "copy" || !editor) {
    await vscode.env.clipboard.writeText(action.text)
    vscode.window.showInformationMessage(`Copied ${component.react} example to the clipboard.`)
    return
  }
  // appendText escapes $ and } so code is inserted literally, not as a snippet.
  await editor.insertSnippet(new vscode.SnippetString().appendText(action.text))
}

type KitTreeNode =
  | { type: "category"; category: CatalogCategory }
  | { type: "kit"; kit: CatalogKit }

/** Explorer view listing every kit by category; click a kit for its actions. */
export class KitTreeProvider implements vscode.TreeDataProvider<KitTreeNode> {
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.changed.event

  constructor(private readonly extensionPath: string) {}

  refresh(): void {
    this.changed.fire()
  }

  getTreeItem(node: KitTreeNode): vscode.TreeItem {
    if (node.type === "category") {
      const item = new vscode.TreeItem(
        node.category.label,
        vscode.TreeItemCollapsibleState.Collapsed
      )
      item.description = String(node.category.kits.length)
      item.tooltip = node.category.description
      item.contextValue = "playbookCategory"
      return item
    }
    const { kit } = node
    const item = new vscode.TreeItem(kit.react, vscode.TreeItemCollapsibleState.None)
    item.description = kit.status === "deprecated" ? "deprecated" : kit.rails
    item.tooltip = new vscode.MarkdownString(`**${kit.react}** (\`${kit.rails}\`)\n\n${kit.description}`)
    item.iconPath = new vscode.ThemeIcon("symbol-class")
    item.contextValue = "playbookKit"
    item.command = {
      command: "playbook.kitActions",
      title: "Kit actions",
      arguments: [kit.rails],
    }
    return item
  }

  getChildren(node?: KitTreeNode): KitTreeNode[] {
    if (!node) {
      return filterCatalog(catalogFor(this.extensionPath), "").map((category) => ({
        type: "category" as const,
        category,
      }))
    }
    return node.type === "category"
      ? node.category.kits.map((kit) => ({ type: "kit" as const, kit }))
      : []
  }
}
