import * as vscode from "vscode"
import {
  FormBuilderMetadata,
  PlaybookMetadata,
  PropMetadata,
  findFormBuilderField,
  loadFormBuilderMetadata,
  camelToSnake,
  getPropDeprecation,
  getPropValues,
  isPropValidForPlatform,
  loadMetadata,
  platformFor,
  snakeToCamel,
} from "./metadata"
import { suggest } from "./suggestions"
import { displayName, resolveComponent, scanUsages } from "./usageRules"
import { migrationForUsage, migrationText } from "./flexAxis"
import { findCombinableSpacing } from "./spacingCombine"
import { findRequiredIndicatorIssues } from "./requiredIndicator"
import { KitColors, kitColorSuggestions, loadKitColors } from "./kitColors"
import { IconIndex, iconSuggestions, loadIconIndex } from "./playbookIcons"
import { ScannedProp, ScannedUsage, scanFormBuilderUsages } from "./usageScanner"

export interface FixRequest {
  /** Diagnostic code: "unknown-prop" | "invalid-value" | "unknown-component" | "deprecated-prop". */
  code: string
  start: number
  end: number
}

export interface Fix {
  title: string
  start: number
  end: number
  newText: string
  /** More edits that belong to the same fix (e.g. removing the second prop of a pair). */
  extraEdits?: Array<{ start: number; end: number; newText: string }>
  /** The best guess; VS Code applies it for "Auto Fix". */
  preferred: boolean
}

const MAX_SUGGESTIONS = 3

/**
 * Edits that resolve Playbook diagnostics ("did you mean margin_bottom?").
 * Pure: offsets in, offsets out, so it can be tested without an editor.
 */
export function computeFixes(
  text: string,
  languageId: string,
  metadata: PlaybookMetadata,
  requests: FixRequest[],
  forms: FormBuilderMetadata = { fields: [] },
  icons?: IconIndex,
  kitColors: KitColors = {}
): Fix[] {
  const usages = [...scanUsages(text, languageId), ...scanFormBuilderUsages(text)]
  const context: FixContext = { metadata, forms, languageId }
  const fixes: Fix[] = []
  for (const request of requests) {
    switch (request.code) {
      case "unknown-prop":
        fixes.push(...unknownPropFixes(usages, context, request))
        break
      case "invalid-value":
        fixes.push(...invalidValueFixes(text, usages, context, request))
        break
      case "unknown-component":
        fixes.push(...unknownComponentFixes(text, languageId, metadata, request))
        break
      case "deprecated-prop":
        fixes.push(...deprecatedPropFixes(usages, context, request))
        break
      case "required-indicator":
      case "double-required-indicator":
        fixes.push(...requiredIndicatorFixes(text, languageId, metadata, forms, request))
        break
      case "combine-spacing":
        fixes.push(...combineSpacingFixes(text, languageId, metadata, request))
        break
      case "unknown-kit-color":
        fixes.push(...unknownKitColorFixes(text, usages, metadata, kitColors, request))
        break
      case "unknown-icon":
        fixes.push(...unknownIconFixes(text, icons, request))
        break
      case "wrong-prop-case":
        fixes.push(...wrongPropCaseFixes(text, request))
        break
    }
  }
  return fixes
}

interface FixContext {
  metadata: PlaybookMetadata
  forms: FormBuilderMetadata
  languageId: string
}

/** The props a usage may pass: a kit's, or a form builder field's, plus globals. */
function propsFor(
  usage: ScannedUsage,
  { metadata, forms }: FixContext
): { props: Record<string, PropMetadata>; globals: boolean } | undefined {
  if (usage.form) {
    const field = findFormBuilderField(forms, usage.component)
    return field ? { props: field.props, globals: true } : undefined
  }
  const component = resolveComponent(metadata, usage)
  return component
    ? { props: component.props, globals: component.hasGlobalProps !== false }
    : undefined
}

function findProp(
  usages: ScannedUsage[],
  predicate: (prop: ScannedProp) => boolean
): { usage: ScannedUsage; prop: ScannedProp } | undefined {
  for (const usage of usages) {
    const prop = usage.props.find(predicate)
    if (prop) {
      return { usage, prop }
    }
  }
  return undefined
}

/** Every prop name valid here on this platform, in the platform's spelling. */
function propNameCandidates(
  available: { props: Record<string, PropMetadata>; globals: boolean },
  metadata: PlaybookMetadata,
  languageId: string
): string[] {
  const platform = platformFor(languageId)
  const names = new Set<string>()
  const add = (snake: string, meta: PropMetadata) => {
    if (isPropValidForPlatform(meta, languageId)) {
      names.add(displayName(snake, platform))
    }
  }
  for (const [snake, meta] of Object.entries(available.props)) {
    add(snake, meta)
  }
  if (available.globals) {
    for (const [snake, meta] of Object.entries(metadata.globalProps || {})) {
      add(snake, meta)
    }
  }
  return Array.from(names)
}

