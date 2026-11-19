import * as vscode from "vscode"
import { PlaybookMetadata, loadMetadata } from "./metadata"
import { enabled } from "./settings"

export interface InlineAnnotation {
  /** Offset the hint is shown at (just after a value). */
  offset: number
  /** Faint text after the value, e.g. "24px". */
  label?: string
  /** A CSS color to show as a small box, e.g. "#4B546B". */
  swatch?: string
}

export type Annotator = (
  text: string,
  languageId: string,
  metadata: PlaybookMetadata
) => InlineAnnotation[]

function renderOptionsFor(a: InlineAnnotation): vscode.DecorationInstanceRenderOptions {
  if (a.swatch) {
    // A square that scales with the font. VS Code makes the attachment inline-block
    // when width/height are set, and an inline-block with no content sits on the
    // text baseline, so it can't push the lines apart. 0.85em stays under the line height.
    return {
      after: {
        contentText: "",
        backgroundColor: a.swatch,
        border: "1px solid rgba(128,128,128,0.55)",
        margin: "0 0 0 0.5em",
        width: "0.85em",
        height: "0.85em",
      },
    }
  }
  return {
    after: {
      contentText: ` ${a.label ?? ""}`,
      color: new vscode.ThemeColor("editorCodeLens.foreground"),
      fontStyle: "italic",
    },
  }
}

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
    private readonly annotate: Annotator,
    /** Further switches that must also be on (e.g. "flexAxis.enabled"). */
    private readonly gates: string[] = []
  ) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.refreshAll()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.refreshAll()),
      vscode.workspace.onDidChangeTextDocument((e) => this.schedule(e.document)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("playbook")) {
          this.refreshAll()
        }
      })
    )
    this.refreshAll()
  }

  isEnabled(): boolean {
    return enabled(this.setting, ...this.gates)
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
        renderOptions: renderOptionsFor(a),
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
