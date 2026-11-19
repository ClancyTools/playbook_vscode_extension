import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import { compareVersions, discoverPackageDirs, workspaceRoots } from "./aiData"
import { suggest } from "./suggestions"

/**
 * Playbook's custom icon set (@powerhome/playbook-icons).
 *
 * That repo is private (branding, vendor, window and door icons), so nothing
 * from it is bundled with this extension. The icons are read only from a copy on
 * the developer's machine: the workspace's installed package, or the folder named
 * by `playbook.icons.path` (e.g. a checkout of the repo).
 *
 * How the Icon kit resolves a name: a custom SVG from this set when one exists,
 * otherwise it falls back to a Font Awesome class (`fa-<name>`), otherwise emoji.
 * So a name missing from this set isn't necessarily wrong, and checks here are
 * deliberately conservative.
 */

export interface IconInfo {
  name: string
  category: string
  /** Absolute path of the SVG. */
  file: string
}

export interface IconIndex {
  /** The package or checkout the icons were read from. */
  dir: string
  version?: string
  icons: Map<string, IconInfo>
  /** alias -> canonical icon name. */
  aliases: Map<string, string>
}

export interface ResolvedIcon {
  info: IconInfo
  /** The name as written (may be an alias). */
  written: string
  /** Set when `written` is an alias of `info.name`. */
  viaAlias: boolean
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"))
  } catch {
    return undefined
  }
}

/** Builds the index from a package/checkout root holding `icons/<category>/<name>.svg`. */
export function buildIconIndex(dir: string): IconIndex | undefined {
  const iconsDir = path.join(dir, "icons")
  let categories: string[]
  try {
    categories = fs.readdirSync(iconsDir)
  } catch {
    return undefined
  }

  const icons = new Map<string, IconInfo>()
  for (const category of categories.sort()) {
    const categoryDir = path.join(iconsDir, category)
    let files: string[] = []
    try {
      files = fs.readdirSync(categoryDir)
    } catch {
      continue // a stray file rather than a category folder
    }
    for (const file of files.sort()) {
      if (file.endsWith(".svg")) {
        const name = file.slice(0, -4)
        if (!icons.has(name)) {
          icons.set(name, { name, category, file: path.join(categoryDir, file) })
        }
      }
    }
  }
  if (icons.size === 0) {
    return undefined
  }

  const aliasFile = readJson(path.join(dir, "aliases.json")) as { aliases?: Record<string, string> } | undefined
  const aliases = new Map<string, string>()
  for (const [alias, canonical] of Object.entries(aliasFile?.aliases || {})) {
    if (icons.has(canonical) && !icons.has(alias)) {
      aliases.set(alias, canonical)
    }
  }
  const manifest = readJson(path.join(dir, "package.json")) as { version?: string } | undefined
  return { dir, version: manifest?.version, icons, aliases }
}

export function resolveIcon(index: IconIndex, written: string): ResolvedIcon | undefined {
  const direct = index.icons.get(written)
  if (direct) {
    return { info: direct, written, viaAlias: false }
  }
  const canonical = index.aliases.get(written)
  const info = canonical && index.icons.get(canonical)
  return info ? { info, written, viaAlias: true } : undefined
}

/** Names close to `written`, for "did you mean". Canonical names first. */
export function iconSuggestions(index: IconIndex, written: string, limit = 3): string[] {
  return suggest(written, [...index.icons.keys(), ...index.aliases.keys()], limit)
}

const MAX_SVG_BYTES = 40_000

