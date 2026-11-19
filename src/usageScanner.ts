/**
 * Finds Playbook kit usages in source text and the props passed to each one.
 *
 * Pure string scanning with no VS Code dependency, so it is unit-testable and
 * works on whole documents (multi-line usages, `=>` inside handlers, shorthand
 * boolean props) where the line-oriented regexes elsewhere cannot.
 *
 * All offsets are indexes into the text passed in.
 */

export interface ScannedProp {
  /** As written: camelCase in React, snake_case in Rails (quotes stripped). */
  name: string
  nameStart: number
  nameEnd: number
  /** Source text of the value; undefined for a shorthand boolean (`<X open />`). */
  valueText?: string
  valueStart?: number
  valueEnd?: number
}

export interface ScannedUsage {
  platform: "react" | "rails"
  /** `Button`, `Table.Row` or `button`, `table/table_row`. */
  component: string
  componentStart: number
  componentEnd: number
  props: ScannedProp[]
  /** `{...props}` / `**opts` / a non-literal `props:` — unknown props may be passed. */
  hasSpread: boolean
  /** Offset just after the opening tag / pb_rails call arguments we understood. */
  end: number
  /** True for `f.text_field :name, props: { ... }` form builder calls. */
  form?: boolean
}

const WORD = /[\w$]/

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD.test(ch)
}

/** Index after the closing quote of the string starting at `i`. */
function skipString(text: string, i: number, interpolation: "js" | "ruby" | "none"): number {
  const quote = text[i]
  let j = i + 1
  while (j < text.length) {
    const ch = text[j]
    if (ch === "\\") {
      j += 2
      continue
    }
    if (ch === quote) {
      return j + 1
    }
    if (quote === "`" && ch === "$" && text[j + 1] === "{") {
      j = skipBraces(text, j + 1, interpolation)
      continue
    }
    if (quote === '"' && interpolation === "ruby" && ch === "#" && text[j + 1] === "{") {
      j = skipBraces(text, j + 1, interpolation)
      continue
    }
    j++
  }
  return text.length
}

/** Index after the `}` matching the `{` at `i`, skipping strings and comments. */
function skipBraces(text: string, i: number, interpolation: "js" | "ruby" | "none"): number {
  let depth = 0
  let j = i
  while (j < text.length) {
    const ch = text[j]
    if (ch === '"' || ch === "'" || ch === "`") {
      j = skipString(text, j, ch === "`" ? "js" : interpolation)
      continue
    }
    if (interpolation === "js" && ch === "/" && text[j + 1] === "/") {
      const newline = text.indexOf("\n", j)
      j = newline === -1 ? text.length : newline
      continue
    }
    if (interpolation === "js" && ch === "/" && text[j + 1] === "*") {
      const close = text.indexOf("*/", j + 2)
      j = close === -1 ? text.length : close + 2
      continue
    }
    if (interpolation === "ruby" && ch === "#" && text[j + 1] !== "{") {
      const newline = text.indexOf("\n", j)
      j = newline === -1 ? text.length : newline
      continue
    }
    if (ch === "{") {
      depth++
    } else if (ch === "}") {
      depth--
      if (depth === 0) {
        return j + 1
      }
    }
    j++
  }
  return text.length
}

function skipWhitespace(text: string, i: number): number {
  while (i < text.length && /\s/.test(text[i])) {
    i++
  }
  return i
}

// ---------------------------------------------------------------------------
// React / JSX
// ---------------------------------------------------------------------------

