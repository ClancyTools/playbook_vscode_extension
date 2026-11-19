import { FormBuilderMetadata, PlaybookMetadata, ComponentMetadata, camelToSnake, findComponentByRailsName, findFormBuilderField } from "./metadata"
import { TextEdit } from "./spacingCombine"
import { resolveComponent, scanUsages } from "./usageRules"
import { ScannedProp, ScannedUsage, literalValue, scanFormBuilderUsages } from "./usageScanner"

/**
 * A hand-written asterisk in a label ("Name *") where the kit can draw its own
 * with required_indicator.
 *
 * Kept narrow on purpose, since a wrong suggestion on a label is annoying:
 *   - only kits that have a required-indicator prop in Playbook's schema, and only
 *     their own label prop (`label`; `text` for Checkbox);
 *   - only a literal string that *ends* in an asterisk after real text — "*REQUIRED"
 *     notes, "$3,500*" footnotes and a lone "*" are left alone;
 *   - never when props are spread in (the indicator may come from there), and not
 *     for components we don't know (an app's own InputField may not forward it).
 */

export type RequiredIndicatorKind = "label" | "double" | "caption"

export interface RequiredIndicatorIssue {
  kind: RequiredIndicatorKind
  /** The label value, quotes included. */
  start: number
  end: number
  message: string
  title?: string
  edits: TextEdit[]
}

/** `Name *`, `SUBJECT*`, `Name (*)`: real text, then an asterisk (optionally in parens) at the end. */
const TRAILING_ASTERISK = /\s*\(?\*+\)?\s*$/
const REAL_TEXT_BEFORE = /[^\s*()]/

/** The label's text without its trailing asterisk, or undefined if it doesn't end in one. */
export function withoutTrailingAsterisk(value: string): string | undefined {
  const match = TRAILING_ASTERISK.exec(value)
  if (!match || match.index === 0 || !REAL_TEXT_BEFORE.test(value.slice(0, match.index)) || /#\{|\$\{|<%/.test(value)) {
    return undefined
  }
  return value.slice(0, match.index)
}

