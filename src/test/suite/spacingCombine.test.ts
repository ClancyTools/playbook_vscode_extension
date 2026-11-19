import * as assert from "assert"
import * as path from "path"
import * as vscode from "vscode"
import { PlaybookDiagnostics } from "../../diagnostics"
import { PlaybookQuickFixProvider } from "../../quickFixes"
import { applyEdits, findCombinableSpacing, removalRange } from "../../spacingCombine"
import { loadMetadata, PlaybookMetadata } from "../../metadata"
import { scanRailsUsages, scanReactUsages } from "../../usageScanner"
import { createTestDocument } from "./testHelpers"

suite("Combine Paired Spacing Test Suite", () => {
  const extensionPath = path.resolve(__dirname, "../../../")
  let metadata: PlaybookMetadata

  suiteSetup(() => {
    metadata = loadMetadata(extensionPath)
  })

  function combine(languageId: string, text: string): string[] {
    return findCombinableSpacing(text, languageId, metadata).map((c) => applyEdits(text, c.edits))
  }

  suite("React", () => {
    test("combines top and bottom", () => {
      assert.deepStrictEqual(combine("typescriptreact", '<Card paddingTop="sm" paddingBottom="sm" dark />'), [
        '<Card paddingY="sm" dark />',
      ])
    })

    test("combines left and right, in either order", () => {
      assert.deepStrictEqual(combine("typescriptreact", '<Card marginRight="lg" marginLeft="lg" />'), [
        '<Card marginX="lg" />',
      ])
    })

    test("reports each pair separately", () => {
      const text = '<Card paddingTop="sm" paddingBottom="sm" marginLeft="xs" marginRight="xs" />'
      const found = findCombinableSpacing(text, "typescriptreact", metadata)
      assert.deepStrictEqual(
        found.map((c) => c.title),
        ['Combine into paddingY="sm"', 'Combine into marginX="xs"']
      )
    })

    test("keeps a brace-wrapped value as written", () => {
      assert.deepStrictEqual(combine("typescriptreact", '<Card paddingTop={"sm"} paddingBottom={"sm"} />'), [
        '<Card paddingY={"sm"} />',
      ])
    })

    test("works across lines", () => {
      const text = '<Card\n  paddingTop="sm"\n  dark\n  paddingBottom="sm"\n/>'
      assert.deepStrictEqual(combine("typescriptreact", text), ['<Card\n  paddingY="sm"\n  dark\n/>'])
    })

    test("leaves pairs with different values alone", () => {
      assert.deepStrictEqual(combine("typescriptreact", '<Card paddingTop="sm" paddingBottom="lg" />'), [])
    })

    test("leaves dynamic and responsive values alone", () => {
      assert.deepStrictEqual(combine("typescriptreact", "<Card paddingTop={a} paddingBottom={a} />"), [])
      assert.deepStrictEqual(
        combine("typescriptreact", '<Card paddingTop={{ md: "sm" }} paddingBottom={{ md: "sm" }} />'),
        []
      )
    })

    test("leaves a lone side prop alone", () => {
      assert.deepStrictEqual(combine("typescriptreact", '<Card paddingTop="sm" />'), [])
    })

    test("does not combine when the axis prop is already set", () => {
      assert.deepStrictEqual(combine("typescriptreact", '<Card paddingY="md" paddingTop="sm" paddingBottom="sm" />'), [])
    })

    test("does not combine when props are spread in", () => {
      assert.deepStrictEqual(combine("typescriptreact", '<Card {...rest} paddingTop="sm" paddingBottom="sm" />'), [])
    })

    test("ignores unknown components", () => {
      assert.deepStrictEqual(combine("typescriptreact", '<Whatever paddingTop="sm" paddingBottom="sm" />'), [])
    })

    test("places the hint on the first prop's name", () => {
      const text = '<Card dark paddingBottom="sm" paddingTop="sm" />'
      const [c] = findCombinableSpacing(text, "typescriptreact", metadata)
      assert.strictEqual(text.slice(c.start, c.end), "paddingBottom")
      assert.strictEqual(c.message, 'paddingTop and paddingBottom are both "sm"; use paddingY instead.')
    })
  })

  suite("Rails", () => {
    const call = (props: string) => `<%= pb_rails("card", props: { ${props} }) %>`

    test("combines and uses snake_case", () => {
      assert.deepStrictEqual(combine("erb", call('padding_top: "sm", padding_bottom: "sm"')), [call('padding_y: "sm"')])
    })

    test("removes the dropped prop's comma when it is in the middle", () => {
      assert.deepStrictEqual(combine("erb", call('padding_top: "sm", dark: true, padding_bottom: "sm", id: "x"')), [
        call('padding_y: "sm", dark: true, id: "x"'),
      ])
    })

    test("removes the preceding comma when the dropped prop is last", () => {
      assert.deepStrictEqual(combine("erb", call('dark: true, margin_left: "xs", margin_right: "xs"')), [
        call('dark: true, margin_x: "xs"'),
      ])
    })

    test("removes a whole line in a multi-line hash", () => {
      const text = `<%= pb_rails("card", props: {\n  padding_top: "sm",\n  dark: true,\n  padding_bottom: "sm",\n  id: "x"\n}) %>`
      assert.deepStrictEqual(combine("erb", text), [
        `<%= pb_rails("card", props: {\n  padding_y: "sm",\n  dark: true,\n  id: "x"\n}) %>`,
      ])
    })

    test("handles the dropped prop being the last line of the hash", () => {
      const text = `<%= pb_rails("card", props: {\n  dark: true,\n  padding_top: "sm",\n  padding_bottom: "sm"\n}) %>`
      assert.deepStrictEqual(combine("erb", text), [
        `<%= pb_rails("card", props: {\n  dark: true,\n  padding_y: "sm"\n}) %>`,
      ])
    })

    test("leaves a ** spread alone", () => {
      assert.deepStrictEqual(combine("erb", call('padding_top: "sm", padding_bottom: "sm", **opts')), [])
    })
  })

  suite("removalRange", () => {
    test("React removal takes the leading whitespace", () => {
      const text = '<Card a="1" b="2" />'
      const usage = scanReactUsages(text)[0]
      const edit = removalRange(text, usage, usage.props[1])
      assert.strictEqual(text.slice(0, edit.start) + text.slice(edit.end), '<Card a="1" />')
    })

    test("Rails removal of a middle prop takes the following comma", () => {
      const text = 'pb_rails("card", props: { a: 1, b: 2, c: 3 })'
      const usage = scanRailsUsages(text)[0]
      const edit = removalRange(text, usage, usage.props[1])
      assert.strictEqual(text.slice(0, edit.start) + text.slice(edit.end), 'pb_rails("card", props: { a: 1, c: 3 })')
    })
  })

  suite("Diagnostics and quick fixes", () => {
    let diagnostics: PlaybookDiagnostics
    let fixes: PlaybookQuickFixProvider

    suiteSetup(() => {
      diagnostics = new PlaybookDiagnostics(extensionPath)
      fixes = new PlaybookQuickFixProvider(extensionPath)
    })
    suiteTeardown(() => diagnostics.dispose())

    async function actions(content: string, only?: vscode.CodeActionKind) {
      const document = await createTestDocument("typescriptreact", content)
      diagnostics.updateDiagnostics(document)
      const found = diagnostics.getDiagnostics(document.uri).filter((d) => d.code === "combine-spacing")
      const result = fixes.provideCodeActions(document, found[0]?.range ?? new vscode.Range(0, 0, 0, 0), {
        diagnostics: found,
        only,
        triggerKind: vscode.CodeActionTriggerKind.Invoke,
      })
      return { document, found, result }
    }

    async function applied(document: vscode.TextDocument, action: vscode.CodeAction) {
      await vscode.workspace.applyEdit(action.edit!)
      return document.getText()
    }

    test("reports a hint, not a warning", async () => {
      const { found } = await actions('<Card paddingTop="sm" paddingBottom="sm" />')
      assert.strictEqual(found.length, 1)
      assert.strictEqual(found[0].severity, vscode.DiagnosticSeverity.Hint)
    })

    test("the quick fix rewrites both props in one edit", async () => {
      const { document, result } = await actions('<Card paddingTop="sm" dark paddingBottom="sm" />')
      assert.strictEqual(result[0].title, 'Combine into paddingY="sm"')
      assert.strictEqual(await applied(document, result[0]), '<Card paddingY="sm" dark />')
    })

    test("offers a combine-all action when there are several pairs", async () => {
      const content = '<Card paddingTop="sm" paddingBottom="sm" />\n<Card marginLeft="lg" marginRight="lg" />'
      const { document, result } = await actions(content)
      const all = result.find((a) => a.title.startsWith("Combine all 2"))!
      assert.ok(all, result.map((a) => a.title).join("|"))
      assert.strictEqual(await applied(document, all), '<Card paddingY="sm" />\n<Card marginX="lg" />')
    })

    test("a single pair gets no combine-all quick fix", async () => {
      const { result } = await actions('<Card paddingTop="sm" paddingBottom="sm" />')
      assert.ok(!result.some((a) => a.title.startsWith("Combine all")))
    })

    test("source.fixAll.playbook is offered only when asked for by that kind", async () => {
      const content = '<Card paddingTop="sm" paddingBottom="sm" />'
      const own = await actions(content, vscode.CodeActionKind.SourceFixAll.append("playbook"))
      const fixAll = own.result.find((a) => a.kind?.value === "source.fixAll.playbook")!
      assert.ok(fixAll, "offered for our kind")
      assert.strictEqual(await applied(own.document, fixAll), '<Card paddingY="sm" />')

      const generic = await actions(content, vscode.CodeActionKind.SourceFixAll)
      assert.ok(!generic.result.some((a) => a.kind?.value === "source.fixAll.playbook"), "never for a generic fixAll")
    })

    test("can be turned off", async () => {
      await vscode.workspace.getConfiguration("playbook").update("diagnostics.combineSpacing", false, vscode.ConfigurationTarget.Global)
      try {
        const { found } = await actions('<Card paddingTop="sm" paddingBottom="sm" />')
        assert.deepStrictEqual(found, [])
      } finally {
        await vscode.workspace.getConfiguration("playbook").update("diagnostics.combineSpacing", undefined, vscode.ConfigurationTarget.Global)
      }
    })
  })
})
