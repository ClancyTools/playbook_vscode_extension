import * as vscode from "vscode"
import { PlaybookHoverProvider } from "./hoverProvider"
import { PlaybookDefinitionProvider } from "./definitionProvider"
import { PlaybookDiagnostics } from "./diagnostics"
import { PlaybookCompletionProvider } from "./completionProvider"

/**
 * Extension activation entry point
 * Called when one of the activation events defined in package.json is triggered
 */
export function activate(context: vscode.ExtensionContext) {
  console.log("Playbook UI extension is now active")

  // Log supported languages
  const supportedLanguages = [
    "ruby",
    "erb",
    "javascript",
    "javascriptreact",
    "typescript",
    "typescriptreact"
  ]
  console.log("Playbook UI: Activated for languages:", supportedLanguages)

  // Register Hover Provider
  const hoverProvider = new PlaybookHoverProvider(context.extensionPath)
  const hoverDisposable = vscode.languages.registerHoverProvider(supportedLanguages, hoverProvider)
  context.subscriptions.push(hoverDisposable)
  console.log("✓ Hover provider registered")

  // Register Definition Provider (Go to Definition)
  const definitionProvider = new PlaybookDefinitionProvider(context.extensionPath)
  const definitionDisposable = vscode.languages.registerDefinitionProvider(
    supportedLanguages,
    definitionProvider
  )
  context.subscriptions.push(definitionDisposable)
  console.log("✓ Definition provider registered")

  // Register Completion Provider (Autocomplete)
  const completionProvider = new PlaybookCompletionProvider(context.extensionPath)
  const completionDisposable = vscode.languages.registerCompletionItemProvider(
    supportedLanguages,
    completionProvider,
    '"',
    "'",
    "<",
    " ",
    ":",
    "=" // Trigger characters
  )
  context.subscriptions.push(completionDisposable)
  console.log("✓ Completion provider registered")

  // Register Diagnostics (Prop Validation)
  const diagnostics = new PlaybookDiagnostics(context.extensionPath)
  context.subscriptions.push(diagnostics)

  // Update diagnostics on document change
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      diagnostics.updateDiagnostics(event.document)
    })
  )

  // Update diagnostics on document open
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      diagnostics.updateDiagnostics(document)
    })
  )

  // Update diagnostics for all open documents
  vscode.workspace.textDocuments.forEach((document) => {
    diagnostics.updateDiagnostics(document)
  })

  console.log("✓ Prop validation diagnostics registered")

  console.log(
    "✨ Playbook UI extension fully activated with snippets, autocomplete, hover, validation, and definition support!"
  )
}

/**
 * Extension deactivation
 * Called when the extension is deactivated
 */
export function deactivate() {
  console.log("Playbook UI extension is now deactivated")
}
