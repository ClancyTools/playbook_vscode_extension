import * as vscode from "vscode"

/**
 * Every feature can be turned off. Switches live under `playbook.*`, all on by
 * default, with `playbook.enabled` as a master that turns everything off at once.
 *
 *   playbook.enabled
 *   playbook.hover.{enabled,kitGuidance,globalProps,valuePreviews}
 *   playbook.completion.{enabled,presets,icons}
 *   playbook.diagnostics.{enabled,validation,propOrder,<each rule>}
 *   playbook.quickFixes.enabled
 *   playbook.flexAxis.enabled          (axis hints, hover, completion detail, migration)
 *   playbook.{spacingHints,axisHints,colorSwatches}
 *   playbook.{definition,statusBar,kitBrowser}.enabled
 */
export function setting<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration("playbook").get<T>(key, fallback)
}

/** True when the master switch and every given switch (e.g. "hover.enabled") are on. */
export function enabled(...keys: string[]): boolean {
  return setting<boolean>("enabled", true) && keys.every((key) => setting<boolean>(key, true))
}
