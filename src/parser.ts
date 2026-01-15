import * as vscode from "vscode"

export interface ComponentUsage {
  componentName: string
  range: vscode.Range
  type: "rails" | "react"
}

export interface PropUsage {
  propName: string
  range: vscode.Range
  value?: string
  valueRange?: vscode.Range
}

/**
 * Parse Rails/ERB pb_rails call to extract component name
 * Example: pb_rails("button", props: {...})
 */
export function parseRailsComponent(
  document: vscode.TextDocument,
  position: vscode.Position
): ComponentUsage | null {
  const line = document.lineAt(position.line).text
  const lineRange = document.lineAt(position.line).range

  // Match pb_rails("component_name", ...)
  const regex = /pb_rails\(\s*["']([^"']+)["']/g
  let match

  while ((match = regex.exec(line)) !== null) {
    const componentName = match[1]
    const startIndex = match.index + match[0].indexOf(componentName)
    const endIndex = startIndex + componentName.length

    // Check if cursor is within component name
    const startPos = new vscode.Position(position.line, startIndex)
    const endPos = new vscode.Position(position.line, endIndex)
    const range = new vscode.Range(startPos, endPos)

    if (position.character >= startIndex && position.character <= endIndex) {
      return {
        componentName,
        range,
        type: "rails"
      }
    }
  }

  return null
}

/**
 * Parse React component tag to extract component name
 * Example: <Button ... /> or <Button>...</Button>
 */
export function parseReactComponent(
  document: vscode.TextDocument,
  position: vscode.Position
): ComponentUsage | null {
  const line = document.lineAt(position.line).text

  // Match opening tags: <ComponentName or closing tags: </ComponentName>
  const regex = /<\/?([A-Z][a-zA-Z0-9]*)/g
  let match

  while ((match = regex.exec(line)) !== null) {
    const componentName = match[1]
    const startIndex = match.index + match[0].indexOf(componentName)
    const endIndex = startIndex + componentName.length

    // Check if cursor is within component name
    if (position.character >= startIndex && position.character <= endIndex) {
      const startPos = new vscode.Position(position.line, startIndex)
      const endPos = new vscode.Position(position.line, endIndex)
      const range = new vscode.Range(startPos, endPos)

      return {
        componentName,
        range,
        type: "react"
      }
    }
  }

  return null
}

/**
 * Parse Rails props from pb_rails call
 * Example: pb_rails("button", props: { variant: "primary", text: "Click" })
 */
export function parseRailsProps(
  document: vscode.TextDocument,
  position: vscode.Position
): PropUsage | null {
  const lineText = document.lineAt(position.line).text

  // Match prop: value patterns within the current line
  const propRegex = /(\w+):\s*["']?([^"',}]+)["']?/g
  let match

  while ((match = propRegex.exec(lineText)) !== null) {
    const propName = match[1]
    const propValue = match[2].trim()
    const startIndex = match.index
    const endIndex = startIndex + propName.length

    // Check if cursor is on the prop name
    if (position.character >= startIndex && position.character <= endIndex) {
      const startPos = new vscode.Position(position.line, startIndex)
      const endPos = new vscode.Position(position.line, endIndex)
      const range = new vscode.Range(startPos, endPos)

      return {
        propName,
        range,
        value: propValue
      }
    }
  }

  return null
}

/**
 * Parse React props from JSX
 * Example: <Button variant="primary" text="Click" />
 */
export function parseReactProps(
  document: vscode.TextDocument,
  position: vscode.Position
): PropUsage | null {
  const lineText = document.lineAt(position.line).text

  // Match prop="value" or prop={value} patterns
  const propRegex = /(\w+)=(?:["']([^"']+)["']|\{([^}]+)\})/g
  let match

  while ((match = propRegex.exec(lineText)) !== null) {
    const propName = match[1]
    const propValue = match[2] || match[3]
    const startIndex = match.index
    const endIndex = startIndex + propName.length

    // Check if cursor is on the prop name
    if (position.character >= startIndex && position.character <= endIndex) {
      const startPos = new vscode.Position(position.line, startIndex)
      const endPos = new vscode.Position(position.line, endIndex)
      const range = new vscode.Range(startPos, endPos)

      return {
        propName,
        range,
        value: propValue?.trim()
      }
    }
  }

  return null
}

/**
 * Find the component context for the current position
 * This helps find which component a prop belongs to
 */
export function findComponentContext(
  document: vscode.TextDocument,
  position: vscode.Position
): ComponentUsage | null {
  // Search backwards from current position to find the component
  for (let line = position.line; line >= Math.max(0, position.line - 10); line--) {
    const tempPos = new vscode.Position(line, 0)

    // Try Rails
    const railsComponent = parseRailsComponent(
      document,
      new vscode.Position(line, document.lineAt(line).text.length / 2)
    )
    if (railsComponent) {
      return railsComponent
    }

    // Try React
    const reactComponent = parseReactComponent(
      document,
      new vscode.Position(line, document.lineAt(line).text.length / 2)
    )
    if (reactComponent) {
      return reactComponent
    }
  }

  return null
}
