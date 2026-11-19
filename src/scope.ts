import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"

/**
 * Which files a workspace sweep should read. Scanning a whole monorepo can take
 * minutes, so sweeps are scoped: a file, a folder, or (explicitly) everything.
 */
export type SweepScope =
  | { kind: "file"; uri: vscode.Uri; label: string }
  | { kind: "folder"; uri: vscode.Uri; label: string }
  | { kind: "workspace"; label: string }

/** Pulls a filesystem path out of whatever a command was given. */
export function pathFromArgument(arg: unknown): string | undefined {
  if (typeof arg === "string") {
    return arg
  }
  if (Array.isArray(arg)) {
    return pathFromArgument(arg[0])
  }
  if (arg && typeof arg === "object") {
    const candidate = arg as { fsPath?: unknown; path?: unknown; scope?: unknown }
    if (typeof candidate.fsPath === "string") {
      return candidate.fsPath // a vscode.Uri (Explorer context menu)
    }
    if (typeof candidate.path === "string") {
      return candidate.path // { path: "components/accounting" }
    }
  }
  return undefined
}

/**
 * Turns a command argument into a scope without asking anything:
 * a Uri or path (absolute, or relative to a workspace folder) of a file or
 * folder, or `{ scope: "workspace" }`. Undefined means "ask the user".
 */
export function scopeFromArgument(arg: unknown, roots: string[]): SweepScope | undefined {
  if (arg && typeof arg === "object" && (arg as { scope?: unknown }).scope === "workspace") {
    return { kind: "workspace", label: "the whole workspace" }
  }
  const given = pathFromArgument(arg)
  if (!given) {
    return undefined
  }
  const candidates = path.isAbsolute(given) ? [given] : roots.map((root) => path.join(root, given))
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate)
      const label = roots.length ? relativeLabel(candidate, roots) : candidate
      return stat.isDirectory()
        ? { kind: "folder", uri: vscode.Uri.file(candidate), label }
        : { kind: "file", uri: vscode.Uri.file(candidate), label }
    } catch {
      // try the next root
    }
  }
  return undefined
}

function relativeLabel(target: string, roots: string[]): string {
  for (const root of roots) {
    const relative = path.relative(root, target)
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      return relative
    }
  }
  return target
}

interface ScopeItem extends vscode.QuickPickItem {
  scope?: SweepScope
  choose?: boolean
}

/**
 * The scope for a sweep: from the command's argument if it names one, otherwise
 * a picker that offers the active file, its folder, a folder of your choosing, or
 * the whole workspace (last, since it is the slow one).
 */
export async function chooseScope(arg?: unknown, title = "Scan which files?"): Promise<SweepScope | undefined> {
  const roots = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath)
  const given = scopeFromArgument(arg, roots)
  if (given) {
    return given
  }

  const items: ScopeItem[] = []
  const active = vscode.window.activeTextEditor?.document.uri
  if (active && active.scheme === "file") {
    const folder = path.dirname(active.fsPath)
    items.push({
      label: "$(folder) This file's folder",
      description: relativeLabel(folder, roots),
      scope: { kind: "folder", uri: vscode.Uri.file(folder), label: relativeLabel(folder, roots) },
    })
    items.push({
      label: "$(file) This file",
      description: path.basename(active.fsPath),
      scope: { kind: "file", uri: active, label: path.basename(active.fsPath) },
    })
  }
  items.push({ label: "$(folder-opened) Choose a folder…", choose: true })
  items.push({
    label: "$(root-folder) The whole workspace",
    description: "can be slow in a large repo",
    scope: { kind: "workspace", label: "the whole workspace" },
  })

  const picked = await vscode.window.showQuickPick(items, { title, placeHolder: "Pick a scope" })
  if (!picked) {
    return undefined
  }
  if (picked.choose) {
    const [uri] =
      (await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
        openLabel: "Scan this folder",
      })) ?? []
    return uri ? { kind: "folder", uri, label: relativeLabel(uri.fsPath, roots) } : undefined
  }
  return picked.scope
}

const EXCLUDE_GLOB = "**/{node_modules,vendor,tmp,log,dist,build,public,coverage,.git,.yarn}/**"
const MAX_FILES = 20000

/** The files in a scope matching `glob` (a file scope is just that file). */
export async function filesInScope(scope: SweepScope, glob: string): Promise<vscode.Uri[]> {
  if (scope.kind === "file") {
    return [scope.uri]
  }
  const pattern = scope.kind === "folder" ? new vscode.RelativePattern(scope.uri, glob) : glob
  return vscode.workspace.findFiles(pattern, EXCLUDE_GLOB, MAX_FILES)
}
