import * as vscode from "vscode";

/**
 * Helper to create a test document from text content
 */
export async function createTestDocument(
  languageId: string,
  content: string
): Promise<vscode.TextDocument> {
  const uri = vscode.Uri.parse(`untitled:test-${Date.now()}.${languageId}`);
  const document = await vscode.workspace.openTextDocument(uri);
  const edit = new vscode.WorkspaceEdit();
  edit.insert(uri, new vscode.Position(0, 0), content);
  await vscode.workspace.applyEdit(edit);
  return document;
}

/**
 * Helper to get items from completion result (handles both array and CompletionList)
 */
export function getCompletionItems(
  completions: vscode.CompletionList | vscode.CompletionItem[] | undefined | null
): vscode.CompletionItem[] {
  if (!completions) {
    return [];
  }
  return Array.isArray(completions) ? completions : completions.items;
}

/**
 * Helper to create a cancellation token for tests
 */
export function createCancellationToken(): vscode.CancellationToken {
  return new vscode.CancellationTokenSource().token;
}

/**
 * Helper to create completion context for tests
 */
export function createCompletionContext(triggerCharacter?: string): vscode.CompletionContext {
  return {
    triggerKind: vscode.CompletionTriggerKind.Invoke,
    triggerCharacter
  };
}
