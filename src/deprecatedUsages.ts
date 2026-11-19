import * as vscode from "vscode"
import { DeprecatedUsage, summarize, sweepText } from "./deprecationSweep"
import { mightUsePlaybook, scanFiles } from "./fileScan"
import { loadMetadata } from "./metadata"
import { SweepScope, chooseScope, filesInScope } from "./scope"

export { languageIdForFile, mightUsePlaybook } from "./fileScan"

const FILE_GLOB = "**/*.{erb,rb,tsx,jsx,ts,js}"
const MAX_LISTED = 500

export interface LocatedDeprecation extends DeprecatedUsage {
  uri: vscode.Uri
}

export async function sweepScope(
  extensionPath: string,
  scope: SweepScope,
  progress: vscode.Progress<{ message?: string }>,
  token: vscode.CancellationToken
): Promise<{ results: LocatedDeprecation[]; filesScanned: number }> {
  const metadata = loadMetadata(extensionPath)
  const files = await filesInScope(scope, FILE_GLOB)
  return scanFiles<LocatedDeprecation>(
    files,
    (text, languageId, uri) =>
      mightUsePlaybook(text)
        ? sweepText(text, languageId, metadata).map((usage) => ({ ...usage, uri }))
        : undefined,
    progress,
    token
  )
}

interface UsagePickItem extends vscode.QuickPickItem {
  usage?: LocatedDeprecation
}

/**
 * Scan for deprecated Playbook kits/props and list them, grouped and jump-to-
 * location. `arg` may be a file or folder (a Uri from the Explorer, a path, or
 * `{ path }`) to scan just that; with none, you are asked.
 */
export async function findDeprecatedUsages(extensionPath: string, arg?: unknown): Promise<void> {
  const scope = await chooseScope(arg, "Find deprecated Playbook usages in…")
  if (!scope) {
    return
  }
  const outcome = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Playbook: scanning ${scope.label} for deprecated usages`,
      cancellable: true,
    },
    (progress, token) => sweepScope(extensionPath, scope, progress, token)
  )

  if (outcome.results.length === 0) {
    vscode.window.showInformationMessage(
      `No deprecated Playbook usages found in ${scope.label} (${outcome.filesScanned} files).`
    )
    return
  }

  const items: UsagePickItem[] = []
  let listed = 0
  for (const group of summarize(outcome.results)) {
    const hint = group.replacement ? ` → ${group.replacement}` : ""
    items.push({ label: `${group.label}${hint}`, description: `${group.count}`, kind: vscode.QuickPickItemKind.Separator })
    for (const usage of outcome.results) {
      const label = usage.prop ? `${usage.kit} · ${usage.prop}` : `${usage.kit} (kit)`
      if (label !== group.label || listed >= MAX_LISTED) {
        continue
      }
      listed++
      items.push({
        label: `$(warning) ${vscode.workspace.asRelativePath(usage.uri)}:${usage.line + 1}`,
        description: usage.message,
        usage,
      })
    }
  }

  const more = outcome.results.length > MAX_LISTED ? ` (showing first ${MAX_LISTED})` : ""
  const picked = await vscode.window.showQuickPick(items, {
    title: `${outcome.results.length} deprecated usages in ${scope.label} (${outcome.filesScanned} files)${more}`,
    placeHolder: "Pick one to open it",
    matchOnDescription: true,
  })
  if (picked?.usage) {
    const position = new vscode.Position(picked.usage.line, picked.usage.column)
    await vscode.window.showTextDocument(picked.usage.uri, {
      selection: new vscode.Range(position, position),
    })
  }
}
