import {
  FormBuilderMetadata,
  ComponentMetadata,
  getPropValues,
  findFormBuilderField,
  PlaybookMetadata,
  Platform,
  camelToSnake,
  findComponentByReactName,
  findComponentByRailsName,
  findRailsSubcomponent,
  findReactSubcomponent,
  getPropDefault,
  getPropDeprecation,
  platformFor,
  snakeToCamel,
} from "./metadata"
import { migrationForUsage, migrationText } from "./flexAxis"
import { Playground } from "./playgrounds"
import {
  literalValue,
  ScannedProp,
  ScannedUsage,
  scanFormBuilderUsages,
  scanRailsUsages,
  scanReactUsages,
} from "./usageScanner"

/**
 * Rules that look at how a kit is used as a whole (which props are present
 * together), as opposed to the per-prop checks in diagnostics.ts.
 *
 * Pure: takes text, returns findings positioned by offset. diagnostics.ts
 * turns them into editor diagnostics.
 */

export type FindingSeverity = "hint" | "information" | "warning"

export interface Finding {
  start: number
  end: number
  message: string
  severity: FindingSeverity
  /** Stable id: "deprecated-prop" | "prop-dependency" | "missing-package". */
  code: string
  /** Rendered with a strikethrough in the editor. */
  deprecated?: boolean
  /** For deprecated-prop findings: which kit/prop, and what replaces it. */
  kit?: string
  prop?: string
  replacement?: string
}

export interface RuleOptions {
  deprecations: boolean
  propDependencies: boolean
  externalDependencies: boolean
  /** Name the right justify/align replacement for a deprecated Flex prop. */
  flexMigration: boolean
}

/**
 * Playbook's playground `conditionals` describe when a control is *shown* in
 * its docs playground. Many are real behaviour ("target" is ignored without
 * "href"), but many are only layout hints for the playground (Flex "horizontal"
 * needs "vertical"; Button "iconRight" does not need "icon"). Run against
 * Nitro's code, the unfiltered data produced hundreds of false positives, so a
 * diagnostic is only raised for rules confirmed in Playbook's source.
 *
 * To vet another: find where the kit reads the prop and confirm it is ignored
 * without the other (e.g. `target if target && href` in pb_link/link.rb), then
 * add "<rails_kit>.<camelCaseProp>" here. A test fails if an entry stops
 * existing in the synced playground data.
 */
export const VETTED_DEPENDENCIES: ReadonlySet<string> = new Set([
  "button.target",
  "circle_icon_button.target",
  "dropdown.cacheOptions",
  "dropdown.defaultOptions",
  "dropdown.enablePillReorder",
  "dropdown.formPillProps",
  "dropdown.loadOptions",
  "dropdown.showPillIndex",
  "hashtag.rel",
  "hashtag.target",
  "link.target",
])

export const DEFAULT_RULE_OPTIONS: RuleOptions = {
  deprecations: true,
  propDependencies: true,
  externalDependencies: true,
  flexMigration: true,
}

export interface RuleContext {
  languageId: string
  metadata: PlaybookMetadata
  getPlayground: (railsName: string) => Playground | undefined
  /** Whether an npm package can be resolved from this document; omit to skip the check. */
  isPackageAvailable?: (pkg: string) => boolean
  options?: Partial<RuleOptions>
}

/** The usages in `text` that this language file can contain. */
export function scanUsages(text: string, languageId: string): ScannedUsage[] {
  return platformFor(languageId) === "rails" ? scanRailsUsages(text) : scanReactUsages(text)
}

/** The usage and prop whose name the offset is on, for hover. */
export function propAt(
  text: string,
  languageId: string,
  offset: number
): { usage: ScannedUsage; prop: ScannedProp } | undefined {
  for (const usage of scanUsages(text, languageId)) {
    const prop = usage.props.find((p) => offset >= p.nameStart && offset <= p.nameEnd)
    if (prop) {
      return { usage, prop }
    }
  }
  return undefined
}

/** The usage and prop whose *value* the offset is inside, for value hovers. */
export function valueAt(
  text: string,
  languageId: string,
  offset: number
): { usage: ScannedUsage; prop: ScannedProp } | undefined {
  for (const usage of scanUsages(text, languageId)) {
    const prop = usage.props.find(
      (p) => p.valueStart !== undefined && p.valueEnd !== undefined && offset >= p.valueStart && offset <= p.valueEnd
    )
    if (prop) {
      return { usage, prop }
    }
  }
  return undefined
}

/** The innermost usage whose tag / call arguments contain the offset, for completion. */
export function usageAt(text: string, languageId: string, offset: number): ScannedUsage | undefined {
  let found: ScannedUsage | undefined
  for (const usage of scanUsages(text, languageId)) {
    if (usage.componentStart <= offset && offset <= usage.end) {
      found = usage // later usages start later, so the last match is the innermost
    }
  }
  return found
}