/** Every `<PascalCase ...>` opening tag in the text, including `<Kit.Sub>`. */
export function scanReactUsages(text: string): ScannedUsage[] {
  const usages: ScannedUsage[] = []
  const tag = /<([A-Z][\w]*(?:\.[A-Z][\w]*)*)/g
  let match: RegExpExecArray | null

  while ((match = tag.exec(text)) !== null) {
    // `Array<Foo>` / `useState<Foo>(…)` are generics, not JSX.
    if (match.index > 0 && /[\w$.)\]]/.test(text[match.index - 1])) {
      continue
    }

    const usage: ScannedUsage = {
      platform: "react",
      component: match[1],
      componentStart: match.index + 1,
      componentEnd: match.index + 1 + match[1].length,
      props: [],
      hasSpread: false,
      end: tag.lastIndex,
    }

    let i = tag.lastIndex
    let aborted = false
    scan: while (i < text.length) {
      i = skipWhitespace(text, i)
      const ch = text[i]

      if (ch === "/" && text[i + 1] === ">") {
        usage.end = i + 2
        break
      }
      if (ch === ">") {
        usage.end = i + 1
        break
      }
      if (ch === "{") {
        // {...spread}
        usage.hasSpread = true
        i = skipBraces(text, i, "js")
        usage.end = i
        continue
      }
      if (ch === "/" && text[i + 1] === "/") {
        const newline = text.indexOf("\n", i)
        i = newline === -1 ? text.length : newline
        continue
      }
      if (ch === "/" && text[i + 1] === "*") {
        const close = text.indexOf("*/", i + 2)
        i = close === -1 ? text.length : close + 2
        continue
      }
      if (ch === undefined) {
        break // ran out of text mid-tag (the user is still typing)
      }
      if (!/[A-Za-z_$]/.test(ch)) {
        // Not a JSX tag after all (e.g. a comparison `a <B)`), drop it.
        aborted = true
        break scan
      }

      const nameStart = i
      while (i < text.length && /[\w$:-]/.test(text[i])) {
        i++
      }
      const prop: ScannedProp = {
        name: text.slice(nameStart, i),
        nameStart,
        nameEnd: i,
      }

      const afterName = skipWhitespace(text, i)
      if (text[afterName] === "=") {
        const valueStart = skipWhitespace(text, afterName + 1)
        let valueEnd = valueStart
        const first = text[valueStart]
        if (first === '"' || first === "'") {
          valueEnd = skipString(text, valueStart, "none")
        } else if (first === "{") {
          valueEnd = skipBraces(text, valueStart, "js")
        } else {
          while (valueEnd < text.length && !/[\s/>]/.test(text[valueEnd])) {
            valueEnd++
          }
        }
        prop.valueStart = valueStart
        prop.valueEnd = valueEnd
        prop.valueText = text.slice(valueStart, valueEnd)
        i = valueEnd
      }

      usage.props.push(prop)
      usage.end = i
    }

    if (!aborted) {
      usages.push(usage)
    }
  }
  return usages
}

// ---------------------------------------------------------------------------
// Rails / pb_rails
// ---------------------------------------------------------------------------

