import * as assert from "assert";
import * as vscode from "vscode";

/**
 * Opens an in-memory document with the given language id.
 *
 * Do not build documents from an `untitled:` URI plus a file extension: VS Code
 * resolves the language from the extension, and unregistered ones (`.erb`,
 * `.typescriptreact`) silently become `plaintext`, which the providers skip, so
 * the test would pass without exercising anything.
 */
export async function createTestDocument(
  languageId: string,
  content: string
): Promise<vscode.TextDocument> {
  const document = await vscode.workspace.openTextDocument({ language: languageId, content });
  assert.strictEqual(
    document.languageId,
    languageId,
    `test document should have language "${languageId}"`
  );
  return document;
}

export function getCompletionItems(
  completions: vscode.CompletionList | vscode.CompletionItem[] | undefined | null
): vscode.CompletionItem[] {
  if (!completions) {
    return [];
  }
  return Array.isArray(completions) ? completions : completions.items;
}

export function createCancellationToken(): vscode.CancellationToken {
  return new vscode.CancellationTokenSource().token;
}

export function createCompletionContext(triggerCharacter?: string): vscode.CompletionContext {
  return {
    triggerKind: vscode.CompletionTriggerKind.Invoke,
    triggerCharacter
  };
}

/**
 * Asserts the exact diagnostic messages reported for a document. Pass an empty
 * array to assert the document is clean.
 */
export function assertDiagnosticMessages(
  diagnostics: { getDiagnostics(uri: vscode.Uri): readonly vscode.Diagnostic[] },
  document: vscode.TextDocument,
  expected: string[],
  message: string
): void {
  assert.deepStrictEqual(
    diagnostics.getDiagnostics(document.uri).map((d) => d.message),
    expected,
    message
  );
}
