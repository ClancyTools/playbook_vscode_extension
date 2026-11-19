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
  forms: FormBuilderMetadata = { fields: [] }
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

const FIXABLE = new Set([
  "unknown-prop",
  "invalid-value",
  "unknown-component",
  "deprecated-prop",
  "wrong-prop-case",
])

export class PlaybookQuickFixProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix]

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
    const actions: vscode.CodeAction[] = []
    for (const diagnostic of relevant) {
      const fixes = computeFixes(document.getText(), document.languageId, metadata, [
        {
          code: diagnostic.code as string,
          start: document.offsetAt(diagnostic.range.start),
          end: document.offsetAt(diagnostic.range.end),
        },
      ], forms)
      for (const fix of fixes) {
        const action = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix)
        action.diagnostics = [diagnostic]
        action.isPreferred = fix.preferred
        action.edit = new vscode.WorkspaceEdit()
        action.edit.replace(
          document.uri,
          new vscode.Range(document.positionAt(fix.start), document.positionAt(fix.end)),
          fix.newText
        )
        actions.push(action)
      }
    }
    return actions
  }
}