/** Every `pb_rails("kit", props: { ... })` call in the text. */
export function scanRailsUsages(text: string): ScannedUsage[] {
  const usages: ScannedUsage[] = []
  const call = /pb_rails\(\s*(["'])([^"']+)\1/g
  let match: RegExpExecArray | null

  while ((match = call.exec(text)) !== null) {
    const nameStart = match.index + match[0].length - 1 - match[2].length
    const usage: ScannedUsage = {
      platform: "rails",
      component: match[2],
      componentStart: nameStart,
      componentEnd: nameStart + match[2].length,
      props: [],
      hasSpread: false,
      end: call.lastIndex,
    }

    let i = skipWhitespace(text, call.lastIndex)
    if (text[i] === ",") {
      i = skipWhitespace(text, i + 1)
      const propsKey = /^props\s*:\s*/.exec(text.slice(i, i + 24))
      if (propsKey) {
        i = skipWhitespace(text, i + propsKey[0].length)
        if (text[i] === "{") {
          scanRubyHash(text, i, usage)
        } else if (text[i] !== ")") {
          usage.hasSpread = true // props: some_hash
        }
      } else if (text[i] === "{") {
        scanRubyHash(text, i, usage) // pb_rails("kit", { ... })
      } else if (text[i] !== ")" && text[i] !== undefined) {
        usage.hasSpread = true
      }
    }
    usages.push(usage)
  }
  return usages
}

function scanRubyHash(text: string, open: number, usage: ScannedUsage): void {
  let i = open + 1
  while (i < text.length) {
    i = skipWhitespace(text, i)
    const ch = text[i]

    if (ch === "}") {
      usage.end = i + 1
      return
    }
    if (ch === ",") {
      i++
      continue
    }
    if (ch === "#") {
      const newline = text.indexOf("\n", i)
      i = newline === -1 ? text.length : newline
      continue
    }
    if (ch === "*" && text[i + 1] === "*") {
      usage.hasSpread = true
      i = skipRubyValue(text, i + 2).next
      continue
    }

    // key forms:  name:   "name":   :name =>   "name" =>
    let name: string
    let nameStart: number
    let nameEnd: number
    if (ch === '"' || ch === "'") {
      const end = skipString(text, i, "none")
      nameStart = i + 1
      nameEnd = end - 1
      name = text.slice(nameStart, nameEnd)
      i = end
    } else if (ch === ":" && /[A-Za-z_]/.test(text[i + 1] || "")) {
      nameStart = i + 1
      i = nameStart
      while (isWordChar(text[i])) {
        i++
      }
      nameEnd = i
      name = text.slice(nameStart, nameEnd)
    } else if (/[A-Za-z_]/.test(ch || "")) {
      nameStart = i
      while (isWordChar(text[i])) {
        i++
      }
      nameEnd = i
      name = text.slice(nameStart, nameEnd)
    } else {
      // Something we don't understand; stop rather than mis-attribute props.
      usage.hasSpread = true
      return
    }

    i = skipWhitespace(text, i)
    if (text[i] === ":" ) {
      i++
    } else if (text[i] === "=" && text[i + 1] === ">") {
      i += 2
    } else {
      usage.hasSpread = true
      return
    }

    const valueStart = skipWhitespace(text, i)
    const value = skipRubyValue(text, valueStart)
    usage.props.push({
      name,
      nameStart,
      nameEnd,
      valueText: text.slice(valueStart, value.significantEnd),
      valueStart,
      valueEnd: value.significantEnd,
    })
    usage.end = value.significantEnd
    i = value.next
  }
}

/**
 * Reads a Ruby value up to a top-level `,` or the hash's closing `}`.
 * `next` is where scanning resumes; `significantEnd` excludes trailing
 * whitespace and comments.
 */
function skipRubyValue(text: string, i: number): { next: number; significantEnd: number } {
  let depth = 0
  let significantEnd = i
  while (i < text.length) {
    const ch = text[i]
    if (ch === '"' || ch === "'") {
      i = skipString(text, i, "ruby")
      significantEnd = i
      continue
    }
    if (ch === "#" && text[i + 1] !== "{") {
      const newline = text.indexOf("\n", i)
      i = newline === -1 ? text.length : newline
      continue
    }
    if (ch === "{" || ch === "[" || ch === "(") {
      depth++
    } else if (ch === "}" || ch === "]" || ch === ")") {
      if (depth === 0) {
        return { next: i, significantEnd }
      }
      depth--
    } else if (ch === "," && depth === 0) {
      return { next: i, significantEnd }
    }
    i++
    if (!/\s/.test(ch)) {
      significantEnd = i
    }
  }
  return { next: i, significantEnd }
}

// ---------------------------------------------------------------------------
// Form builder: f.text_field :name, props: { ... }
// ---------------------------------------------------------------------------

/**
 * Every `f.method ...` / `form.method ...` call, with the props hash passed to
 * it. The call ends at `%>`, or at a newline once its brackets are closed and
 * the line doesn't continue, so props never leak in from a neighbouring call.
 */
export function scanFormBuilderUsages(text: string): ScannedUsage[] {
  const usages: ScannedUsage[] = []
  const call = /\b(?:f|form|builder)\.(\w+)(?=\s*\(|\s+[:@\w"'])/g
  let match: RegExpExecArray | null

  while ((match = call.exec(text)) !== null) {
    const nameStart = match.index + match[0].length - match[1].length
    const usage: ScannedUsage = {
      platform: "rails",
      component: match[1],
      componentStart: nameStart,
      componentEnd: nameStart + match[1].length,
      props: [],
      hasSpread: false,
      end: call.lastIndex,
      form: true,
    }

    let i = call.lastIndex
    const parenthesized = text[skipWhitespace(text, i)] === "("
    const baseDepth = parenthesized ? 1 : 0
    let depth = 0
    let lastSignificant = ""

    while (i < text.length) {
      const ch = text[i]
      if (depth === 0 && text.startsWith("%>", i)) {
        break
      }
      if (ch === '"' || ch === "'") {
        i = skipString(text, i, "ruby")
        lastSignificant = ch
        continue
      }
      if (ch === "\n" && depth === 0 && lastSignificant !== "," && lastSignificant !== "\\") {
        break
      }
      if (ch === "(" || ch === "[" || ch === "{") {
        depth++
      } else if (ch === ")" || ch === "]" || ch === "}") {
        depth--
        if (depth < 0) {
          break
        }
      }
      if (depth === baseDepth && /^props\s*:/.test(text.slice(i, i + 12)) && !isWordChar(text[i - 1])) {
        const afterKey = skipWhitespace(text, i + text.slice(i).indexOf(":") + 1)
        if (text[afterKey] === "{") {
          scanRubyHash(text, afterKey, usage)
        } else {
          usage.hasSpread = true
        }
        break
      }
      if (!/\s/.test(ch)) {
        lastSignificant = ch
      }
      i++
    }
    usages.push(usage)
  }
  return usages
}
