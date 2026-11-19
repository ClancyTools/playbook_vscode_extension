import * as path from "path"
import * as vscode from "vscode"
import { DeprecatedUsage, summarize, sweepText } from "./deprecationSweep"
import { loadMetadata } from "./metadata"

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".erb": "erb",
  ".rb": "ruby",
  ".tsx": "typescriptreact",
  ".jsx": "javascriptreact",
  ".ts": "typescript",
  ".js": "javascript",
}

const FILE_GLOB = "**/*.{erb,rb,tsx,jsx,ts,js}"
const EXCLUDE_GLOB =
  "**/{node_modules,vendor,tmp,log,dist,build,public,coverage,.git,.yarn}/**"
const MAX_FILES = 20000
const MAX_LISTED = 500

export function languageIdForFile(file: string): string | undefined {
  return LANGUAGE_BY_EXTENSION[path.extname(file)]
}

/** Cheap check so we don't scan files that can't use Playbook. */
export function mightUsePlaybook(text: string): boolean {
  return /pb_rails\(|playbook-ui|<[A-Z][A-Za-z]*[\s/>]/.test(text)
}

export interface LocatedDeprecation extends DeprecatedUsage {
  uri: vscode.Uri
}

export async function sweepWorkspace(
  extensionPath: string,
  progress: vscode.Progress<{ message?: string }>,
  token: vscode.CancellationToken
): Promise<{ results: LocatedDeprecation[]; filesScanned: number }> {
  const metadata = loadMetadata(extensionPath)
  const files = await vscode.workspace.findFiles(FILE_GLOB, EXCLUDE_GLOB, MAX_FILES)
  const results: LocatedDeprecation[] = []
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
    if (!mightUsePlaybook(text)) {
      continue
    }
    scanned++
    for (const usage of sweepText(text, languageId, metadata)) {
      results.push({ ...usage, uri })
    }
    if (scanned % 100 === 0) {
      progress.report({ message: `${scanned} files, ${results.length} deprecated usages` })
    }
  }
  return { results, filesScanned: scanned }
}

interface UsagePickItem extends vscode.QuickPickItem {
  usage?: LocatedDeprecation
}

/** Scan the workspace and list every deprecated Playbook kit/prop, grouped, jump-to-location. */
export async function findDeprecatedUsages(extensionPath: string): Promise<void> {
  const outcome = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Playbook: scanning for deprecated usages",
      cancellable: true,
    },
    (progress, token) => sweepWorkspace(extensionPath, progress, token)
  )

  if (outcome.results.length === 0) {
    vscode.window.showInformationMessage(
      `No deprecated Playbook usages found in ${outcome.filesScanned} files.`
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
    title: `${outcome.results.length} deprecated usages in ${outcome.filesScanned} files${more}`,
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
