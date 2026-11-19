import { ComponentMetadata, Platform, camelToSnake, snakeToCamel } from "./metadata"
import { literalValue, ScannedProp, ScannedUsage } from "./usageScanner"

/**
 * Which way `justify` and `align` point.
 *
 * In Playbook's Flex (verified in pb_flex/flex.rb, _flex.tsx and _flex.scss):
 *   justify  = justify-content = the MAIN axis   (horizontal in a row, vertical in a column)
 *   align    = align-items     = the CROSS axis  (vertical in a row, horizontal in a column)
 * `orientation` defaults to "row". The global justifyContent / alignItems props
 * follow the same rule, with flexDirection (default row) in place of orientation.
 *
 * The deprecated horizontal / vertical props swap roles with orientation, which
 * is why they were so easy to get wrong.
 *
 * Pure logic, no VS Code dependency.
 */

export type Orientation = "row" | "column"
export type AxisRole = "main" | "cross"

export interface ResolvedOrientation {
  orientation: Orientation
  /** True when it is the default rather than written in the code. */
  isDefault: boolean
}

export function isFlexKit(component: ComponentMetadata): boolean {
  return component.rails === "flex"
}

function findProp(usage: ScannedUsage, camelName: string): ScannedProp | undefined {
  return usage.props.find((p) => snakeToCamel(p.name) === camelName)
}

/**
 * The orientation a usage has, or undefined when it can't be known from the
 * code (a variable, a responsive object, a spread, or conflicting props).
 */
export function resolveOrientation(
  usage: ScannedUsage,
  component: ComponentMetadata
): ResolvedOrientation | undefined {
  if (usage.hasSpread) {
    return undefined
  }
  const direction = findProp(usage, "flexDirection")

  if (isFlexKit(component)) {
    if (direction) {
      return undefined // Flex's own orientation and a global flexDirection could disagree
    }
    const orientation = findProp(usage, "orientation")
    if (!orientation) {
      return { orientation: "row", isDefault: true }
    }
    const value = literalValue(orientation)
    return value === "row" || value === "column" ? { orientation: value, isDefault: false } : undefined
  }

  if (!direction) {
    return { orientation: "row", isDefault: true }
  }
  const value = literalValue(direction)
  if (typeof value !== "string") {
    return undefined
  }
  const normalized = snakeToCamel(value)
  if (normalized === "row" || normalized === "rowReverse") {
    return { orientation: "row", isDefault: false }
  }
  if (normalized === "column" || normalized === "columnReverse") {
    return { orientation: "column", isDefault: false }
  }
  return undefined
}

/** Which axis a prop positions along, for this kit; undefined if it isn't an axis prop. */
export function axisRole(component: ComponentMetadata, snakeProp: string): AxisRole | undefined {
  if (snakeProp === "justify_content") {
    return "main"
  }
  if (snakeProp === "align_items") {
    return "cross"
  }
  if (isFlexKit(component)) {
    if (snakeProp === "justify") {
      return "main"
    }
    if (snakeProp === "align") {
      return "cross"
    }
  }
  return undefined
}

type Position = "start" | "end" | "center" | "between" | "around" | "evenly" | "stretch" | "baseline"

const POSITIONS: Record<string, Position> = {
  start: "start",
  flexStart: "start",
  left: "start",
  top: "start",
  end: "end",
  flexEnd: "end",
  right: "end",
  bottom: "end",
  center: "center",
  between: "between",
  spaceBetween: "between",
  around: "around",
  spaceAround: "around",
  evenly: "evenly",
  spaceEvenly: "evenly",
  stretch: "stretch",
  baseline: "baseline",
}

function position(value: string): Position | undefined {
  return POSITIONS[snakeToCamel(value)]
}

/** True when the role runs left-right for this orientation. */
export function isHorizontal(role: AxisRole, orientation: Orientation): boolean {
  return (role === "main") === (orientation === "row")
}

/** A short description of where `value` puts the items, e.g. "↔ left" or "↕ middle". */
export function axisLabel(role: AxisRole, orientation: Orientation, value: string): string | undefined {
  const pos = position(value)
  if (!pos) {
    return undefined
  }
  const horizontal = isHorizontal(role, orientation)
  const arrow = horizontal ? "↔" : "↕"

  let text: string | undefined
  switch (pos) {
    case "start":
      text = horizontal ? "left" : "top"
      break
    case "end":
      text = horizontal ? "right" : "bottom"
      break
    case "center":
      text = horizontal ? "center" : "middle"
      break
    case "between":
      text = role === "main" ? "space between" : undefined
      break
    case "around":
      text = role === "main" ? "space around" : undefined
      break
    case "evenly":
      text = role === "main" ? "space evenly" : undefined
      break
    case "stretch":
      text = role === "cross" ? (horizontal ? "full width" : "full height") : "stretch"
      break
    case "baseline":
      text = role === "cross" ? "baseline" : undefined
      break
  }
  return text ? `${arrow} ${text}` : undefined
}

const DIRECTION_WORDS: Record<Orientation, { main: string; cross: string }> = {
  row: { main: "horizontally (left → right)", cross: "vertically (top → bottom)" },
  column: { main: "vertically (top → bottom)", cross: "horizontally (left → right)" },
}

/**
 * Hover text for an axis prop (justify, align, justifyContent, alignItems) or
 * for orientation / flexDirection itself, given what the usage resolves to.
 */
