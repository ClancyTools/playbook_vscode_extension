import * as assert from "assert"
import * as path from "path"
import * as vscode from "vscode"
import { AxisHints, axisAnnotations } from "../../axisHints"
import { PlaybookCompletionProvider } from "../../completionProvider"
import { PlaybookDiagnostics } from "../../diagnostics"
import {
  axisGuidanceLines,
  axisLabel,
  axisLabelBothWays,
  axisRole,
  flexMigration,
  isHorizontal,
  migrationForUsage,
  resolveOrientation,
} from "../../flexAxis"
import { PlaybookHoverProvider } from "../../hoverProvider"
import { ComponentMetadata, findComponentByRailsName, loadMetadata, PlaybookMetadata } from "../../metadata"
import { PlaybookQuickFixProvider } from "../../quickFixes"
import { scanRailsUsages, scanReactUsages } from "../../usageScanner"
import {
  createCancellationToken,
  createCompletionContext,
  createTestDocument,
  getCompletionItems,
} from "./testHelpers"

suite("Flex Axis Test Suite", () => {
  const extensionPath = path.resolve(__dirname, "../../../")
  let metadata: PlaybookMetadata
  let flex: ComponentMetadata
  let card: ComponentMetadata

  suiteSetup(() => {
    metadata = loadMetadata(extensionPath)
    flex = findComponentByRailsName(metadata, "flex")!
    card = findComponentByRailsName(metadata, "card")!
  })

  const react = (text: string) => scanReactUsages(text)[0]
  const rails = (text: string) => scanRailsUsages(text)[0]

  suite("resolveOrientation", () => {
    test("a Flex with no orientation is a row by default", () => {
      assert.deepStrictEqual(resolveOrientation(react('<Flex justify="center" />'), flex), {
        orientation: "row",
        isDefault: true,
      })
    })

    test("reads a written orientation", () => {
      assert.deepStrictEqual(resolveOrientation(react('<Flex orientation="column" />'), flex), {
        orientation: "column",
        isDefault: false,
      })
      assert.strictEqual(resolveOrientation(react("<Flex orientation={'row'} />"), flex)?.orientation, "row")
    })

    test("reads a Rails orientation", () => {
      const usage = rails('<%= pb_rails("flex", props: { orientation: "column" }) %>')
      assert.strictEqual(resolveOrientation(usage, flex)?.orientation, "column")
    })

    test("is unknown for a variable, a spread or a conflicting flexDirection", () => {
      assert.strictEqual(resolveOrientation(react("<Flex orientation={dir} />"), flex), undefined)
      assert.strictEqual(resolveOrientation(react("<Flex {...rest} />"), flex), undefined)
      assert.strictEqual(
        resolveOrientation(react('<Flex orientation="row" flexDirection="column" />'), flex),
        undefined
      )
    })

    test("other kits use flexDirection, defaulting to row", () => {
      assert.deepStrictEqual(resolveOrientation(react('<Card alignItems="center" />'), card), {
        orientation: "row",
        isDefault: true,
      })
    })

    test("understands flexDirection values including the reverse ones and Rails spelling", () => {
      const direction = (text: string) => resolveOrientation(react(text), card)?.orientation
      assert.strictEqual(direction('<Card flexDirection="column" />'), "column")
      assert.strictEqual(direction('<Card flexDirection="columnReverse" />'), "column")
      assert.strictEqual(direction('<Card flexDirection="rowReverse" />'), "row")
      const railsUsage = rails('<%= pb_rails("card", props: { flex_direction: "column_reverse" }) %>')
      assert.strictEqual(resolveOrientation(railsUsage, card)?.orientation, "column")
    })

    test("a responsive flexDirection can't be resolved", () => {
      assert.strictEqual(
        resolveOrientation(react('<Card flexDirection={{ default: "row", md: "column" }} />'), card),
        undefined
      )
    })
  })

  suite("axisRole", () => {
    test("justify and align are Flex-only; justifyContent and alignItems work on any kit", () => {
      assert.strictEqual(axisRole(flex, "justify"), "main")
      assert.strictEqual(axisRole(flex, "align"), "cross")
      assert.strictEqual(axisRole(flex, "justify_content"), "main")
      assert.strictEqual(axisRole(card, "justify_content"), "main")
      assert.strictEqual(axisRole(card, "align_items"), "cross")
      assert.strictEqual(axisRole(card, "justify"), undefined)
      assert.strictEqual(axisRole(card, "align"), undefined)
    })

    test("ignores other props", () => {
      assert.strictEqual(axisRole(flex, "orientation"), undefined)
      assert.strictEqual(axisRole(flex, "align_self"), undefined)
    })
  })

  suite("axisLabel", () => {
    test("main axis in a row is horizontal", () => {
      assert.strictEqual(axisLabel("main", "row", "start"), "↔ left")
      assert.strictEqual(axisLabel("main", "row", "center"), "↔ center")
      assert.strictEqual(axisLabel("main", "row", "end"), "↔ right")
    })

    test("cross axis in a row is vertical", () => {
      assert.strictEqual(axisLabel("cross", "row", "start"), "↕ top")
      assert.strictEqual(axisLabel("cross", "row", "center"), "↕ middle")
      assert.strictEqual(axisLabel("cross", "row", "end"), "↕ bottom")
      assert.strictEqual(axisLabel("cross", "row", "stretch"), "↕ full height")
    })

    test("a column swaps the axes", () => {
      assert.strictEqual(axisLabel("main", "column", "start"), "↕ top")
      assert.strictEqual(axisLabel("main", "column", "center"), "↕ middle")
      assert.strictEqual(axisLabel("cross", "column", "start"), "↔ left")
      assert.strictEqual(axisLabel("cross", "column", "end"), "↔ right")
      assert.strictEqual(axisLabel("cross", "column", "stretch"), "↔ full width")
    })

    test("spacing values only make sense on the main axis", () => {
      assert.strictEqual(axisLabel("main", "row", "between"), "↔ space between")
      assert.strictEqual(axisLabel("main", "column", "around"), "↕ space around")
      assert.strictEqual(axisLabel("main", "row", "evenly"), "↔ space evenly")
      assert.strictEqual(axisLabel("cross", "row", "between"), undefined)
    })

    test("baseline is a cross-axis value", () => {
      assert.strictEqual(axisLabel("cross", "row", "baseline"), "↕ baseline")
      assert.strictEqual(axisLabel("main", "row", "baseline"), undefined)
    })

    test("accepts the global props' camelCase and snake_case spellings", () => {
      assert.strictEqual(axisLabel("main", "row", "spaceBetween"), "↔ space between")
      assert.strictEqual(axisLabel("main", "row", "space_between"), "↔ space between")
      assert.strictEqual(axisLabel("cross", "row", "flexStart"), "↕ top")
      assert.strictEqual(axisLabel("cross", "row", "flex_end"), "↕ bottom")
    })

    test("returns nothing for none and unknown values", () => {
      assert.strictEqual(axisLabel("main", "row", "none"), undefined)
      assert.strictEqual(axisLabel("main", "row", "sideways"), undefined)
    })

    test("describes both orientations when it is unknown", () => {
      assert.strictEqual(axisLabelBothWays("main", "center"), "row ↔ center · column ↕ middle")
      assert.strictEqual(axisLabelBothWays("main", "sideways"), undefined)
    })

    test("isHorizontal follows the role and orientation", () => {
      assert.ok(isHorizontal("main", "row") && isHorizontal("cross", "column"))
      assert.ok(!isHorizontal("main", "column") && !isHorizontal("cross", "row"))
    })
  })

  suite("axisGuidanceLines", () => {
    test("explains justify for the resolved orientation", () => {
      const [line] = axisGuidanceLines(flex, "justify", { orientation: "row", isDefault: true })
      assert.ok(line.includes("main axis") && line.includes("justify-content"), line)
      assert.ok(line.includes("isn't set") && line.includes("the default"), line)
      assert.ok(line.includes("horizontally") && line.includes("`start` = left"), line)
    })

    test("explains align in a column", () => {
      const [line] = axisGuidanceLines(flex, "align", { orientation: "column", isDefault: false })
      assert.ok(line.includes("cross axis") && line.includes("align-items"), line)
      assert.ok(line.includes("`orientation` is `column`"), line)
      assert.ok(line.includes("horizontally") && line.includes("`start` = left"), line)
    })

    test("says when the orientation can't be worked out", () => {
      const [line] = axisGuidanceLines(flex, "justify", undefined)
      assert.ok(line.includes("can't be worked out"), line)
    })

    test("explains orientation and flexDirection themselves", () => {
      assert.ok(axisGuidanceLines(flex, "orientation", undefined)[0].includes("they swap"))
      assert.ok(axisGuidanceLines(card, "flex_direction", undefined)[0].includes("justifyContent"))
    })

    test("uses Rails spelling for Rails files", () => {
      const lines = axisGuidanceLines(card, "justify_content", { orientation: "row", isDefault: true }, "rails")
      assert.ok(lines[0].includes("`justify_content`") && lines[0].includes("`flex_direction`"), lines[0])
    })

    test("warns that global props need a flex container", () => {
      const lines = axisGuidanceLines(card, "align_items", { orientation: "row", isDefault: true })
      assert.ok(lines.some((l) => l.includes("flex container")), lines.join("|"))
    })

    test("has nothing to say about other props", () => {
      assert.deepStrictEqual(axisGuidanceLines(flex, "gap", undefined), [])
    })
  })

  suite("axisAnnotations", () => {
    const annotate = (languageId: string, text: string) =>
      axisAnnotations(text, languageId, metadata).map((a) => ({
        label: a.label,
        before: text.slice(0, a.offset).slice(-8),
      }))

    test("a row: justify is horizontal, align is vertical", () => {
      assert.deepStrictEqual(annotate("typescriptreact", '<Flex justify="center" align="center" />'), [
        { label: "↔ center", before: 'y="center' + '"' },
        { label: "↕ middle", before: 'n="center' + '"' },
      ].map((e) => ({ label: e.label, before: e.before.slice(-8) })))
    })

    test("a column swaps them", () => {
      const labels = annotate("typescriptreact", '<Flex orientation="column" justify="start" align="end" />').map(
        (a) => a.label
      )
      assert.deepStrictEqual(labels, ["↕ top", "↔ right"])
    })

    test("works in Rails", () => {
      const labels = annotate(
        "erb",
        '<%= pb_rails("flex", props: { orientation: "column", justify: "between", align: "center" }) %>'
      ).map((a) => a.label)
      assert.deepStrictEqual(labels, ["↕ space between", "↔ center"])
    })

    test("works for global justifyContent / alignItems with flexDirection", () => {
      const labels = annotate(
        "typescriptreact",
        '<Card display="flex" flexDirection="column" justifyContent="spaceBetween" alignItems="center" />'
      ).map((a) => a.label)
      assert.deepStrictEqual(labels, ["↕ space between", "↔ center"])
    })

    test("places the hint right after the value, including when it is in braces", () => {
      const text = '<Flex justify={"end"} />'
      const [annotation] = axisAnnotations(text, "typescriptreact", metadata)
      assert.strictEqual(text.slice(0, annotation.offset), '<Flex justify={"end"}')
    })

    test("says nothing when the orientation is dynamic", () => {
      assert.deepStrictEqual(annotate("typescriptreact", '<Flex orientation={dir} justify="center" />'), [])
      assert.deepStrictEqual(annotate("typescriptreact", '<Flex {...rest} justify="center" />'), [])
    })

    test("says nothing for dynamic values, none, or kits without these props", () => {
      assert.deepStrictEqual(annotate("typescriptreact", "<Flex justify={where} />"), [])
      assert.deepStrictEqual(annotate("typescriptreact", '<Flex justify="none" />'), [])
      assert.deepStrictEqual(annotate("typescriptreact", '<Card justify="center" />'), [])
      assert.deepStrictEqual(annotate("typescriptreact", '<Whatever justify="center" />'), [])
    })

    test("annotates each usage on its own orientation", () => {
      const text = `<Flex justify="center" />\n<Flex orientation="column" justify="center" />`
      assert.deepStrictEqual(
        annotate("typescriptreact", text).map((a) => a.label),
        ["↔ center", "↕ middle"]
      )
    })

    test("AxisHints turns annotations into decorations and honours its setting", async () => {
      const hints = new AxisHints(extensionPath)
      const config = vscode.workspace.getConfiguration("playbook")
      try {
        const document = await createTestDocument("typescriptreact", '<Flex justify="center" />')
        const [decoration] = hints.compute(document)
        assert.strictEqual(decoration.renderOptions?.after?.contentText, " ↔ center")

        await config.update("axisHints", false, vscode.ConfigurationTarget.Global)
        assert.deepStrictEqual(hints.compute(document), [])
      } finally {
        await config.update("axisHints", undefined, vscode.ConfigurationTarget.Global)
        hints.dispose()
      }
    })
  })

  suite("flexMigration", () => {
    test("spacing becomes justify unchanged", () => {
      for (const value of ["around", "between", "evenly"]) {
        assert.deepStrictEqual(flexMigration("spacing", value, "row"), { prop: "justify", value })
        assert.deepStrictEqual(flexMigration("spacing", value, "column"), { prop: "justify", value })
      }
      assert.strictEqual(flexMigration("spacing", "none", "row"), undefined)
    })

    test("in a row, horizontal is justify and vertical is align", () => {
      assert.deepStrictEqual(flexMigration("horizontal", "left", "row"), { prop: "justify", value: "start" })
      assert.deepStrictEqual(flexMigration("horizontal", "right", "row"), { prop: "justify", value: "end" })
      assert.deepStrictEqual(flexMigration("vertical", "top", "row"), { prop: "align", value: "start" })
      assert.deepStrictEqual(flexMigration("vertical", "bottom", "row"), { prop: "align", value: "end" })
      assert.deepStrictEqual(flexMigration("vertical", "baseline", "row"), { prop: "align", value: "baseline" })
    })

    test("in a column, horizontal is align and vertical is justify", () => {
      assert.deepStrictEqual(flexMigration("horizontal", "left", "column"), { prop: "align", value: "start" })
      assert.deepStrictEqual(flexMigration("horizontal", "stretch", "column"), { prop: "align", value: "stretch" })
      assert.deepStrictEqual(flexMigration("vertical", "top", "column"), { prop: "justify", value: "start" })
      assert.deepStrictEqual(flexMigration("vertical", "center", "column"), { prop: "justify", value: "center" })
    })

    test("has no equivalent for combinations that produce no CSS", () => {
      assert.strictEqual(flexMigration("horizontal", "stretch", "row"), undefined)
      assert.strictEqual(flexMigration("vertical", "stretch", "column"), undefined)
      assert.strictEqual(flexMigration("vertical", "baseline", "column"), undefined)
      assert.strictEqual(flexMigration("horizontal", "none", "row"), undefined)
    })

    test("only handles the deprecated Flex props", () => {
      assert.strictEqual(flexMigration("justify", "start", "row"), undefined)
    })
  })

  suite("migrationForUsage", () => {
    const migrate = (text: string, index = 0) => {
      const usage = react(text)
      return migrationForUsage(usage, flex, usage.props[index])
    }

    test("migrates using the resolved orientation", () => {
      const result = migrate('<Flex horizontal="center" />')!
      assert.deepStrictEqual(result.migration, { prop: "justify", value: "center" })
      assert.strictEqual(result.resolved.orientation, "row")
    })

    test("does not migrate when the orientation is unknown", () => {
      assert.strictEqual(migrate('<Flex orientation={dir} horizontal="center" />', 1), undefined)
    })

    test("does not migrate onto a prop that is already set", () => {
      assert.strictEqual(migrate('<Flex horizontal="center" justify="end" />'), undefined)
    })

    test("does not migrate two deprecated props onto the same prop", () => {
      assert.strictEqual(migrate('<Flex horizontal="center" spacing="between" />', 0), undefined)
      assert.strictEqual(migrate('<Flex horizontal="center" spacing="between" />', 1), undefined)
    })

    test("still migrates props that go to different targets", () => {
      assert.ok(migrate('<Flex horizontal="center" vertical="top" />', 0))
      assert.ok(migrate('<Flex horizontal="center" vertical="top" />', 1))
    })

    test("does not apply to other kits", () => {
      const usage = react('<Card horizontal="center" />')
      assert.strictEqual(migrationForUsage(usage, card, usage.props[0]), undefined)
    })
  })

  suite("Deprecation message and quick fix", () => {
    let diagnostics: PlaybookDiagnostics
    let fixes: PlaybookQuickFixProvider

    suiteSetup(() => {
      diagnostics = new PlaybookDiagnostics(extensionPath)
      fixes = new PlaybookQuickFixProvider(extensionPath)
    })
    suiteTeardown(() => diagnostics.dispose())

    // Playbook marks Flex horizontal/vertical/spacing deprecated in Rails only.
    const flexCall = (props: string) => `<%= pb_rails("flex", props: { ${props} }) %>`

    async function run(content: string) {
      const document = await createTestDocument("erb", content)
      diagnostics.updateDiagnostics(document)
      const diagnostic = diagnostics.getDiagnostics(document.uri).find((d) => d.code === "deprecated-prop")
      assert.ok(diagnostic, `expected a deprecated-prop diagnostic for ${content}`)
      const actions = fixes.provideCodeActions(document, diagnostic.range, {
        diagnostics: [diagnostic],
        only: undefined,
        triggerKind: vscode.CodeActionTriggerKind.Invoke,
      })
      return { document, diagnostic, actions }
    }

    async function applied(document: vscode.TextDocument, action: vscode.CodeAction) {
      await vscode.workspace.applyEdit(action.edit!)
      return document.getText()
    }

    test("the warning says which prop to use for this orientation", async () => {
      const row = await run(flexCall('horizontal: "center"'))
      assert.ok(row.diagnostic.message.includes('Use justify: "center" instead (orientation is row)'), row.diagnostic.message)

      const column = await run(flexCall('orientation: "column", horizontal: "center"'))
      assert.ok(column.diagnostic.message.includes('Use align: "center" instead (orientation is column)'), column.diagnostic.message)
    })

    test("rewrites horizontal in a row to justify", async () => {
      const { document, actions } = await run(flexCall('horizontal: "right", gap: "sm"'))
      assert.strictEqual(actions[0].title, 'Replace with justify: "end" (orientation is row)')
      assert.ok(actions[0].isPreferred)
      assert.strictEqual(await applied(document, actions[0]), flexCall('justify: "end", gap: "sm"'))
    })

    test("rewrites horizontal in a column to align", async () => {
      const { document, actions } = await run(flexCall('orientation: "column", horizontal: "left"'))
      assert.strictEqual(await applied(document, actions[0]), flexCall('orientation: "column", align: "start"'))
    })

    test("rewrites vertical in a column to justify", async () => {
      const { document, actions } = await run(flexCall('orientation: "column", vertical: "bottom"'))
      assert.strictEqual(await applied(document, actions[0]), flexCall('orientation: "column", justify: "end"'))
    })

    test("rewrites vertical in a row to align", async () => {
      const { document, actions } = await run(flexCall('vertical: "center"'))
      assert.strictEqual(await applied(document, actions[0]), flexCall('align: "center"'))
    })

    test("rewrites spacing to justify", async () => {
      const { document, actions } = await run(flexCall('spacing: "between"'))
      assert.strictEqual(await applied(document, actions[0]), flexCall('justify: "between"'))
    })

    test("offers no fix when the value has no equivalent", async () => {
      const { actions } = await run(flexCall('horizontal: "stretch"'))
      assert.deepStrictEqual(actions, [])
    })

    test("offers no fix when the orientation is dynamic", async () => {
      const { actions } = await run(flexCall('orientation: dir, horizontal: "center"'))
      assert.deepStrictEqual(actions, [])
    })

    test("offers no fix when the replacement is already set", async () => {
      const { actions } = await run(flexCall('horizontal: "center", justify: "end"'))
      assert.deepStrictEqual(actions, [])
    })

    test("keeps the generic message when no migration applies", async () => {
      const { diagnostic } = await run(flexCall('horizontal: "stretch"'))
      assert.strictEqual(diagnostic.message, 'Prop "horizontal" is deprecated.')
    })

    test("React's Flex isn't deprecated by Playbook, so nothing is flagged or migrated there", async () => {
      const document = await createTestDocument("typescriptreact", '<Flex horizontal="center" />')
      diagnostics.updateDiagnostics(document)
      assert.deepStrictEqual(diagnostics.getDiagnostics(document.uri), [])
    })
  })

  suite("Hover", () => {
    let provider: PlaybookHoverProvider

    suiteSetup(() => {
      provider = new PlaybookHoverProvider(extensionPath)
    })

    async function hoverAt(languageId: string, content: string, needle: string) {
      const document = await createTestDocument(languageId, content)
      const offset = content.indexOf(needle) + 1
      const hover = await provider.provideHover(document, document.positionAt(offset))
      assert.ok(hover, `expected a hover on ${needle}`)
      return hover.contents.map((c) => (c as vscode.MarkdownString).value).join("\n")
    }

    test("justify in a default row is horizontal", async () => {
      const text = await hoverAt("typescriptreact", '<Flex justify="center" />', "justify")
      assert.ok(text.includes("main axis") && text.includes("horizontally"), text)
      assert.ok(text.includes("isn't set"), text)
    })

    test("justify in a column is vertical", async () => {
      const text = await hoverAt("typescriptreact", '<Flex orientation="column" justify="center" />', "justify")
      assert.ok(text.includes("vertically"), text)
      assert.ok(text.includes("`orientation` is `column`"), text)
    })

    test("align in a column is horizontal", async () => {
      const text = await hoverAt("typescriptreact", '<Flex orientation="column" align="center" />', "align=")
      assert.ok(text.includes("cross axis") && text.includes("horizontally"), text)
    })

    test("a dynamic orientation is called out", async () => {
      const text = await hoverAt("typescriptreact", '<Flex orientation={d} align="center" />', "align=")
      assert.ok(text.includes("can't be worked out"), text)
    })

    test("hovering orientation explains the swap", async () => {
      const text = await hoverAt("typescriptreact", '<Flex orientation="column" />', "orientation")
      assert.ok(text.includes("decides which way"), text)
    })

    test("a deprecated prop shows its migration", async () => {
      const text = await hoverAt(
        "erb",
        '<%= pb_rails("flex", props: { orientation: "column", horizontal: "left" }) %>',
        "horizontal"
      )
      assert.ok(text.includes('Migrates to `align: "start"` (orientation is `column`)'), text)
    })

    test("no migration is suggested where the prop isn't deprecated", async () => {
      const text = await hoverAt("typescriptreact", '<Flex horizontal="left" />', "horizontal")
      assert.ok(!text.includes("Migrates to"), text)
    })

    test("global justifyContent follows flexDirection and uses Rails spelling in Rails", async () => {
      const text = await hoverAt(
        "erb",
        '<%= pb_rails("card", props: { flex_direction: "column", justify_content: "center" }) %>',
        "justify_content"
      )
      assert.ok(text.includes("`justify_content`") && text.includes("vertically"), text)
      assert.ok(text.includes("flex container"), text)
    })

    test("props that aren't axis props get no axis text", async () => {
      const text = await hoverAt("typescriptreact", '<Flex gap="sm" />', "gap")
      assert.ok(!text.includes("**Axis:**"), text)
    })
  })

  suite("Value completions", () => {
    let provider: PlaybookCompletionProvider

    suiteSetup(() => {
      provider = new PlaybookCompletionProvider(extensionPath)
    })

    async function valueItems(languageId: string, content: string, marker: string) {
      const document = await createTestDocument(languageId, content)
      const position = document.positionAt(content.indexOf(marker) + marker.length)
      return getCompletionItems(
        await provider.provideCompletionItems(document, position, createCancellationToken(), createCompletionContext())
      )
    }

    const detail = (items: vscode.CompletionItem[], label: string) => items.find((i) => i.label === label)?.detail

    test("justify values say where they put items in a row", async () => {
      const items = await valueItems("typescriptreact", '<Flex justify="" />', 'justify="')
      assert.ok(detail(items, "start")?.endsWith("— ↔ left"), detail(items, "start"))
      assert.ok(detail(items, "between")?.endsWith("— ↔ space between"), detail(items, "between"))
    })

    test("they change in a column", async () => {
      const items = await valueItems("typescriptreact", '<Flex orientation="column" justify="" />', 'justify="')
      assert.ok(detail(items, "start")?.endsWith("— ↕ top"), detail(items, "start"))
    })

    test("align values use the cross axis", async () => {
      const row = await valueItems("typescriptreact", '<Flex align="" />', 'align="')
      assert.ok(detail(row, "center")?.endsWith("— ↕ middle"), detail(row, "center"))
      const column = await valueItems("typescriptreact", '<Flex orientation="column" align="" />', 'align="')
      assert.ok(detail(column, "end")?.endsWith("— ↔ right"), detail(column, "end"))
    })

    test("shows both orientations when it is unknown", async () => {
      const items = await valueItems("typescriptreact", '<Flex orientation={d} justify="" />', 'justify="')
      assert.ok(detail(items, "start")?.includes("row ↔ left · column ↕ top"), detail(items, "start"))
    })

    test("works in Rails", async () => {
      const content = '<%= pb_rails("flex", props: { orientation: "column", align: "" }) %>'
      const items = await valueItems("erb", content, 'align: "')
      assert.ok(detail(items, "start")?.endsWith("— ↔ left"), detail(items, "start"))
    })

    test("values for other props are unchanged", async () => {
      const items = await valueItems("typescriptreact", '<Flex wrap="" />', 'wrap="')
      assert.ok(items.every((i) => !i.detail?.includes("↔") && !i.detail?.includes("↕")))
    })
  })
})
