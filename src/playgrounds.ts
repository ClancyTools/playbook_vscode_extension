import { readAiJson } from "./aiData"

/** A named example configuration for a kit, from Playbook's playground metadata. */
export interface Preset {
  name: string
  props: Record<string, unknown>
  structureMode?: string
}

/** "Only meaningful when…" rules between props. Keys are camelCase prop names. */
export interface Conditional {
  /** Another prop that must be set (string) or props that must equal a value (object). */
  requires?: string | Record<string, unknown>
  structureMode?: string
  hides?: string
}

export interface Hint {
  when?: Record<string, unknown>
  presetName?: string
  message: string
  type?: "info" | "warning"
}

export interface Playground {
  presets?: Preset[]
  hints?: Record<string, Hint>
  conditionals?: Record<string, Conditional>
  customProps?: Record<string, unknown>
}

/** The playground for a kit, by its Rails name (`button`, `advanced_table`). */
export function loadPlayground(extensionPath: string, railsName: string): Playground | undefined {
  if (!/^[a-z0-9_]+$/.test(railsName)) {
    return undefined
  }
  return readAiJson<Playground>(extensionPath, `playgrounds/${railsName}.json`)
}
