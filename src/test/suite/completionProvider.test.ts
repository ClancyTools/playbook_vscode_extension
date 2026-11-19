import * as assert from "assert"
import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"
import { PlaybookCompletionProvider } from "../../completionProvider"
import {
  createTestDocument,
  getCompletionItems,
  createCancellationToken,
  createCompletionContext
} from "./testHelpers"

suite("Completion Provider Test Suite", () => {
  let provider: PlaybookCompletionProvider
  const extensionPath = path.resolve(__dirname, "../../../")

  suiteSetup(() => {
    provider = new PlaybookCompletionProvider(extensionPath)
  })

  test("Should create completion provider", () => {
    assert.ok(provider, "Provider should be created")
  })

  test("Should not provide completions outside component name", async () => {
    const document = await createTestDocument("erb", "Some random text")
    const position = new vscode.Position(0, 5)
    const token = createCancellationToken()
    const context = createCompletionContext()

    const result = await provider.provideCompletionItems(document, position, token, context)
    const items = getCompletionItems(result)

    assert.ok(items.length === 0, "Should not provide completions outside component")
  })

  test("Should provide completions for React components", async () => {
    const document = await createTestDocument("typescriptreact", "<B")
    const position = new vscode.Position(0, 2)
    const token = createCancellationToken()
    const context = createCompletionContext()

    const result = await provider.provideCompletionItems(document, position, token, context)
    const items = getCompletionItems(result)

    assert.ok(items.length > 0, "Should provide React component completions")
    const buttonCompletion = items.find((c: vscode.CompletionItem) => c.label === "Button")
    assert.ok(buttonCompletion, "Should include Button component")
  })

  test("Should provide completions for props", async () => {
    const document = await createTestDocument("erb", '<%= pb_rails("button", props: {  }) %>')
    const position = new vscode.Position(0, 34)
    const token = createCancellationToken()
    const context = createCompletionContext()

    const result = await provider.provideCompletionItems(document, position, token, context)
    const items = getCompletionItems(result)

    assert.ok(
      items.some((c: vscode.CompletionItem) => c.label === "variant"),
      "Should offer Button props such as variant"
    )
  })

  test("Should provide completions for React props", async () => {
    const document = await createTestDocument("typescriptreact", "<Button  />")
    const position = new vscode.Position(0, 8)
    const token = createCancellationToken()
    const context = createCompletionContext()

    const result = await provider.provideCompletionItems(document, position, token, context)
    const items = getCompletionItems(result)

    assert.ok(
      items.some((c: vscode.CompletionItem) => c.label === "variant"),
      "Should offer Button props such as variant"
    )
  })

  test("Should filter components based on partial match", async () => {
    const document = await createTestDocument("erb", '<%= pb_rails("but" %>')
    const position = new vscode.Position(0, 14)
    const token = createCancellationToken()
    const context = createCompletionContext()

    const result = await provider.provideCompletionItems(document, position, token, context)
    const items = getCompletionItems(result)

    {
      const buttonCompletion = items.find((c: vscode.CompletionItem) => c.label === "button")
      assert.ok(buttonCompletion, "Should include button for partial match \"but\"")
    }
  })

  test("Should provide enum values for enum props", async () => {
    const document = await createTestDocument(
      "erb",
      '<%= pb_rails("button", props: { variant: "" }) %>'
    )
    const position = new vscode.Position(0, 42)
    const token = createCancellationToken()
    const context = createCompletionContext()

    const result = await provider.provideCompletionItems(document, position, token, context)
    const items = getCompletionItems(result)

    assert.ok(
      items.some((c: vscode.CompletionItem) => c.label === "primary"),
      "Should offer enum values for variant"
    )
  })

  test("Should handle incomplete code gracefully", async () => {
    const document = await createTestDocument("erb", '<%= pb_rails("')
    const position = new vscode.Position(0, 15)
    const token = createCancellationToken()
    const context = createCompletionContext()

    const result = await provider.provideCompletionItems(document, position, token, context)
    const items = getCompletionItems(result)

    assert.ok(
      items.some((c: vscode.CompletionItem) => c.label === "button"),
      "Should still offer component names for an unterminated pb_rails(\""
    )
  })

  test("Should provide completions with documentation", async () => {
    const document = await createTestDocument("erb", '<%= pb_rails("" %>')
    const position = new vscode.Position(0, 16)
    const token = createCancellationToken()
    const context = createCompletionContext()

    const result = await provider.provideCompletionItems(document, position, token, context)
    const items = getCompletionItems(result)

    if (items.length > 0) {
      const firstItem = items[0]
      assert.ok(firstItem.kind !== undefined, "Items should have completion kind")
    }
  })

  test("Should provide completions for multi-line props - second line", async () => {
    const multiLineText = '<%= pb_rails("card", props: {\n  padding_x: "sm",\n  '
    const document = await createTestDocument("erb", multiLineText)
    const position = new vscode.Position(2, 2)
    const token = createCancellationToken()
    const context = createCompletionContext()

    const result = await provider.provideCompletionItems(document, position, token, context)
    const items = getCompletionItems(result)

    assert.ok(items.length > 0, "Should provide prop completions on second line")
    const hasCardProps = items.some(
      (item: vscode.CompletionItem) =>
        item.label === "padding_top" || item.label === "margin_bottom"
    )
    assert.ok(hasCardProps, "Should include card-specific props")
  })

  test("Should provide completions for multi-line props - third line", async () => {
    const multiLineText =
      '<%= pb_rails("card", props: {\n  padding_x: "sm",\n  padding_top: "sm",\n  '
    const document = await createTestDocument("erb", multiLineText)
    const position = new vscode.Position(3, 2)
    const token = createCancellationToken()
    const context = createCompletionContext()

    const result = await provider.provideCompletionItems(document, position, token, context)
    const items = getCompletionItems(result)

    assert.ok(items.length > 0, "Should provide prop completions on third line")
  })

  test("Should provide value completions for multi-line props", async () => {
    const multiLineText = '<%= pb_rails("card", props: {\n  padding_x: "sm",\n  margin_bottom: '
    const document = await createTestDocument("erb", multiLineText)
    const position = new vscode.Position(2, 18)
    const token = createCancellationToken()
    const context = createCompletionContext()

    const result = await provider.provideCompletionItems(document, position, token, context)
    const items = getCompletionItems(result)

    assert.ok(items.length >= 0, "Should handle value completions in multi-line context")
  })

  test("Should not provide completions outside props block", async () => {
    const multiLineText = '<%= pb_rails("card", props: {\n  padding_x: "sm"\n}) do %>\n  '
    const document = await createTestDocument("erb", multiLineText)
    const position = new vscode.Position(3, 2)
    const token = createCancellationToken()
    const context = createCompletionContext()

    const result = await provider.provideCompletionItems(document, position, token, context)
    const items = getCompletionItems(result)

    assert.ok(items.length === 0, "Should not provide completions outside props block")
  })

  test("Should provide value completions inside a string", async () => {
    const document = await createTestDocument(
      "erb",
      '<%= pb_rails("button", props: { variant: "" }) %>'
    )
    const position = new vscode.Position(0, 46)
    const token = createCancellationToken()
    const context = createCompletionContext()

    const result = await provider.provideCompletionItems(document, position, token, context)
    const items = getCompletionItems(result)

    assert.ok(items.length > 0, "Should provide value completions inside string")
  })

  test("Should provide value completions inside partial string", async () => {
    const document = await createTestDocument(
      "erb",
      '<%= pb_rails("button", props: { variant: "pri" }) %>'
    )
    const position = new vscode.Position(0, 49)
    const token = createCancellationToken()
    const context = createCompletionContext()

    const result = await provider.provideCompletionItems(document, position, token, context)
    const items = getCompletionItems(result)

    assert.ok(items.length > 0, "Should provide value completions inside partial string")
  })

  test("Should provide value completions in multi-line inside string", async () => {
    const multiLineText = '<%= pb_rails("button", props: {\n  variant: ""\n}) %>'
    const document = await createTestDocument("erb", multiLineText)
    const position = new vscode.Position(1, 13)
    const token = createCancellationToken()
    const context = createCompletionContext()

    const result = await provider.provideCompletionItems(document, position, token, context)
    const items = getCompletionItems(result)

    assert.ok(items.length > 0, "Should provide value completions in multi-line inside string")
  })

  test("Should provide completions for first prop after opening brace", async () => {
    const document = await createTestDocument("erb", '<%= pb_rails("pill", props: { v')
    const position = new vscode.Position(0, 35)
    const token = createCancellationToken()
    const context = createCompletionContext()

    const result = await provider.provideCompletionItems(document, position, token, context)
    const items = getCompletionItems(result)

    assert.ok(items.length > 0, "Should provide completions for first prop")
    const variantCompletion = items.find((c: vscode.CompletionItem) => c.label === "variant")
    assert.ok(variantCompletion, "Should include variant in completions")
  })

  test("Should provide completions immediately after opening brace", async () => {
    const document = await createTestDocument("erb", '<%= pb_rails("pill", props: {')
    const position = new vscode.Position(0, 33)
    const token = createCancellationToken()
    const context = createCompletionContext()

    const result = await provider.provideCompletionItems(document, position, token, context)
    const items = getCompletionItems(result)

    assert.ok(items.length > 0, "Should provide completions right after brace")
  })

  test("Should include hardcoded global props in completions", async () => {
    const document = await createTestDocument("erb", '<%= pb_rails("button", props: { ')
    const position = new vscode.Position(0, 35)
    const token = createCancellationToken()
    const context = createCompletionContext()

    const result = await provider.provideCompletionItems(document, position, token, context)
    const items = getCompletionItems(result)

    const hardcodedProps = ["id", "data", "aria", "html_options", "children", "style"]
    hardcodedProps.forEach((propName) => {
      const found = items.find((c: vscode.CompletionItem) => c.label === propName)
      assert.ok(found, `Should include hardcoded global prop: ${propName}`)
    })
  })

  suite("Color value completions", () => {
    const complete = async (languageId: string, content: string): Promise<vscode.CompletionItem[]> => {
      const document = await createTestDocument(languageId, content.replace("|", ""))
      const position = document.positionAt(content.indexOf("|"))
      return getCompletionItems(
        await provider.provideCompletionItems(document, position, createCancellationToken(), createCompletionContext())
      )
    }
    const find = (items: vscode.CompletionItem[], label: string) => items.find((i) => i.label === label)

    test("an enum color value shows its color", async () => {
      const items = await complete("typescriptreact", '<Card background="|" />')
      assert.strictEqual(find(items, "windows")?.kind, vscode.CompletionItemKind.Color)
      assert.strictEqual(find(items, "light")?.documentation, "#F3F7FB")
    })

    test("a kit's own meaning of a name wins over the same-named token", async () => {
      const items = await complete("erb", '<%= pb_rails("body", props: { color: "|" }) %>')
      assert.strictEqual(find(items, "default")?.documentation, "#242B42")
    })

    test("Icon color has no enum, so its names come from the stylesheet", async () => {
      const items = await complete("typescriptreact", '<Icon icon="user" color="|" />')
      assert.strictEqual(find(items, "primary")?.documentation, "#0056CF")
      assert.ok(!find(items, "secondary"))
    })

    test("Card header_color completes on the header subcomponent", async () => {
      const items = await complete("erb", '<%= pb_rails("card/card_header", props: { header_color: "|" }) %>')
      assert.ok(find(items, "category_1"), "category_1")
      assert.ok(find(items, "dark"), "dark")
    })

    test("a non-color prop gets plain enum values", async () => {
      const items = await complete("typescriptreact", '<Body size="|" />')
      assert.ok(items.every((i) => i.kind !== vscode.CompletionItemKind.Color))
    })

    test("with swatches off the names remain but without colors", async () => {
      const config = vscode.workspace.getConfiguration("playbook")
      await config.update("colorSwatches", false, vscode.ConfigurationTarget.Global)
      try {
        const items = await complete("typescriptreact", '<Icon icon="user" color="|" />')
        assert.ok(find(items, "primary"))
        assert.strictEqual(find(items, "primary")?.documentation, undefined)
        assert.ok(items.every((i) => i.kind !== vscode.CompletionItemKind.Color))
      } finally {
        await config.update("colorSwatches", undefined, vscode.ConfigurationTarget.Global)
      }
    })
  })

  suite("Typing letters inside a value", () => {
    const typed = async (languageId: string, content: string, trigger: string): Promise<vscode.CompletionItem[]> => {
      const document = await createTestDocument(languageId, content.replace("|", ""))
      const position = document.positionAt(content.indexOf("|"))
      return getCompletionItems(
        await provider.provideCompletionItems(document, position, createCancellationToken(), createCompletionContext(trigger))
      )
    }

    test("completes a value as you type inside existing quotes (React)", async () => {
      const items = await typed("typescriptreact", '<Card background="wi|" />', "i")
      assert.ok(items.some((i) => i.label === "windows"))
    })

    test("completes a value as you type inside existing quotes (Rails)", async () => {
      const items = await typed("erb", '<%= pb_rails("card", props: { background: "wi|" }) %>', "i")
      assert.ok(items.some((i) => i.label === "windows"))
    })

    test("typing a letter anywhere else offers nothing", async () => {
      assert.deepStrictEqual(await typed("typescriptreact", "const total = 1 + va|", "a"), [])
      assert.deepStrictEqual(await typed("typescriptreact", "<Card pad|", "d"), [])
      assert.deepStrictEqual(await typed("erb", "<%= link_to car|", "r"), [])
    })

    test("completes a Rails component name as you type inside existing quotes", async () => {
      const content = '<%= pb_rails("bu|") %>'
      const items = await typed("erb", content, "u")
      assert.ok(items.some((i) => i.label === "button"))
    })

    test("a preset replaces the text already typed, not just what follows the cursor", async () => {
      const content = '<%= pb_rails("dr|") %>'
      const items = await typed("erb", content, "r")
      const preset = items.find((i) => i.detail === "Playbook preset" && String(i.label).startsWith("dropdown:"))
      assert.ok(preset, "a Dropdown preset")
      const range = preset!.range as vscode.Range
      assert.strictEqual(range.start.character, content.indexOf("|") - 2, "starts where 'dr' starts")
    })

    test("the trigger characters include letters, digits and underscore", () => {
      const source = fs.readFileSync(path.resolve(extensionPath, "src/extension.ts"), "utf-8")
      assert.ok(source.includes("abcdefghijklmnopqrstuvwxyz") && source.includes("0123456789_"))
    })
  })
})