/** Fills that are deliberately not the icon's main color and stay as they are. */
const KEEP_FILL = /^(none|transparent|white|#fff|#ffffff|url\(.*\))$/i

/**
 * Paints every fill and stroke with `color`. Playbook's icons are mostly
 * `fill="#242B42"` (a dark navy; 726 files), some `black`, so matching one
 * color isn't enough. `none` (the common "no fill" on the root), white
 * cut-outs and gradient references are left alone.
 */
export function recolor(svg: string, color: string): string {
  return svg
    .replace(/\b(fill|stroke)="([^"]*)"/gi, (whole, attr: string, value: string) =>
      KEEP_FILL.test(value.trim()) ? whole : `${attr}="${color}"`
    )
    .replace(/\b(fill|stroke):\s*([^;"']+)/gi, (whole, attr: string, value: string) =>
      KEEP_FILL.test(value.trim()) ? whole : `${attr}:${color}`
    )
}

function dataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf-8").toString("base64")}`
}

/** Expands `~` and resolves a relative path against the first workspace folder. */
export function resolveConfiguredPath(configured: string, roots: string[]): string {
  let value = configured.trim()
  if (value === "~" || value.startsWith("~/")) {
    value = path.join(os.homedir(), value.slice(1))
  }
  return path.isAbsolute(value) || roots.length === 0 ? value : path.join(roots[0], value)
}

let cached: { key: string; index: IconIndex | undefined } | undefined

export function resetIconIndex(): void {
  cached = undefined
}

/** Where the icons will be read from, or undefined when no copy is available. */
export function locateIconPackage(configured: string, roots: string[]): string | undefined {
  if (configured.trim()) {
    const dir = resolveConfiguredPath(configured, roots)
    return fs.existsSync(path.join(dir, "icons")) ? dir : undefined
  }
  let best: { dir: string; version?: string } | undefined
  for (const dir of discoverPackageDirs(roots, ["@powerhome", "playbook-icons"], "aliases.json")) {
    const version = (readJson(path.join(dir, "package.json")) as { version?: string } | undefined)?.version
    if (!best || (version && (!best.version || compareVersions(version, best.version) > 0))) {
      best = { dir, version }
    }
  }
  return best?.dir
}

/** The icon index for the current workspace and settings; undefined when there is none. */
export function loadIconIndex(): IconIndex | undefined {
  const configured = vscode.workspace.getConfiguration("playbook").get<string>("icons.path", "")
  const roots = workspaceRoots()
  const key = `${configured}|${roots.join(",")}`
  if (cached && cached.key === key) {
    return cached.index
  }
  const dir = locateIconPackage(configured, roots)
  cached = { key, index: dir ? buildIconIndex(dir) : undefined }
  return cached.index
}

const LIGHT_ON_DARK = "#d4d4d4"
const DARK_ON_LIGHT = "#3c3c3c"

/** A color a user may safely put in a setting: hex, a plain name, or rgb()/rgba(). */
function isSafeColor(value: string): boolean {
  return /^#[0-9a-f]{3,8}$/i.test(value) || /^[a-z]+$/i.test(value) || /^rgba?\([\d\s.,%]+\)$/i.test(value)
}

/**
 * The color icon previews are drawn in: the user's `playbook.icons.previewColor`
 * when it is a valid color, otherwise light gray on dark themes and dark gray on
 * light ones (the images in a hover can't follow the theme themselves).
 */
export function previewColorFor(themeKind: vscode.ColorThemeKind, configured: string): string {
  const custom = configured.trim()
  if (custom && isSafeColor(custom)) {
    return custom
  }
  const light = themeKind === vscode.ColorThemeKind.Light || themeKind === vscode.ColorThemeKind.HighContrastLight
  return light ? DARK_ON_LIGHT : LIGHT_ON_DARK
}

/** The icon as an image for hovers and completion docs, drawn in the current theme's color. */
export function iconPreviewDataUri(info: IconInfo, color?: string): string | undefined {
  try {
    const svg = fs.readFileSync(info.file, "utf-8")
    if (svg.length > MAX_SVG_BYTES) {
      return undefined
    }
    const chosen =
      color ??
      previewColorFor(
        vscode.window.activeColorTheme.kind,
        vscode.workspace.getConfiguration("playbook").get<string>("icons.previewColor", "")
      )
    return dataUri(recolor(svg, chosen))
  } catch {
    return undefined
  }
}
