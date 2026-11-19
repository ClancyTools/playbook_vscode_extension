/**
 * Scans Playbook source for deprecated props. Used only by the sync script
 * (scripts/sync-playbook-data.ts); lives in src/ so it is unit-tested.
 */
import * as fs from "fs"
import * as path from "path"

export interface DeprecatedProp {
  message?: string
  replacement?: string
  platforms: Array<"rails" | "react">
}

export interface DeprecationData {
  generatedFrom: string
  props: Record<string, Record<string, DeprecatedProp>>
}

function snake(name: string): string {
  return name.replace(/([A-Z])/g, "_$1").toLowerCase()
}

function kitDirs(repo: string): Array<{ kit: string; dir: string }> {
  const base = path.join(repo, "app", "pb_kits", "playbook")
  return fs
    .readdirSync(base)
    .filter((d) => d.startsWith("pb_") && fs.statSync(path.join(base, d)).isDirectory())
    .map((d) => ({ kit: d.replace(/^pb_/, ""), dir: path.join(base, d) }))
}

function addDeprecation(
  data: DeprecationData,
  kit: string,
  prop: string,
  platform: "rails" | "react",
  extra: { message?: string; replacement?: string }
): void {
  const kitEntry = (data.props[kit] = data.props[kit] || {})
  const entry = (kitEntry[prop] = kitEntry[prop] || { platforms: [] })
  if (!entry.platforms.includes(platform)) {
    entry.platforms.push(platform)
  }
  entry.message = entry.message || extra.message
  entry.replacement = entry.replacement || extra.replacement
}

/** `prop :name, ..., deprecated: true | "message"` in a kit's Ruby class. */
export function scanRuby(source: string): Array<{ prop: string; message?: string }> {
  const found: Array<{ prop: string; message?: string }> = []
  // A prop declaration runs until the next `prop ` / blank line / `def`.
  const declaration = /^\s*prop\s+:(\w+)([\s\S]*?)(?=^\s*prop\s|^\s*def\s|^\s*end\b|\n\s*\n|(?![\s\S]))/gm
  let match
  while ((match = declaration.exec(source)) !== null) {
    const body = match[2]
    const flag = body.match(/deprecated:\s*(true|"([^"]*)"|'([^']*)')/)
    if (flag) {
      found.push({ prop: match[1], message: flag[2] || flag[3] })
    }
  }
  return found
}

/**
 * React-side markers:
 *   // @schemaOmit Deprecated. Use `x`...   (on the line above `type?: ...`)
 *   if (props.variant) deprecatedProps() //variant prop is deprecated, use color instead
 */
export function scanReact(
  source: string
): Array<{ prop: string; message?: string; replacement?: string }> {
  const found: Array<{ prop: string; message?: string; replacement?: string }> = []

  const omit = /\/\/\s*@schemaOmit\s+Deprecated[.:]?\s*([^\n]*)\n\s*(\w+)\??:/g
  let match
  while ((match = omit.exec(source)) !== null) {
    found.push({ prop: snake(match[2]), message: match[1].trim() || undefined })
  }

  const runtime = /if\s*\(\s*props\.(\w+)\s*\)\s*deprecatedProps\(\)\s*(?:\/\/\s*([^\n]*))?/g
  while ((match = runtime.exec(source)) !== null) {
    const comment = match[2]?.trim()
    const replacement = comment?.match(/use\s+`?(\w+)`?\s+instead/i)?.[1]
    // The comment names the prop being deprecated; the condition occasionally
    // checks a different one (Body checks `variant` but deprecates `status`).
    const named = comment?.match(/^`?(\w+)`?\s+prop\s+is\s+deprecated/i)?.[1]
    found.push({
      prop: snake(named || match[1]),
      message: comment || undefined,
      replacement: replacement ? snake(replacement) : undefined,
    })
  }
  return found
}

export function scanDeprecations(repo: string): DeprecationData {
  const data: DeprecationData = { generatedFrom: path.basename(repo), props: {} }
  for (const { kit, dir } of kitDirs(repo)) {
    for (const file of fs.readdirSync(dir)) {
      const full = path.join(dir, file)
      if (!fs.statSync(full).isFile()) {
        continue
      }
      const source = fs.readFileSync(full, "utf-8")
      if (file.endsWith(".rb") && !file.endsWith("_spec.rb")) {
        for (const d of scanRuby(source)) {
          addDeprecation(data, kit, d.prop, "rails", { message: d.message })
        }
      } else if (file.endsWith(".tsx") && !file.endsWith(".test.tsx")) {
        for (const d of scanReact(source)) {
          addDeprecation(data, kit, d.prop, "react", d)
        }
      }
    }
  }
  // Stable output keeps the diff reviewable.
  data.props = Object.fromEntries(
    Object.entries(data.props)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([kit, props]) => [
        kit,
        Object.fromEntries(Object.entries(props).sort(([a], [b]) => a.localeCompare(b))),
      ])
  )
  return data
}