export function resolveComponent(
  metadata: PlaybookMetadata,
  usage: ScannedUsage
): ComponentMetadata | null {
  if (usage.component.includes(".") || usage.component.includes("/")) {
    return null // subcomponents have no schema of their own
  }
  return usage.platform === "rails"
    ? findComponentByRailsName(metadata, usage.component)
    : findComponentByReactName(metadata, usage.component)
}

/**
 * The kit whose global props apply to this usage: the kit itself, or for a
 * subcomponent (`card/card_body`, `Card.Body`) its parent kit. Subcomponents
 * have no schema of their own, but every Playbook component, subcomponents
 * included, takes the global props (padding, margin, display, …).
 */
export function resolveGlobalPropsHost(
  metadata: PlaybookMetadata,
  usage: ScannedUsage
): ComponentMetadata | null {
  const own = resolveComponent(metadata, usage)
  if (own) {
    return own
  }
  const sub =
    usage.platform === "rails"
      ? findRailsSubcomponent(metadata, usage.component)
      : findReactSubcomponent(metadata, usage.component)
  return sub?.parent ?? null
}

/** The prop's name in this platform's own spelling. */
export function displayName(snake: string, platform: Platform): string {
  return platform === "rails" ? snake : snakeToCamel(snake)
}

export function checkUsages(text: string, context: RuleContext): Finding[] {
  const options = { ...DEFAULT_RULE_OPTIONS, ...context.options }
  const findings: Finding[] = []

  for (const usage of scanUsages(text, context.languageId)) {
    const component = resolveComponent(context.metadata, usage)
    if (!component) {
      continue
    }
    if (options.deprecations) {
      findings.push(...deprecatedProps(usage, component, context.languageId, options.flexMigration))
    }
    if (options.propDependencies) {
      findings.push(...propDependencies(usage, component, context))
    }
    if (options.externalDependencies && context.isPackageAvailable) {
      findings.push(...missingPackages(usage, component, context.isPackageAvailable))
    }
  }
  return findings
}

function snakeOf(prop: ScannedProp, platform: Platform): string {
  return platform === "react" ? camelToSnake(prop.name) : prop.name
}

function deprecatedProps(
  usage: ScannedUsage,
  component: ComponentMetadata,
  languageId: string,
  flexMigration = true
): Finding[] {
  const findings: Finding[] = []
  for (const prop of usage.props) {
    const info = getPropDeprecation(component, snakeOf(prop, usage.platform), languageId)
    if (!info) {
      continue
    }
    let message = `Prop "${prop.name}" is deprecated.`
    const migrated = flexMigration ? migrationForUsage(usage, component, prop) : undefined
    if (migrated) {
      message += ` Use ${migrationText(migrated.migration, usage.platform)} instead (orientation is ${migrated.resolved.orientation}).`
    } else if (info.replacement) {
      message += ` Use "${displayName(info.replacement, usage.platform)}" instead.`
    } else if (info.message) {
      message += ` ${info.message}`
    }
    findings.push({
      start: prop.nameStart,
      end: prop.nameEnd,
      message,
      severity: "information",
      code: "deprecated-prop",
      deprecated: true,
      kit: component.rails,
      prop: snakeOf(prop, usage.platform),
      replacement: info.replacement,
    })
  }
  return findings
}

export { literalValue } from "./usageScanner"

function sameLiteral(actual: string | boolean, expected: unknown): boolean {
  return String(actual) === String(expected)
}

/**
 * Playbook's playground metadata says which props only apply alongside
 * another (`formPillProps` needs `multiSelect`). Flag the ones that are used
 * without it, since they silently do nothing.
 */
function propDependencies(
  usage: ScannedUsage,
  component: ComponentMetadata,
  context: RuleContext
): Finding[] {
  const conditionals = context.getPlayground(component.rails)?.conditionals
  if (!conditionals || usage.hasSpread) {
    return []
  }

  const present = new Map<string, ScannedProp>()
  for (const prop of usage.props) {
    present.set(snakeOf(prop, usage.platform), prop)
  }

  const findings: Finding[] = []
  for (const prop of usage.props) {
    const camel = snakeToCamel(snakeOf(prop, usage.platform))
    if (!VETTED_DEPENDENCIES.has(`${component.rails}.${camel}`)) {
      continue
    }
    const requires = conditionals[camel]?.requires
    if (!requires) {
      continue
    }

    const unmet = unmetRequirements(requires, present, component, context.languageId, usage.platform)
    if (unmet.length === 0) {
      continue
    }
    findings.push({
      start: prop.nameStart,
      end: prop.nameEnd,
      message: `"${prop.name}" has no effect unless ${unmet.join(" and ")}.`,
      severity: "information",
      code: "prop-dependency",
    })
  }
  return findings
}

