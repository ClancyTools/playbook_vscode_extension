import * as fs from "fs"
import * as path from "path"

/**
 * Reads Playbook's color tokens out of its SCSS. No VS Code dependency, so the
 * sync script can use it.
 */

export type ColorTokens = Record<string, string>

const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

function toNumber(text: string): number | undefined {
  if (text.trim() === "") {
    return undefined
  }
  const n = Number(text.trim())
  return Number.isFinite(n) ? n : undefined
}

/** A CSS color from `rgb(...)` / `rgba(...)` with literal numbers, or undefined. */
function rgbToCss(args: string): string | undefined {
  const parts = args.split(",").map((p) => p.trim())
  if (parts.length < 3 || parts.length > 4) {
    return undefined
  }
  const nums = parts.map(toNumber)
  return nums.every((n) => n !== undefined)
    ? `rgba(${nums[0]}, ${nums[1]}, ${nums[2]}, ${nums[3] ?? 1})`
    : undefined
}

/**
 * Reads `$name: <value>;` declarations whose value is a hex color, an
 * rgb()/rgba() with literal numbers, another variable, or `rgba($var, alpha)`.
 * Anything computed (lighten(), mix(), maps) is skipped. Variable references are
 * resolved, so `$primary: $royal` yields royal's hex.
 */
export function parseScssColors(scss: string): ColorTokens {
  const raw = new Map<string, string>()
  const declaration = /^\s*\$([a-zA-Z0-9_-]+)\s*:\s*([^;]+?)\s*(!default)?\s*;/gm
  const clean = scss.replace(/\/\/[^\n]*/g, "")
  let match: RegExpExecArray | null
  while ((match = declaration.exec(clean)) !== null) {
    // `!default` only sets a variable that has no value yet (so
    // `$primary: $primary !default;` later in a file is a no-op).
    if (!(match[3] && raw.has(match[1]))) {
      raw.set(match[1], match[2].trim())
    }
  }

  const resolved: ColorTokens = {}
  const resolve = (name: string, seen: Set<string>): string | undefined => {
    if (resolved[name]) {
      return resolved[name]
    }
    const value = raw.get(name)
    if (value === undefined || seen.has(name)) {
      return undefined
    }
    seen.add(name)
    let css: string | undefined
    if (HEX.test(value)) {
      css = value
    } else if (/^\$[a-zA-Z0-9_-]+$/.test(value)) {
      css = resolve(value.slice(1), seen)
    } else {
      const call = /^(rgba?)\((.*)\)$/.exec(value)
      if (call) {
        const withRef = /^\$([a-zA-Z0-9_-]+)\s*,\s*(\$?[a-zA-Z0-9_.-]+)$/.exec(call[2].trim())
        if (withRef) {
          const base = resolve(withRef[1], seen)
          const alpha = toNumber(withRef[2].startsWith("$") ? raw.get(withRef[2].slice(1)) ?? "" : withRef[2])
          css = base && alpha !== undefined ? withAlpha(base, alpha) : undefined
        } else {
          css = rgbToCss(call[2])
        }
      }
    }
    if (css) {
      resolved[name] = css
    }
    return css
  }
  for (const name of raw.keys()) {
    resolve(name, new Set())
  }
  return resolved
}

function withAlpha(css: string, alpha: number): string | undefined {
  const hex = /^#([0-9a-fA-F]{6})$/.exec(css)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
  }
  return undefined
}

/**
 * Token files Playbook keeps colors in (`_colors.scss` in the repo, `colors.scss`
 * in dist). Opacity comes first: some colors are `rgba($white, $opacity_4)`.
 */
const TOKEN_FILES = ["opacity", "colors", "colors_accessible"]

/** Reads the color tokens from a directory of Playbook token SCSS. */
export function readTokenDirectory(dir: string): ColorTokens {
  let text = ""
  for (const file of TOKEN_FILES) {
    for (const candidate of [`${file}.scss`, `_${file}.scss`]) {
      try {
        text += "\n" + fs.readFileSync(path.join(dir, candidate), "utf-8")
        break
      } catch {
        // try the next spelling
      }
    }
  }
  return parseScssColors(text)
}

