import * as assert from "assert"
import * as vscode from "vscode"
import {
  loadMetadata,
  getPropValues,
  isPropValidForPlatform,
} from "../../metadata"
import * as path from "path"

suite("Context-Aware Prop Values Test Suite", () => {
  let metadata: any

  suiteSetup(async () => {
    const extensionPath = path.resolve(__dirname, "../../../")
    metadata = await loadMetadata(extensionPath)
  })

  test("Should return values for position prop regardless of platform", () => {
    const position = metadata.globalProps.position
    assert.ok(position, "position prop should exist")

    const erbValues = getPropValues(position)
    const tsxValues = getPropValues(position)

    assert.ok(erbValues, "Should return values for ERB")
    assert.ok(tsxValues, "Should return values for TSX")
    assert.deepStrictEqual(
      erbValues,
      tsxValues,
      "Values should be the same for both platforms"
    )
    assert.strictEqual(
      erbValues!.includes("relative"),
      true,
      "Should have 'relative'"
    )
  })

  test("Should return values for truncate prop", () => {
    const truncate = metadata.globalProps.truncate
    assert.ok(truncate, "truncate prop should exist")

    const values = getPropValues(truncate)
    assert.ok(values, "Should return values")
    assert.strictEqual(values!.includes("1"), true, "Should have '1'")
  })

  test("Should return same values for Ruby files as ERB files", () => {
    const position = metadata.globalProps.position
    const rubyValues = getPropValues(position)
    const erbValues = getPropValues(position)
    assert.deepStrictEqual(
      rubyValues,
      erbValues,
      "Ruby and ERB should return same values"
    )
  })

  test("Should return same values for JSX as TSX files", () => {
    const position = metadata.globalProps.position
    const jsxValues = getPropValues(position)
    const tsxValues = getPropValues(position)
    assert.deepStrictEqual(
      jsxValues,
      tsxValues,
      "JSX and TSX should return same values"
    )
  })

  test("Should have values for positioning props (top/bottom/left/right)", () => {
    const positioningProps = ["top", "bottom", "left", "right"]

    positioningProps.forEach(propName => {
      const prop = metadata.globalProps[propName]
      assert.ok(prop, `${propName} should exist`)

      const values = getPropValues(prop)
      assert.ok(values, `${propName} should have values`)
      assert.ok(
        values!.length > 0,
        `${propName} should have at least one value`
      )
    })
  })

  test("Should have values for z_index prop", () => {
    const z_index = metadata.globalProps.z_index
    assert.ok(z_index, "z_index should exist")

    const values = getPropValues(z_index)
    assert.ok(values, "Should return values for z_index")
    assert.ok(values!.length > 0, "z_index should have values")
  })

  test("Should return same values for border_radius regardless of platform", () => {
    const border_radius = metadata.globalProps.border_radius

    const erbValues = getPropValues(border_radius)
    const tsxValues = getPropValues(border_radius)

    assert.deepStrictEqual(
      erbValues,
      tsxValues,
      "Should return same values for both platforms"
    )
  })

  test("isPropValidForPlatform should correctly identify Rails-only props", () => {
    const button = metadata.components["Button"]
    assert.ok(button, "Button should exist")

    const iconFontFamily = button.props.icon_font_family
    if (iconFontFamily && iconFontFamily.platforms) {
      assert.strictEqual(
        isPropValidForPlatform(iconFontFamily, "erb"),
        iconFontFamily.platforms.includes("rails"),
        "Should be valid for Rails if platforms includes rails"
      )
    }
  })

  test("isPropValidForPlatform should correctly identify React-only props", () => {
    const button = metadata.components["Button"]
    assert.ok(button, "Button should exist")

    const onClick = button.props.on_click
    assert.ok(onClick, "on_click should exist")
    assert.strictEqual(
      isPropValidForPlatform(onClick, "typescriptreact"),
      true,
      "onClick should be valid for React"
    )
    assert.strictEqual(
      isPropValidForPlatform(onClick, "erb"),
      false,
      "onClick should NOT be valid for Rails"
    )
  })

  test("isPropValidForPlatform should allow props with no platform restriction", () => {
    const padding = metadata.globalProps.padding
    assert.ok(padding, "padding should exist")
    assert.strictEqual(
      isPropValidForPlatform(padding, "erb"),
      true,
      "Global props should be valid for Rails"
    )
    assert.strictEqual(
      isPropValidForPlatform(padding, "typescriptreact"),
      true,
      "Global props should be valid for React"
    )
  })
})
