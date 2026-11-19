import * as vscode from "vscode"
import { describeHit, familyById, scanBootstrap } from "./bootstrapCatalog"
import { LocatedBootstrap, buildBootstrapReport, summarizeBootstrap } from "./bootstrapReport"
import { scanFiles } from "./fileScan"
import { SweepScope, chooseScope, filesInScope } from "./scope"
import { lineColumn } from "./textPosition"

const FILE_GLOB = "**/*.{erb,html,tsx,jsx}"
const MAX_LISTED = 500

export async function sweepBootstrap(
  scope: SweepScope,
  progress: vscode.Progress<{ message?: string }>,
  token: vscode.CancellationToken
): Promise<{ results: Array<LocatedBootstrap & { uri: vscode.Uri }>; filesScanned: number }> {
  const files = await filesInScope(scope, FILE_GLOB)
  return scanFiles(
    files,
    (text, _languageId, uri) =>
      scanBootstrap(text).map((hit) => ({
        ...hit,
        ...lineColumn(text, hit.start),
        file: vscode.workspace.asRelativePath(uri, false).split("\\").join("/"),
        uri,
      })),
    progress,
    token
  )
}

interface BootstrapPickItem extends vscode.QuickPickItem {
  hit?: LocatedBootstrap & { uri: vscode.Uri }
  report?: boolean
}

/**
 * Find Bootstrap markup that could become Playbook. `arg` may be a file or folder
 * (a Uri from the Explorer, a path, or `{ path }`); with none you are asked, so a
 * large repo isn't scanned unless you choose that.
 */
export async function findBootstrapMarkup(arg?: unknown): Promise<void> {
  const scope = await chooseScope(arg, "Find Bootstrap markup in…")
  if (!scope) {
    return
  }
  const outcome = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Playbook: scanning ${scope.label} for Bootstrap markup`,
      cancellable: true,
    },
    (progress, token) => sweepBootstrap(scope, progress, token)
  )

  if (outcome.results.length === 0) {
    vscode.window.showInformationMessage(
      `No Bootstrap classes found in ${scope.label} (${outcome.filesScanned} files).`
    )
    return
  }

  const items: BootstrapPickItem[] = [
    { label: "$(book) Open summary report", description: "counts by kind, folder and file", report: true },
  ]
  let listed = 0
  for (const family of summarizeBootstrap(outcome.results).families) {
    items.push({ label: family.label, description: `${family.count}`, kind: vscode.QuickPickItemKind.Separator })
    for (const hit of outcome.results.filter((r) => r.family === family.id)) {
      if (listed++ >= MAX_LISTED) {
        break
      }
      items.push({
        label: `$(code) ${hit.file}:${hit.line + 1}`,
        description: describeHit(hit),
        hit,
      })
    }
  }

  const more = outcome.results.length > MAX_LISTED ? ` (listing the first ${MAX_LISTED})` : ""
  const picked = await vscode.window.showQuickPick(items, {
    title: `${outcome.results.length} Bootstrap class attributes in ${scope.label} (${outcome.filesScanned} files)${more}`,
    placeHolder: "Pick one to open it, or open the summary report",
    matchOnDescription: true,
  })
  if (picked?.report) {
    const content = buildBootstrapReport(outcome.results, scope.label, outcome.filesScanned)
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: "markdown", content }))
  } else if (picked?.hit) {
    const position = new vscode.Position(picked.hit.line, picked.hit.column)
    await vscode.window.showTextDocument(picked.hit.uri, { selection: new vscode.Range(position, position) })
  }
}

export { familyById }
