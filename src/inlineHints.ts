import * as vscode from "vscode"
import { PlaybookMetadata, loadMetadata } from "./metadata"

export interface InlineAnnotation {
  /** Offset the label is shown at (just after a value). */
  offset: number
  label: string
}

export type Annotator = (
  text: string,
  languageId: string,
  metadata: PlaybookMetadata
) => InlineAnnotation[]

/**
 * Shows faint text after values in open files (the pixel value after a spacing
 * token, the axis a flex value points along). Each instance is driven by one
 * annotator and one `playbook.<setting>` boolean.
 */
export class InlineHints implements vscode.Disposable {
  private readonly decoration = vscode.window.createTextEditorDecorationType({})
  private readonly disposables: vscode.Disposable[] = []
  private timer: NodeJS.Timeout | undefined

  constructor(
    private readonly extensionPath: string,
    private readonly setting: string,
    private readonly annotate: Annotator
  ) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.refreshAll()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.refreshAll()),
      vscode.workspace.onDidChangeTextDocument((e) => this.schedule(e.document)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(`playbook.${this.setting}`)) {
          this.refreshAll()
        }
      })
    )
    this.refreshAll()
  }

  isEnabled(): boolean {
    return vscode.workspace.getConfiguration("playbook").get<boolean>(this.setting, true)
  }

  /** Decorations for a document; empty when the setting is off. */
  compute(document: vscode.TextDocument): vscode.DecorationOptions[] {
    if (!this.isEnabled()) {
      return []
    }
    const metadata = loadMetadata(this.extensionPath)
    return this.annotate(document.getText(), document.languageId, metadata).map((a) => {
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