function unmetRequirements(
  requires: string | Record<string, unknown>,
  present: Map<string, ScannedProp>,
  component: ComponentMetadata,
  languageId: string,
  platform: Platform
): string[] {
  const requirements: Array<[string, unknown]> =
    typeof requires === "string" ? [[requires, true]] : Object.entries(requires)

  const unmet: string[] = []
  for (const [camelName, expected] of requirements) {
    const snake = camelToSnake(camelName)
    const kitProp = component.props[snake]
    if (!kitProp) {
      continue // not a real prop of this kit; nothing we can check
    }
    const name = displayName(snake, platform)
    const used = present.get(snake)

    if (used) {
      const literal = literalValue(used)
      // A bare requirement ("needs href") is met by any value except false.
      const anyValueWillDo = typeof requires === "string"
      if (
        literal === undefined ||
        (anyValueWillDo ? literal !== false : sameLiteral(literal, expected))
      ) {
        continue // dynamic values are given the benefit of the doubt
      }
      unmet.push(describe(name, expected))
      continue
    }

    // Not passed: the kit's own default may already satisfy the rule.
    const fallback = getPropDefault(kitProp, languageId)
    if (fallback !== undefined && sameLiteral(fallback.replace(/^["']|["']$/g, ""), expected)) {
      continue
    }
    unmet.push(describe(name, expected))
  }
  return unmet
}

function describe(name: string, expected: unknown): string {
  return expected === true ? `"${name}" is set` : `${name} is ${JSON.stringify(expected)}`
}

function missingPackages(
  usage: ScannedUsage,
  component: ComponentMetadata,
  isPackageAvailable: (pkg: string) => boolean
): Finding[] {
  const packages = component.externalDependencies?.packages
  if (!packages) {
    return []
  }
  const missing = packages.filter((pkg) => !isPackageAvailable(pkg))
  if (missing.length === 0) {
    return []
  }
  return [
    {
      start: usage.componentStart,
      end: usage.componentEnd,
      message: `"${usage.component}" needs ${missing
        .map((m) => `"${m}"`)
        .join(", ")} in the host app, which ${missing.length === 1 ? "isn't" : "aren't"} installed. Playbook doesn't bundle ${missing.length === 1 ? "it" : "them"}.`,
      severity: "warning",
      code: "missing-package",
    },
  ]
}

/** Props accepted on every Playbook call whatever the kit's schema says. */
const ALWAYS_VALID_PROPS = new Set(["id", "key"])

/**
 * Checks props passed through the Rails form builder
 * (`f.text_field :name, props: { ... }`): unknown props and enum values the
 * field's kit doesn't accept.
 */
export function checkFormBuilderUsages(
  text: string,
  metadata: PlaybookMetadata,
  forms: FormBuilderMetadata,
  languageId: string
): Finding[] {
  const findings: Finding[] = []
  for (const usage of scanFormBuilderUsages(text)) {
    const field = findFormBuilderField(forms, usage.component)
    if (!field) {
      continue
    }
    for (const prop of usage.props) {
      const known = field.props[prop.name] || metadata.globalProps?.[prop.name]
      if (!known && !ALWAYS_VALID_PROPS.has(prop.name)) {
        findings.push({
          start: prop.nameStart,
          end: prop.nameEnd,
          message: `Unknown prop "${prop.name}" for form builder field "${field.name}"`,
          severity: "warning",
          code: "unknown-prop",
        })
        continue
      }
      const invalid = known && invalidEnumValue(prop, getPropValues(known, languageId))
      if (invalid && prop.valueStart !== undefined && prop.valueEnd !== undefined) {
        findings.push({
          start: prop.valueStart,
          end: prop.valueEnd,
          message: invalid,
          severity: "warning",
          code: "invalid-value",
        })
      }
    }
  }
  return findings
}

/** A message when the prop is a quoted string that isn't one of `values`. */
function invalidEnumValue(prop: ScannedProp, values: string[] | undefined): string | undefined {
  if (!values || values.length === 0 || prop.valueText === undefined) {
    return undefined
  }
  const quoted = /^(["'])(.*)\1$/s.exec(prop.valueText.trim())
  if (!quoted || !quoted[2].trim() || /#\{/.test(quoted[2]) || values.includes(quoted[2])) {
    return undefined
  }
  return `Invalid value "${quoted[2]}" for prop "${prop.name}". Valid values: ${values
    .map((v) => `"${v}"`)
    .join(", ")}`
}
