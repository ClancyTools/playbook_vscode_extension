import * as vscode from "vscode"
import { loadMetadata } from "./metadata"
import { enabled } from "./settings"

const SUPPORTED = [
  "ruby",
  "erb",
  "html.erb",
  "html",
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
]

/** Shows which Playbook version the docs and checks come from. */
export class PlaybookStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90)
  private readonly subscription: vscode.Disposable

  constructor(private readonly extensionPath: string) {
    this.item.command = "playbook.showInfo"
    this.subscription = vscode.window.onDidChangeActiveTextEditor(() => this.update())
    this.update()
  }

  /** Text and tooltip for the current metadata; exposed for testing. */
  describe(): { text: string; tooltip: string } {
    const metadata = loadMetadata(this.extensionPath)
    const version = metadata.version ? `v${metadata.version}` : "unknown version"
    const source = metadata.source
    if (source?.bundled) {
      return {
        text: `$(book) Playbook ${version} (bundled)`,
        tooltip:
          `Using the Playbook metadata bundled with the extension (${version}).\n` +
          "Install playbook-ui in this workspace to get docs for the version your app uses.",
      }
    }
    return {
      text: `$(book) Playbook ${version}`,
      tooltip: `Using playbook-ui ${version} from ${source?.dir ?? "the workspace"}`,
    }
  }

  update(): void {
    const editor = vscode.window.activeTextEditor
    if (!enabled("statusBar.enabled") || !editor || !SUPPORTED.includes(editor.document.languageId)) {
      this.item.hide()
      return
    }
    const { text, tooltip } = this.describe()
    this.item.text = text
    this.item.tooltip = tooltip
    this.item.show()
  }

  dispose(): void {
    this.subscription.dispose()
    this.item.dispose()
  }
}
