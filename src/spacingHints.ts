import * as vscode from "vscode"
import { PlaybookMetadata, camelToSnake, loadMetadata } from "./metadata"
import { resolveComponent, scanUsages } from "./usageRules"
import { ScannedUsage } from "./usageScanner"

export interface SpacingAnnotation {
  /** Offset just after the closing quote of the token. */
  offset: number
  /** e.g. "24px" */
  label: string
}

/**
 * Spacing props are the global props that take the shared spacing scale
 * (margin*, padding*): enum props that support responsive objects and list
 * the scale's steps.
 */
export function spacingPropNames(metadata: PlaybookMetadata): Set<string> {
  const names = new Set<string>()
  for (const [name, prop] of Object.entries(metadata.globalProps || {})) {
    if (prop.responsive && prop.values?.includes("sm") && prop.values.includes("md")) {
      names.add(name)
    }
  }
  return names
}

const TOKEN_IN_VALUE = /(["'])([a-z]+)\1/g

/**
 * Pixel hints for spacing tokens: `padding="md"` → `24px`. Also reads tokens
 * inside responsive objects (`{{ default: "sm", md: "lg" }}`).
 */
export function spacingAnnotations(
  text: string,
  languageId: string,
  metadata: PlaybookMetadata
): SpacingAnnotation[] {
  const tokens = metadata.spacingTokens
  if (!tokens) {
    return []
  }
  const spacingProps = spacingPropNames(metadata)
  const annotations: SpacingAnnotation[] = []

  for (const usage of scanUsages(text, languageId)) {
    if (!appliesSpacing(usage, metadata)) {
      continue
    }
    for (const prop of usage.props) {
      const snake = usage.platform === "react" ? camelToSnake(prop.name) : prop.name
      if (!spacingProps.has(snake) || prop.valueText === undefined || prop.valueStart === undefined) {
        continue
      }
      TOKEN_IN_VALUE.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = TOKEN_IN_VALUE.exec(prop.valueText)) !== null) {
        const px = tokens[match[2]]
        if (px) {
          annotations.push({ offset: prop.valueStart + match.index + match[0].length, label: px })
        }
      }
    }
  }
  return annotations
}

function appliesSpacing(usage: ScannedUsage, metadata: PlaybookMetadata): boolean {
  const component = resolveComponent(metadata, usage)
  return !!component && component.hasGlobalProps !== false
}

/** Shows spacing pixel hints after tokens in open Playbook files. */
export class SpacingHints implements vscode.Disposable {
  private readonly decoration = vscode.window.createTextEditorDecorationType({})
  private readonly disposables: vscode.Disposable[] = []
  private timer: NodeJS.Timeout | undefined

  constructor(private readonly extensionPath: string) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.refreshAll()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.refreshAll()),
      vscode.workspace.onDidChangeTextDocument((e) => this.schedule(e.document)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("playbook.spacingHints")) {
          this.refreshAll()
        }
      })
    )
    this.refreshAll()
  }

  static enabled(): boolean {
    return vscode.workspace.getConfiguration("playbook").get<boolean>("spacingHints", true)
  }

  /** Decorations for a document; empty when the feature is off. */
  compute(document: vscode.TextDocument): vscode.DecorationOptions[] {
    if (!SpacingHints.enabled()) {
      return []
    }
    const metadata = loadMetadata(this.extensionPath)
    return spacingAnnotations(document.getText(), document.languageId, metadata).map((a) => {
      const position = document.positionAt(a.offset)
      return {
        range: new vscode.Range(position, position),
        renderOptions: {
          after: {
            contentText: ` ${a.label}`,
            color: new vscode.ThemeColor("editorCodeLens.foreground"),
            fontStyle: "italic",
          },
        },
      }
    })
  }

  private schedule(document: vscode.TextDocument): void {
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = setTimeout(() => {
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document === document) {
          this.apply(editor)
        }
      }
    }, 200)
  }

  refreshAll(): void {
    vscode.window.visibleTextEditors.forEach((editor) => this.apply(editor))
  }

  private apply(editor: vscode.TextEditor): void {
    editor.setDecorations(this.decoration, this.compute(editor.document))
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.decoration.dispose()
    this.disposables.forEach((d) => d.dispose())
  }
}