export function axisGuidanceLines(
  component: ComponentMetadata,
  snakeProp: string,
  resolved: ResolvedOrientation | undefined,
  platform: Platform = "react"
): string[] {
  const flex = isFlexKit(component)
  const n = (snake: string) => (platform === "rails" ? snake : snakeToCamel(snake))
  const directionProp = flex ? "orientation" : n("flex_direction")

  if (snakeProp === "orientation" && flex) {
    return [
      "**Axis:** `orientation` decides which way `justify` and `align` point. " +
        "In `row` (the default) `justify` is horizontal and `align` is vertical; in `column` they swap.",
    ]
  }
  if (snakeProp === "flex_direction" && !flex) {
    const [justify, align] = [n("justify_content"), n("align_items")]
    return [
      `**Axis:** \`${directionProp}\` decides which way \`${justify}\` and \`${align}\` point. ` +
        `In \`row\` (the default) \`${justify}\` is horizontal and \`${align}\` is vertical; in \`column\` they swap.`,
    ]
  }

  const role = axisRole(component, snakeProp)
  if (!role) {
    return []
  }
  const name = n(snakeProp)
  const css = role === "main" ? "justify-content" : "align-items"
  const roleWord = role === "main" ? "main" : "cross"
  const lead = `**Axis:** \`${name}\` follows the **${roleWord} axis** (CSS \`${css}\`).`

  if (!resolved) {
    return [
      `${lead} It is horizontal when \`${directionProp}\` is \`row\` (the default) and vertical when it is \`column\`; ` +
        `this one can't be worked out from the code.`,
    ]
  }
  const { orientation, isDefault } = resolved
  const direction = DIRECTION_WORDS[orientation][roleWord]
  const horizontal = isHorizontal(role, orientation)
  const ends = horizontal ? "`start` = left, `end` = right" : "`start` = top, `end` = bottom"
  const source = isDefault
    ? `\`${directionProp}\` isn't set, so it is \`${orientation}\` (the default)`
    : `\`${directionProp}\` is \`${orientation}\``
  const lines = [`${lead} Here ${source}, so it positions items **${direction}**: ${ends}.`]
  if (!flex) {
    lines.push(`Takes effect only on a flex container: set \`${n("display")}\` to \`flex\` unless the kit already is one.`)
  }
  return lines
}

/** A label for each orientation, for when a usage's orientation can't be known. */
export function axisLabelBothWays(role: AxisRole, value: string): string | undefined {
  const row = axisLabel(role, "row", value)
  const column = axisLabel(role, "column", value)
  return row && column ? `row ${row} · column ${column}` : undefined
}

export interface FlexMigration {
  prop: "justify" | "align"
  value: string
}

const SPACING_VALUES = new Set(["around", "between", "evenly"])

/**
 * What a deprecated Flex prop should become, or undefined if it has no
 * equivalent. Verified against pb_flex/flex.rb and _flex.scss:
 *   spacing=X               → justify=X   (identical CSS)
 *   row:    horizontal→justify, vertical→align
 *   column: horizontal→align,   vertical→justify
 * `horizontal="stretch"` in a row and `vertical="stretch"|"baseline"` in a
 * column generate no CSS at all, so there is nothing to migrate them to.
 */
export function flexMigration(
  snakeProp: string,
  value: string,
  orientation: Orientation
): FlexMigration | undefined {
  if (snakeProp === "spacing") {
    return SPACING_VALUES.has(value) ? { prop: "justify", value } : undefined
  }
  if (snakeProp !== "horizontal" && snakeProp !== "vertical") {
    return undefined
  }
  const prop: "justify" | "align" =
    (snakeProp === "horizontal") === (orientation === "row") ? "justify" : "align"

  const named: Record<string, string> = {
    left: "start",
    top: "start",
    right: "end",
    bottom: "end",
    center: "center",
    stretch: "stretch",
    baseline: "baseline",
  }
  const mapped = named[value]
  if (!mapped) {
    return undefined
  }
  // justify-content has no stretch or baseline class in Flex.
  if (prop === "justify" && (mapped === "stretch" || mapped === "baseline")) {
    return undefined
  }
  // baseline is only an align-items value.
  return { prop, value: mapped }
}

const DEPRECATED_FLEX_PROPS = ["horizontal", "vertical", "spacing"]

/**
 * The replacement for a deprecated Flex prop in this usage, with the
 * orientation it was worked out from. Undefined when the value has no
 * equivalent, the orientation is unknown, or the replacement prop is already
 * set (or would be set twice by two deprecated props).
 */
export function migrationForUsage(
  usage: ScannedUsage,
  component: ComponentMetadata,
  prop: ScannedProp
): { migration: FlexMigration; resolved: ResolvedOrientation } | undefined {
  if (!isFlexKit(component)) {
    return undefined
  }
  const snakeOf = (p: ScannedProp) => (usage.platform === "react" ? camelToSnake(p.name) : p.name)
  const snake = snakeOf(prop)
  const value = literalValue(prop)
  const resolved = resolveOrientation(usage, component)
  if (!DEPRECATED_FLEX_PROPS.includes(snake) || typeof value !== "string" || !resolved) {
    return undefined
  }
  const migration = flexMigration(snake, value, resolved.orientation)
  if (!migration) {
    return undefined
  }
  for (const other of usage.props) {
    if (other === prop) {
      continue
    }
    const otherSnake = snakeOf(other)
    if (otherSnake === migration.prop) {
      return undefined // the replacement is already set
    }
    const otherValue = literalValue(other)
    if (
      DEPRECATED_FLEX_PROPS.includes(otherSnake) &&
      typeof otherValue === "string" &&
      flexMigration(otherSnake, otherValue, resolved.orientation)?.prop === migration.prop
    ) {
      return undefined // two deprecated props would both become the same prop
    }
  }
  return { migration, resolved }
}

/** `justify="start"` (React) or `justify: "start"` (Rails). */
export function migrationText(migration: FlexMigration, platform: Platform): string {
  return platform === "rails"
    ? `${migration.prop}: "${migration.value}"`
    : `${migration.prop}="${migration.value}"`
}