/** `$name: ( key: value, ... );` maps, with values resolved through `tokens` ("" when they can't be). */
export function parseScssMaps(scss: string, tokens: ColorTokens): Record<string, ColorTokens> {
  const clean = scss.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")
  const maps: Record<string, ColorTokens> = {}
  const start = /\$([a-zA-Z0-9_-]+)\s*:\s*\(/g
  let match: RegExpExecArray | null

  while ((match = start.exec(clean)) !== null) {
    let depth = 1
    let i = start.lastIndex
    while (i < clean.length && depth > 0) {
      if (clean[i] === "(") {
        depth++
      } else if (clean[i] === ")") {
        depth--
      }
      i++
    }
    const body = clean.slice(start.lastIndex, i - 1)
    const entries: ColorTokens = {}
    let level = 0
    let current = ""
    const flush = () => {
      const pair = /^\s*["']?([a-zA-Z0-9_-]+)["']?\s*:\s*(.+?)\s*$/s.exec(current)
      current = ""
      if (!pair) {
        return
      }
      const value = pair[2].trim()
      const resolved = value.startsWith("$") ? tokens[value.slice(1)] : HEX.test(value) ? value : undefined
      // A key whose color can't be worked out is still a valid name; it just has no swatch.
      entries[pair[1]] = resolved ?? ""
    }
    for (const ch of body) {
      if (ch === "(") {
        level++
      } else if (ch === ")") {
        level--
      }
      if (ch === "," && level === 0) {
        flush()
      } else {
        current += ch
      }
    }
    flush()
    maps[match[1]] = entries
    start.lastIndex = i
  }
  return maps
}

/** Evaluates `$name: map-merge($a, $b);` lines over the known maps, in order (later keys win, as in Sass). */
export function mergeScssMaps(scss: string, maps: Record<string, ColorTokens>): Record<string, ColorTokens> {
  const merged = { ...maps }
  const clean = scss.replace(/\/\/[^\n]*/g, "")
  for (const m of clean.matchAll(/\$([a-zA-Z0-9_-]+)\s*:\s*map-merge\(\s*\$([a-zA-Z0-9_-]+)\s*,\s*\$([a-zA-Z0-9_-]+)\s*\)\s*;/g)) {
    merged[m[1]] = { ...(merged[m[2]] ?? {}), ...(merged[m[3]] ?? {}) }
  }
  return merged
}

/**
 * The color names a kit accepts, from its stylesheet. Only kits whose color prop
 * has no enum in the schema need this (Icon, Legend).
 */
export function buildKitColors(tokenDir: string, iconScss: string, kitsDir?: string): Record<string, ColorTokens> {
  const tokens = readTokenDirectory(tokenDir)
  const read = (...parts: string[]): string => {
    try {
      return fs.readFileSync(path.join(kitsDir ?? "", ...parts), "utf-8")
    } catch {
      return ""
    }
  }
  const tokenScss = ["_colors.scss", "colors.scss", "_colors_accessible.scss", "colors_accessible.scss"]
    .map((f) => {
      try {
        return fs.readFileSync(path.join(tokenDir, f), "utf-8")
      } catch {
        return ""
      }
    })
    .join("\n")
  const base = { ...parseScssMaps(tokenScss, tokens), ...parseScssMaps(iconScss, tokens) }
  const merged = mergeScssMaps(iconScss, base)
  const colors: Record<string, ColorTokens> = {
    icon: merged.icon_colors ?? {},
    legend: base.data_colors ?? {},
  }
  if (!kitsDir) {
    return colors
  }

  // Kits whose values are semantic names (`light`, `link`, `dark`) with their own
  // color, not the same-named token. Each is read from the map the kit's styles loop over.
  const map = (scss: string, name: string): ColorTokens => parseScssMaps(scss, tokens)[name] ?? {}
  const semantic: Array<[string, ColorTokens]> = [
    ["body", map(read("pb_body", "_body_mixins.scss"), "pb_body_colors")],
    ["caption", map(read("pb_caption", "_caption_mixin.scss"), "pb_caption_colors")],
    ["title", map(read("pb_title", "_title_mixin.scss"), "pb_title_colors")],
    ["detail", map(read("pb_detail", "_detail_mixins.scss"), "pb_detail_colors")],
    ["link", map(read("tokens", "_typography.scss"), "pb_link_colors")],
    ["overlay", map(read("pb_overlay", "_overlay.scss"), "overlay_colors")],
  ]
  for (const [kit, entries] of semantic) {
    if (Object.keys(entries).length > 0) {
      colors[kit] = entries
    }
  }
  // Card: background is the product colors plus a few extras; the header takes the
  // product, additional, category and status colors.
  const extras = map(read("pb_card", "_card_mixin.scss"), "additional_colors")
  if (Object.keys(extras).length > 0 && base.product_colors) {
    colors["card.background"] = { ...base.product_colors, ...extras }
    colors["card.header_color"] = {
      ...base.product_colors,
      ...extras,
      ...(base.category_colors ?? {}),
      ...(base.status_colors ?? {}),
    }
  }
  return colors
}