function unknownPropFixes(
  usages: ScannedUsage[],
  context: FixContext,
  request: FixRequest
): Fix[] {
  const found = findProp(usages, (p) => p.nameStart === request.start && p.nameEnd === request.end)
  const available = found && propsFor(found.usage, context)
  if (!found || !available) {
    return []
  }
  const existing = new Set(found.usage.props.map((p) => p.name))
  return suggest(
    found.prop.name,
    propNameCandidates(available, context.metadata, context.languageId)
  )
    .filter((name) => !existing.has(name))
    .slice(0, MAX_SUGGESTIONS)
    .map((name, index) => ({
      title: `Change to "${name}"`,
      start: request.start,
      end: request.end,
      newText: name,
      preferred: index === 0,
    }))
}

function invalidValueFixes(
  text: string,
  usages: ScannedUsage[],
  context: FixContext,
  request: FixRequest
): Fix[] {
  const found = findProp(
    usages,
    (p) =>
      p.valueStart !== undefined &&
      p.valueEnd !== undefined &&
      request.start >= p.valueStart &&
      request.end <= p.valueEnd
  )
  const available = found && propsFor(found.usage, context)
  if (!found || !available) {
    return []
  }
  const snake = found.usage.platform === "react" ? camelToSnake(found.prop.name) : found.prop.name
  const kitProp = available.props[snake] || context.metadata.globalProps?.[snake]
  const values = kitProp && getPropValues(kitProp, context.languageId)
  if (!values) {
    return []
  }

  const written = text.slice(request.start, request.end)
  const quoted = /^(["'])(.*)\1$/s.exec(written)
  if (!quoted) {
    return []
  }
  const [, quote, current] = quoted
  return suggest(current, values)
    .slice(0, MAX_SUGGESTIONS)
    .map((value, index) => ({
      title: `Change to "${value}"`,
      start: request.start,
      end: request.end,
      newText: `${quote}${value}${quote}`,
      preferred: index === 0,
    }))
}

function unknownComponentFixes(
  text: string,
  languageId: string,
  metadata: PlaybookMetadata,
  request: FixRequest
): Fix[] {
  const written = text.slice(request.start, request.end)
  const platform = platformFor(languageId)
  const candidates = Object.values(metadata.components)
    .filter((c) => !c.platforms || c.platforms.includes(platform))
    .map((c) => (platform === "rails" ? c.rails : c.react))
  return suggest(written, candidates)
    .slice(0, MAX_SUGGESTIONS)
    .map((name, index) => ({
      title: `Change to "${name}"`,
      start: request.start,
      end: request.end,
      newText: name,
      preferred: index === 0,
    }))
}

/** Remove a hand-written "*" from a label and let required_indicator draw it. */
function requiredIndicatorFixes(
  text: string,
  languageId: string,
  metadata: PlaybookMetadata,
  forms: FormBuilderMetadata,
  request: FixRequest
): Fix[] {
  const issue = findRequiredIndicatorIssues(text, languageId, metadata, forms).find(
    (i) => i.start === request.start && i.edits.length > 0
  )
  if (!issue?.title) {
    return []
  }
  const [first, ...rest] = issue.edits
  return [{ title: issue.title, start: first.start, end: first.end, newText: first.newText, extraEdits: rest, preferred: true }]
}

/** Merge two side props with the same value into one axis prop. */
function combineSpacingFixes(
  text: string,
  languageId: string,
  metadata: PlaybookMetadata,
  request: FixRequest
): Fix[] {
  const match = findCombinableSpacing(text, languageId, metadata).find((c) => c.start === request.start)
  if (!match) {
    return []
  }
  const [first, ...rest] = match.edits
  return [{ title: match.title, start: first.start, end: first.end, newText: first.newText, extraEdits: rest, preferred: true }]
}

/** Closest color names the kit does define, replacing just the name inside the quotes. */
function unknownKitColorFixes(
  text: string,
  usages: ScannedUsage[],
  metadata: PlaybookMetadata,
  kitColors: KitColors,
  request: FixRequest
): Fix[] {
  const found = findProp(usages, (p) => p.valueStart === request.start && p.valueEnd === request.end)
  const component = found && resolveComponent(metadata, found.usage)
  const quoted = /(["'])([^"']*)\1/.exec(text.slice(request.start, request.end))
  if (!component || !quoted) {
    return []
  }
  const nameStart = request.start + quoted.index + 1
  return kitColorSuggestions(component.rails, quoted[2], kitColors).map((name, index) => ({
    title: `Change to "${name}"`,
    start: nameStart,
    end: nameStart + quoted[2].length,
    newText: name,
    preferred: index === 0,
  }))
}

/** Closest icon names for a typo, replacing just the name inside the value's quotes. */
function unknownIconFixes(text: string, icons: IconIndex | undefined, request: FixRequest): Fix[] {
  if (!icons) {
    return []
  }
  const written = text.slice(request.start, request.end)
  const quoted = /(["'])([^"']*)\1/.exec(written)
  if (!quoted) {
    return []
  }
  const nameStart = request.start + quoted.index + 1
  const nameEnd = nameStart + quoted[2].length
  return iconSuggestions(icons, quoted[2]).map((name, index) => ({
    title: `Change to "${name}"`,
    start: nameStart,
    end: nameEnd,
    newText: name,
    preferred: index === 0,
  }))
}

/** `margin_bottom` → `marginBottom` for a React prop written Rails-style. */
function wrongPropCaseFixes(text: string, request: FixRequest): Fix[] {
  const camel = snakeToCamel(text.slice(request.start, request.end))
  return [
    {
      title: `Change to "${camel}"`,
      start: request.start,
      end: request.end,
      newText: camel,
      preferred: true,
    },
  ]
}

function deprecatedPropFixes(
  usages: ScannedUsage[],
  { metadata, languageId }: FixContext,
  request: FixRequest
): Fix[] {
  const found = findProp(usages, (p) => p.nameStart === request.start && p.nameEnd === request.end)
  const component = found && resolveComponent(metadata, found.usage)
  if (!found || !component) {
    return []
  }
  const migrated = migrationForUsage(found.usage, component, found.prop)
  if (migrated) {
    // horizontal/vertical/spacing swap roles with orientation, so the whole
    // prop (name and value) is rewritten: horizontal="center" -> justify="center".
    const text = migrationText(migrated.migration, found.usage.platform)
    return [
      {
        title: `Replace with ${text} (orientation is ${migrated.resolved.orientation})`,
        start: request.start,
        end: found.prop.valueEnd ?? request.end,
        newText: text,
        preferred: true,
      },
    ]
  }
  const snake = found.usage.platform === "react" ? camelToSnake(found.prop.name) : found.prop.name
  const replacement = getPropDeprecation(component, snake, languageId)?.replacement
  if (!replacement) {
    return []
  }
  const name = displayName(replacement, found.usage.platform)
  return [
    {
      title: `Replace with "${name}"`,
      start: request.start,
      end: request.end,
      newText: name,
      preferred: true,
    },
  ]
}

const FIX_ALL_KIND = vscode.CodeActionKind.SourceFixAll.append("playbook")

const FIXABLE = new Set([
  "unknown-prop",
  "invalid-value",
  "unknown-component",
  "deprecated-prop",
  "wrong-prop-case",
  "unknown-icon",
  "unknown-kit-color",
  "combine-spacing",
  "required-indicator",
  "double-required-indicator",
])

export class PlaybookQuickFixProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
    vscode.CodeActionKind.SourceFixAll.append("playbook"),
  ]

  constructor(private readonly extensionPath: string) {}

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const relevant = context.diagnostics.filter(
      (d) => d.source === "Playbook" && typeof d.code === "string" && FIXABLE.has(d.code)
    )
    if (relevant.length === 0) {
      return []
    }

    const metadata = loadMetadata(this.extensionPath)
    const forms = loadFormBuilderMetadata(this.extensionPath)
    const icons = loadIconIndex()
    const kitColors = loadKitColors(this.extensionPath)
    const actions: vscode.CodeAction[] = []
    for (const diagnostic of relevant) {
      const fixes = computeFixes(document.getText(), document.languageId, metadata, [
        {
          code: diagnostic.code as string,
          start: document.offsetAt(diagnostic.range.start),
          end: document.offsetAt(diagnostic.range.end),
        },
      ], forms, icons, kitColors)
      for (const fix of fixes) {
        const action = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix)
        action.diagnostics = [diagnostic]
        action.isPreferred = fix.preferred
        action.edit = new vscode.WorkspaceEdit()
        for (const edit of [{ start: fix.start, end: fix.end, newText: fix.newText }, ...(fix.extraEdits ?? [])]) {
          action.edit.replace(
            document.uri,
            new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)),
            edit.newText
          )
        }
        actions.push(action)
      }
    }
    return actions.concat(this.combineAllActions(document, metadata, context))
  }

  /**
   * "Combine all N paired spacing props in this file", as a quick fix when one of
   * them is in view and as a source.fixAll.playbook action (for codeActionsOnSave).
   */
  private combineAllActions(
    document: vscode.TextDocument,
    metadata: PlaybookMetadata,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    // Only when asked for our own kind, so a generic source.fixAll on save never rewrites code unasked.
    const asFixAll = !!context.only && FIX_ALL_KIND.contains(context.only)
    const hasHint = context.diagnostics.some((d) => d.code === "combine-spacing")
    if (!hasHint && !asFixAll) {
      return []
    }
    const all = findCombinableSpacing(document.getText(), document.languageId, metadata)
    if (all.length < (asFixAll ? 1 : 2)) {
      return []
    }
    const action = new vscode.CodeAction(
      `Combine all ${all.length} paired spacing props in this file`,
      asFixAll ? FIX_ALL_KIND : vscode.CodeActionKind.QuickFix
    )
    action.edit = new vscode.WorkspaceEdit()
    for (const edit of all.flatMap((c) => c.edits)) {
      action.edit.replace(
        document.uri,
        new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)),
        edit.newText
      )
    }
    return [action]
  }
}
