import * as assert from "assert"
import * as vscode from "vscode"
import * as path from "path"
import {
  loadMetadata,
  findComponentByRailsName,
  findComponentByReactName,
  findRailsSubcomponent,
  findGlobalPropForComponent,
  generateComponentDocs,
  generatePropDocs,
  isPropValidForPlatform,
  isComponentValidForPlatform,
} from "../../metadata"

suite("Metadata Test Suite", () => {
  let metadata: any

  suiteSetup(async () => {
    const extensionPath = path.resolve(__dirname, "../../../")
    metadata = await loadMetadata(extensionPath)
  })

  test("Should load metadata successfully", () => {
    assert.ok(metadata, "Metadata should be loaded")
    assert.ok(metadata.components, "Metadata should have components")
    assert.ok(
      Object.keys(metadata.components).length > 0,
      "Should have at least one component"
    )
  })

  test("Should find component by Rails name", () => {
    const component = findComponentByRailsName(metadata, "button")
    assert.ok(component, "Should find button component")
    assert.strictEqual(component.rails, "button")
    assert.ok(component.props, "Component should have props")
  })

  test("Should find component by React name", () => {
    const component = findComponentByReactName(metadata, "Button")
    assert.ok(component, "Should find Button component")
    assert.strictEqual(component.react, "Button")
    assert.ok(component.props, "Component should have props")
  })

  test("Should return null for non-existent Rails component", () => {
    const component = findComponentByRailsName(
      metadata,
      "nonexistent_component"
    )
    assert.strictEqual(
      component,
      null,
      "Should return null for non-existent component"
    )
  })

  test("Should return null for non-existent React component", () => {
    const component = findComponentByReactName(metadata, "NonExistentComponent")
    assert.strictEqual(
      component,
      null,
      "Should return null for non-existent component"
    )
  })

  test("Should generate component docs", () => {
    const component = findComponentByRailsName(metadata, "button")
    const docs = generateComponentDocs("Button", component!, metadata)

    assert.ok(docs.length > 0, "Should generate documentation")
    assert.ok(docs.includes("Button"), "Docs should include component name")
  })

  test("Should generate prop docs for enum prop", () => {
    const component = findComponentByRailsName(metadata, "button")
    assert.ok(component, "Button component should exist")

    const variantProp = component.props.variant
    if (variantProp && variantProp.values && variantProp.values.length > 0) {
      const docs = generatePropDocs("variant", variantProp)

      assert.ok(docs.length > 0, "Should generate prop documentation")
      assert.ok(docs.includes("variant"), "Docs should include prop name")
      assert.ok(docs.includes("Type:"), "Docs should include type info")
      assert.ok(
        docs.includes("Values:"),
        "Docs should include valid values for enum"
      )
    }
  })

  test("Should generate prop docs for boolean prop", () => {
    const component = findComponentByRailsName(metadata, "button")
    assert.ok(component, "Button component should exist")

    const boolProp = Object.entries(component.props).find(
      ([_, prop]: [string, any]) => prop.type === "boolean"
    )

    if (boolProp) {
      const [propName, propData] = boolProp
      const docs = generatePropDocs(propName, propData as any)

      assert.ok(docs.length > 0, "Should generate prop documentation")
      assert.ok(docs.includes(propName), "Docs should include prop name")
      assert.ok(docs.includes("boolean"), "Docs should indicate boolean type")
    }
  })

  test("Should include default value in prop docs when available", () => {
    const component = findComponentByRailsName(metadata, "button")
    assert.ok(component, "Button component should exist")

    const propWithDefault = Object.entries(component.props).find(
      ([_, prop]: [string, any]) => prop.default !== undefined
    )

    if (propWithDefault) {
      const [propName, propData] = propWithDefault
      const docs = generatePropDocs(propName, propData as any)

      assert.ok(docs.includes("Default:"), "Docs should include default value")
    }
  })

  test("Should handle component with multiple props", () => {
    const component = findComponentByRailsName(metadata, "button")
    assert.ok(component, "Button component should exist")

    const propCount = Object.keys(component.props).length
    assert.ok(propCount > 0, "Component should have props")

    const docs = generateComponentDocs("Button", component, metadata)
    assert.ok(docs.length > 0, "Docs should be generated")
  })

  test("Should handle Rails and React name mapping", () => {
    const railsComponent = findComponentByRailsName(metadata, "button")
    const reactComponent = findComponentByReactName(metadata, "Button")

    assert.ok(railsComponent, "Should find component by Rails name")
    assert.ok(reactComponent, "Should find component by React name")

    assert.strictEqual(railsComponent.rails, reactComponent.rails)
    assert.strictEqual(railsComponent.react, reactComponent.react)
  })

  test("Should have hardcoded global props (id, data, aria, html_options, children, style)", () => {
    assert.ok(metadata.globalProps, "Metadata should have globalProps")

    const hardcodedProps = [
      "id",
      "data",
      "aria",
      "html_options",
      "children",
      "style",
    ]
    hardcodedProps.forEach(propName => {
      assert.ok(
        metadata.globalProps[propName],
        `Should have ${propName} global prop`
      )
    })
  })

  test("Should have align_items with values from Playbook schema", () => {
    assert.ok(metadata.globalProps, "Metadata should have globalProps")
    assert.ok(
      metadata.globalProps.align_items,
      "Should have align_items global prop"
    )

    const alignItems = metadata.globalProps.align_items
    assert.ok(alignItems.values, "align_items should have values")

    assert.ok(alignItems.values.includes("start"), "Should include 'start'")
    assert.ok(alignItems.values.includes("end"), "Should include 'end'")
    assert.ok(alignItems.values.includes("center"), "Should include 'center'")
  })

  test("Should have global props from Playbook schema", () => {
    assert.ok(metadata.globalProps, "Metadata should have globalProps")

    const expectedProps = [
      "padding",
      "margin",
      "dark",
      "position",
      "vertical_align",
      "text_align",
      "flex_direction",
    ]

    expectedProps.forEach(propName => {
      assert.ok(
        metadata.globalProps[propName],
        `Should have ${propName} global prop from Playbook schema`
      )
    })
  })

  test("Should resolve component name collision (body vs layout/body)", () => {
    const bodyComponent = findComponentByRailsName(metadata, "body")
    assert.ok(bodyComponent, "Should find body component")

    assert.ok(bodyComponent.props, "Body component should have props")
  })

  test("Should have spacing props from Playbook schema", () => {
    assert.ok(metadata.globalProps, "Metadata should have globalProps")

    const spacingProps = ["padding", "padding_top", "margin", "margin_left"]

    spacingProps.forEach(propName => {
      const prop = metadata.globalProps[propName]
      assert.ok(prop, `Should have ${propName}`)
      assert.ok(
        prop.values && prop.values.length > 0,
        `${propName} should have values`
      )
    })
  })

  test("Should have positioning props from Playbook schema", () => {
    assert.ok(metadata.globalProps, "Metadata should have globalProps")

    const positioningProps = ["top", "right", "bottom", "left"]
    positioningProps.forEach(propName => {
      const prop = metadata.globalProps[propName]
      assert.ok(prop, `Should have ${propName}`)
      assert.ok(
        prop.values && prop.values.length > 0,
        `${propName} should have values`
      )
    })
  })

  test("Should have platform info on component props", () => {
    const component = findComponentByRailsName(metadata, "button")
    assert.ok(component, "Button component should exist")

    // onClick should be react-only
    const onClickProp = component.props.on_click
    assert.ok(onClickProp, "Should have on_click prop")
    assert.ok(onClickProp.platforms, "on_click should have platforms")
    assert.ok(
      onClickProp.platforms.includes("react"),
      "on_click should include react"
    )
    assert.ok(
      !onClickProp.platforms.includes("rails"),
      "on_click should NOT include rails"
    )

    // variant should be on both platforms
    const variantProp = component.props.variant
    assert.ok(variantProp, "Should have variant prop")
    assert.ok(variantProp.platforms, "variant should have platforms")
    assert.ok(
      variantProp.platforms.includes("react"),
      "variant should include react"
    )
    assert.ok(
      variantProp.platforms.includes("rails"),
      "variant should include rails"
    )
  })

  test("isPropValidForPlatform should filter by platform", () => {
    const component = findComponentByRailsName(metadata, "button")
    assert.ok(component, "Button component should exist")

    const onClickProp = component.props.on_click
    assert.ok(onClickProp, "Should have on_click prop")

    assert.strictEqual(
      isPropValidForPlatform(onClickProp, "erb"),
      false,
      "onClick should not be valid for Rails"
    )
    assert.strictEqual(
      isPropValidForPlatform(onClickProp, "typescriptreact"),
      true,
      "onClick should be valid for React"
    )

    const variantProp = component.props.variant
    assert.ok(variantProp, "Should have variant prop")
    assert.strictEqual(
      isPropValidForPlatform(variantProp, "erb"),
      true,
      "variant should be valid for Rails"
    )
    assert.strictEqual(
      isPropValidForPlatform(variantProp, "typescriptreact"),
      true,
      "variant should be valid for React"
    )
  })

  test("Should mark a React-only kit invalid for Rails", () => {
    const map = findComponentByRailsName(metadata, "map")
    assert.ok(map, "map component should exist")
    assert.ok(map.platforms?.includes("react"), "map should list react")
    assert.ok(!map.platforms?.includes("rails"), "map should not list rails")

    assert.strictEqual(
      isComponentValidForPlatform(map, "erb"),
      false,
      "map should not be valid for Rails"
    )
    assert.strictEqual(
      isComponentValidForPlatform(map, "typescriptreact"),
      true,
      "map should be valid for React"
    )
  })

  test("Should mark a Rails-only kit invalid for React", () => {
    const form = findComponentByRailsName(metadata, "form")
    assert.ok(form, "form component should exist")

    assert.strictEqual(
      isComponentValidForPlatform(form, "typescriptreact"),
      false,
      "form should not be valid for React"
    )
    assert.strictEqual(
      isComponentValidForPlatform(form, "erb"),
      true,
      "form should be valid for Rails"
    )
  })

  test("Should surface deprecated status on icon_button", () => {
    const iconButton = findComponentByRailsName(metadata, "icon_button")
    assert.ok(iconButton, "icon_button component should exist")
    assert.strictEqual(iconButton.status, "deprecated")

    const docs = generateComponentDocs("IconButton", iconButton, metadata)
    assert.ok(
      docs.includes("Deprecated"),
      "Docs should call out the deprecated status"
    )
  })

  test("Should surface external dependency info on pb_line_graph", () => {
    const lineGraph = findComponentByRailsName(metadata, "pb_line_graph")
    assert.ok(lineGraph, "pb_line_graph component should exist")
    assert.ok(
      lineGraph.externalDependencies?.packages.includes("highcharts"),
      "Should list highcharts as a required package"
    )

    const docs = generateComponentDocs("PbLineGraph", lineGraph, metadata)
    assert.ok(
      docs.includes("highcharts"),
      "Docs should mention the required external package"
    )
  })

  test("Should preserve description/example/responsive on richer global props", () => {
    assert.ok(metadata.globalProps, "Metadata should have globalProps")
    const alignContent = metadata.globalProps.align_content
    assert.ok(alignContent, "Should have align_content global prop")
    assert.ok(alignContent.description, "align_content should have a description")
    assert.ok(alignContent.example, "align_content should have an example")
    assert.strictEqual(alignContent.responsive, true)
  })

  test("Should resolve a Rails subcomponent to its parent kit", () => {
    const subcomponent = findRailsSubcomponent(metadata, "table/table_row")
    assert.ok(subcomponent, "Should resolve table/table_row")
    assert.strictEqual(subcomponent.parent.rails, "table")
    assert.strictEqual(subcomponent.subName, "table_row")
  })

  test("Should not resolve a subcomponent when the parent kit is invalid", () => {
    const subcomponent = findRailsSubcomponent(metadata, "not_a_real_kit/sub")
    assert.strictEqual(subcomponent, null)
  })

  test("Should surface kit category and React import statement", () => {
    const dialog = findComponentByRailsName(metadata, "dialog")
    assert.ok(dialog, "dialog component should exist")
    assert.strictEqual(dialog.category, "alerts_and_dialogs")
    assert.ok(
      dialog.reactImport?.includes("import { Dialog } from 'playbook-ui'"),
      "Should carry the documented React import statement"
    )

    const docs = generateComponentDocs("Dialog", dialog, metadata)
    assert.ok(docs.includes("alerts_and_dialogs"), "Docs should show category")
    assert.ok(
      docs.includes("playbook-ui"),
      "Docs should show the import statement"
    )
  })

  test("Should annotate spacing-token prop values with px equivalents", () => {
    assert.ok(metadata.spacingTokens, "Metadata should have spacingTokens")
    assert.strictEqual(metadata.spacingTokens.md, "24px")

    const padding = metadata.globalProps.padding
    assert.ok(padding, "Should have padding global prop")

    const docs = generatePropDocs("padding", padding, true, metadata)
    assert.ok(docs.includes("24px"), "Docs should show the px value for md")
  })

  test("Should show breakpoint ranges for responsive props", () => {
    assert.ok(metadata.breakpoints, "Metadata should have breakpoints")
    assert.strictEqual(metadata.breakpoints.md, "768px-991px")

    const alignContent = metadata.globalProps.align_content
    assert.ok(alignContent?.responsive, "align_content should be responsive")

    const docs = generatePropDocs("align_content", alignContent, true, metadata)
    assert.ok(
      docs.includes("768px-991px"),
      "Docs should show the md breakpoint range"
    )
  })

  test("Should show nested shape for object-valued global props", () => {
    const hover = metadata.globalProps.hover
    assert.ok(hover, "Should have hover global prop")
    assert.ok(hover.properties, "hover should have nested properties")

    const docs = generatePropDocs("hover", hover, true, metadata)
    assert.ok(docs.includes("shadow"), "Docs should list the nested shape")
  })

  test("Should warn when a prop isn't DOM-safe", () => {
    assert.ok(metadata.domSafeWarning, "Metadata should have domSafeWarning")
    assert.ok(metadata.domSafeWarning.nonSafeProps.includes("marginRight"))

    const marginRight = metadata.globalProps.margin_right
    assert.ok(marginRight, "Should have margin_right global prop")

    const docs = generatePropDocs("margin_right", marginRight, true, metadata)
    assert.ok(
      docs.includes("domSafeProps"),
      "Docs should warn that margin_right isn't DOM-safe"
    )

    const variant = findComponentByRailsName(metadata, "button")!.props.variant
    const variantDocs = generatePropDocs("variant", variant, false, metadata)
    assert.ok(
      !variantDocs.includes("domSafeProps"),
      "variant is not a global prop and should not get the DOM-safety warning"
    )
  })

  test("findGlobalPropForComponent should respect a kit's hasGlobalProps flag", () => {
    const button = findComponentByRailsName(metadata, "button")
    assert.ok(button, "button component should exist")

    const found = findGlobalPropForComponent(metadata, button, "padding")
    assert.ok(found, "Should find padding as a global prop for button")

    const optedOut = { ...button, hasGlobalProps: false }
    const notFound = findGlobalPropForComponent(metadata, optedOut, "padding")
    assert.strictEqual(
      notFound,
      undefined,
      "Should not return a global prop when the kit opts out"
    )
  })
})