/** Edit that deletes the trailing asterisk inside the quotes of `prop`'s string value. */
function removeAsteriskEdit(prop: ScannedProp): TextEdit | undefined {
  if (prop.valueText === undefined || prop.valueStart === undefined) {
    return undefined
  }
  const quoted = /(["'])((?:(?!\1).)*)\1/s.exec(prop.valueText)
  if (!quoted) {
    return undefined
  }
  const inner = quoted[2]
  const tail = TRAILING_ASTERISK.exec(inner)
  if (!tail) {
    return undefined
  }
  const innerStart = prop.valueStart + quoted.index + 1
  return { start: innerStart + tail.index, end: innerStart + inner.length, newText: "" }
}

const INDICATOR = /^required_?indicator$/i

function nameOf(usage: ScannedUsage, prop: ScannedProp): string {
  return usage.platform === "react" ? camelToSnake(prop.name) : prop.name
}

/** Where to put `requiredIndicator` so React props stay alphabetical (the extension warns when they aren't). */
function addIndicatorEdit(text: string, usage: ScannedUsage, after: ScannedProp): TextEdit {
  if (usage.platform === "rails") {
    return { start: after.valueEnd ?? after.nameEnd, end: after.valueEnd ?? after.nameEnd, newText: ", required_indicator: true" }
  }
  // Before the first prop that sorts after it (which may be the label itself, e.g. Checkbox's text).
  const next = usage.props.find((p) => p.name.toLowerCase() > "requiredindicator")
  if (next) {
    return { start: next.nameStart, end: next.nameStart, newText: "requiredIndicator " }
  }
  const last = usage.props.reduce((a, b) => (b.nameStart > a.nameStart ? b : a), after)
  const at = last.valueEnd ?? last.nameEnd
  void text
  return { start: at, end: at, newText: " requiredIndicator" }
}

function labelPropOf(component: ComponentMetadata): string | undefined {
  if (!component.props.required_indicator) {
    return undefined
  }
  return component.props.label ? "label" : component.props.text ? "text" : undefined
}

function issuesForUsage(
  text: string,
  usage: ScannedUsage,
  component: ComponentMetadata
): RequiredIndicatorIssue[] {
  const labelName = labelPropOf(component)
  if (!labelName || usage.hasSpread) {
    return []
  }
  const label = usage.props.find((p) => nameOf(usage, p) === labelName)
  const value = label && literalValue(label)
  if (!label || typeof value !== "string" || label.valueStart === undefined || label.valueEnd === undefined) {
    return []
  }
  if (withoutTrailingAsterisk(value) === undefined) {
    return []
  }
  const remove = removeAsteriskEdit(label)
  if (!remove) {
    return []
  }

  const existing = usage.props.find((p) => INDICATOR.test(nameOf(usage, p).replace(/_/g, "")) || INDICATOR.test(p.name))
  const setting = existing && literalValue(existing)
  const range = { start: label.valueStart, end: label.valueEnd }

  if (existing && setting === true) {
    return [
      {
        kind: "double",
        ...range,
        message: `This ${labelName} ends in "*" and required_indicator draws one too, so it shows twice. Remove the "*".`,
        title: 'Remove the "*" from the label',
        edits: [remove],
      },
    ]
  }
  if (existing && setting !== false) {
    return [] // required_indicator is set from a variable; can't tell what it will be
  }

  const enable: TextEdit =
    existing && setting === false
      ? usage.platform === "rails"
        ? { start: existing.valueStart ?? existing.nameEnd, end: existing.valueEnd ?? existing.nameEnd, newText: "true" }
        : { start: existing.nameStart, end: existing.valueEnd ?? existing.nameEnd, newText: "requiredIndicator" }
      : addIndicatorEdit(text, usage, label)

  const indicator = usage.platform === "rails" ? "required_indicator: true" : "requiredIndicator"
  return [
    {
      kind: "label",
      ...range,
      message: `Use ${indicator} instead of a "*" in the ${labelName}, so Playbook draws the indicator. (It is visual only; ${
        usage.platform === "rails" ? "required: true" : "required"
      } adds the validation.)`,
      title: `Remove the "*" and use ${indicator}`,
      edits: [remove, enable],
    },
  ]
}

/** A Caption "Name *" that sits right before a Playbook input that has no label of its own. */
function captionIssue(
  usage: ScannedUsage,
  next: ScannedUsage | undefined,
  metadata: PlaybookMetadata,
  text: string
): RequiredIndicatorIssue | undefined {
  const textProp = usage.props.find((p) => nameOf(usage, p) === "text")
  const value = textProp && literalValue(textProp)
  if (!textProp || typeof value !== "string" || textProp.valueStart === undefined || textProp.valueEnd === undefined) {
    return undefined
  }
  if (withoutTrailingAsterisk(value) === undefined || !next || next.hasSpread || usage.hasSpread) {
    return undefined
  }
  const nextKit = resolveComponent(metadata, next)
  const between = text.slice(usage.end, next.componentStart)
  if (!nextKit || !nextKit.props.required_indicator || !nextKit.props.label || between.length > 400) {
    return undefined
  }
  if (next.props.some((p) => nameOf(next, p) === "label")) {
    return undefined // that input already has its own label
  }
  return {
    kind: "caption",
    start: textProp.valueStart,
    end: textProp.valueEnd,
    message: `This looks like a label for the ${nextKit.rails} below. Passing it as that kit's label with ${
      usage.platform === "rails" ? "required_indicator: true" : "requiredIndicator"
    } draws the indicator for you.`,
    edits: [],
  }
}

/**
 * Hand-written required asterisks in the labels of Playbook inputs (pb_rails,
 * JSX and form builder calls).
 */
export function findRequiredIndicatorIssues(
  text: string,
  languageId: string,
  metadata: PlaybookMetadata,
  forms: FormBuilderMetadata
): RequiredIndicatorIssue[] {
  const issues: RequiredIndicatorIssue[] = []
  const usages = scanUsages(text, languageId).sort((a, b) => a.componentStart - b.componentStart)

  usages.forEach((usage, i) => {
    const component = resolveComponent(metadata, usage)
    if (!component) {
      return
    }
    issues.push(...issuesForUsage(text, usage, component))
    if (component.rails === "caption") {
      const issue = captionIssue(usage, usages[i + 1], metadata, text)
      if (issue) {
        issues.push(issue)
      }
    }
  })

  if (languageId !== "typescriptreact" && languageId !== "javascriptreact" && languageId !== "typescript" && languageId !== "javascript") {
    for (const usage of scanFormBuilderUsages(text)) {
      const field = findFormBuilderField(forms, usage.component)
      const component = field && findComponentByRailsName(metadata, field.kit)
      if (component) {
        issues.push(...issuesForUsage(text, usage, component))
      }
    }
  }
  return issues.sort((a, b) => a.start - b.start)
}
