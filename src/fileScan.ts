import * as path from "path"
import * as vscode from "vscode"

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".erb": "erb",
  ".rb": "ruby",
  ".html": "html",
  ".tsx": "typescriptreact",
  ".jsx": "javascriptreact",
  ".ts": "typescript",
  ".js": "javascript",
}

export function languageIdForFile(file: string): string | undefined {
  return LANGUAGE_BY_EXTENSION[path.extname(file)]
}

/** Cheap check so we don't analyse files that can't use Playbook. */
export function mightUsePlaybook(text: string): boolean {
  return /pb_rails\(|playbook-ui|<[A-Z][A-Za-z]*[\s/>]/.test(text)
}

/**
 * Reads each file once and hands its text to `analyze`, collecting what it
 * returns. Reports progress and stops promptly when cancelled.
 */
export async function scanFiles<T>(
  files: vscode.Uri[],
  analyze: (text: string, languageId: string, uri: vscode.Uri) => T[] | undefined,
  progress: vscode.Progress<{ message?: string }>,
  token: vscode.CancellationToken
): Promise<{ results: T[]; filesScanned: number }> {
  const results: T[] = []
  const decoder = new TextDecoder()
  let scanned = 0

  for (const uri of files) {
    if (token.isCancellationRequested) {
      break
    }
    const languageId = languageIdForFile(uri.fsPath)
    if (!languageId) {
      continue
    }
    let text: string
    try {
      text = decoder.decode(await vscode.workspace.fs.readFile(uri))
    } catch {
      continue
    }
    const found = analyze(text, languageId, uri)
    if (found === undefined) {
      continue // not a file this sweep reads
    }
    scanned++
    results.push(...found)
    if (scanned % 100 === 0) {
      progress.report({ message: `${scanned} files, ${results.length} found` })
    }
  }
  return { results, filesScanned: scanned }
}
