import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"

/**
 * Locates and reads Playbook's published AI metadata (`playbook-ui/dist/ai`).
 *
 * Preference order:
 *   1. The newest `playbook-ui` installed in the open workspace(s) — so hover
 *      docs, completions and diagnostics match the version the app really uses.
 *   2. The copy bundled with this extension (`data/ai`, see `npm run sync:data`).
 */

export interface AiSource {
  /** Directory containing index.json, all-schemas.json, playgrounds/, ... */
  dir: string
  /** `version` from the metadata's index.json, when readable. */
  version?: string
  bundled: boolean
}

const AI_SUBPATH = path.join("node_modules", "playbook-ui", "dist", "ai")

/** Monorepo folders whose children commonly hold their own node_modules. */
const MONOREPO_PARENTS = ["components", "packages", "apps"]

function hasAiMetadata(dir: string): boolean {
  return fs.existsSync(path.join(dir, "all-schemas.json"))
}

function readVersion(dir: string): string | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf-8")).version
  } catch {
    return undefined
  }
}

/**
 * Compares two Playbook versions such as "18.4.0-rc.4" and "18.3.0".
 * Release candidates sort below the release they lead up to.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.split("-", 2)
    return {
      nums: core.split(".").map((n) => parseInt(n, 10) || 0),
      pre: pre ? pre.split(".").map((p) => (/^\d+$/.test(p) ? parseInt(p, 10) : p)) : null,
    }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const diff = (x.nums[i] || 0) - (y.nums[i] || 0)
    if (diff !== 0) {
      return diff
    }
  }
  if (!x.pre && !y.pre) {
    return 0
  }
  if (!x.pre) {
    return 1
  }
  if (!y.pre) {
    return -1
  }
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === undefined) {
      return -1
    }
    if (q === undefined) {
      return 1
    }
    if (p === q) {
      continue
    }
    if (typeof p === "number" && typeof q === "number") {
      return p - q
    }
    return String(p) < String(q) ? -1 : 1
  }
  return 0
}

/**
 * Directories named `subpath` (relative to a package's node_modules) that contain
 * `probe`, under each workspace root and its monorepo component folders.
 */
export function discoverPackageDirs(roots: string[], subpath: string[], probe: string): string[] {
  const found: string[] = []
  for (const root of roots) {
    const candidates = [path.join(root, "node_modules", ...subpath)]
    for (const parent of MONOREPO_PARENTS) {
      let children: string[] = []
      try {
        children = fs.readdirSync(path.join(root, parent))
      } catch {
        continue
      }
      for (const child of children) {
        candidates.push(path.join(root, parent, child, "node_modules", ...subpath))
      }
    }
    for (const dir of candidates) {
      if (fs.existsSync(path.join(dir, probe)) && !found.includes(dir)) {
        found.push(dir)
      }
    }
  }
  return found
}

/** The workspace folders to search (or the test override). */
export function workspaceRoots(): string[] {
  return rootsOverride ?? (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath)
}

/**
 * Every `playbook-ui/dist/ai` directory under the given workspace roots:
 * `<root>/node_modules/...` and `<root>/{components,packages,apps}/*\/node_modules/...`.
 */
export function discoverAiDirs(roots: string[]): string[] {
  const found: string[] = []
  for (const root of roots) {
    const candidates = [path.join(root, AI_SUBPATH)]
    for (const parent of MONOREPO_PARENTS) {
      const parentDir = path.join(root, parent)
      let children: string[] = []
      try {
        children = fs.readdirSync(parentDir)
      } catch {
        continue
      }
      for (const child of children) {
        candidates.push(path.join(parentDir, child, AI_SUBPATH))
      }
    }
    for (const dir of candidates) {
      if (hasAiMetadata(dir) && !found.includes(dir)) {
        found.push(dir)
      }
    }
  }
  return found
}

/** Picks the newest installed version; the first one found wins ties. */
export function pickNewest(dirs: string[]): AiSource | null {
  let best: AiSource | null = null
  for (const dir of dirs) {
    const version = readVersion(dir)
    const candidate: AiSource = { dir, version, bundled: false }
    if (
      !best ||
      (version && (!best.version || compareVersions(version, best.version) > 0))
    ) {
      best = candidate
    }
  }
  return best
}

let resolved: AiSource | null = null
let resolvedFor: string | null = null
let rootsOverride: string[] | undefined

/** Test seam: pretend these folders are the open workspace. Pass undefined to undo. */
export function overrideWorkspaceRoots(roots: string[] | undefined): void {
  rootsOverride = roots
  resolved = null
  resolvedFor = null
  jsonCache.clear()
}

export function resolveAiSource(extensionPath: string): AiSource {
  if (resolved && resolvedFor === extensionPath) {
    return resolved
  }
  const roots =
    rootsOverride ?? (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath)
  const workspace = pickNewest(discoverAiDirs(roots))
  if (workspace) {
    resolved = workspace
  } else {
    const dir = path.join(extensionPath, "data", "ai")
    resolved = { dir, version: readVersion(dir), bundled: true }
  }
  resolvedFor = extensionPath
  return resolved
}

const jsonCache = new Map<string, unknown>()

/** Reads a JSON file relative to the resolved source; undefined if absent. */
export function readAiJson<T>(extensionPath: string, relativePath: string): T | undefined {
  const file = path.join(resolveAiSource(extensionPath).dir, relativePath)
  if (jsonCache.has(file)) {
    return jsonCache.get(file) as T | undefined
  }
  let value: T | undefined
  try {
    value = JSON.parse(fs.readFileSync(file, "utf-8")) as T
  } catch {
    value = undefined
  }
  jsonCache.set(file, value)
  return value
}

/** Reads a file that only ever ships bundled (e.g. data/deprecations.json). */
export function readBundledJson<T>(extensionPath: string, ...segments: string[]): T | undefined {
  const file = path.join(extensionPath, "data", ...segments)
  if (jsonCache.has(file)) {
    return jsonCache.get(file) as T | undefined
  }
  let value: T | undefined
  try {
    value = JSON.parse(fs.readFileSync(file, "utf-8")) as T
  } catch {
    value = undefined
  }
  jsonCache.set(file, value)
  return value
}

/** Forget everything read so far; the next call re-discovers the source. */
export function resetAiData(): void {
  resolved = null
  resolvedFor = null
  jsonCache.clear()
}

/** Switch to the bundled copy, e.g. when the workspace's metadata can't be used. */
export function forceBundledSource(extensionPath: string): AiSource {
  const dir = path.join(extensionPath, "data", "ai")
  resolved = { dir, version: readVersion(dir), bundled: true }
  resolvedFor = extensionPath
  return resolved
}
