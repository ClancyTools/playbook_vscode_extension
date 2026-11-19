import * as assert from "assert"
import * as path from "path"
import * as vscode from "vscode"
import { PlaybookCompletionProvider } from "../../completionProvider"
import { PlaybookDiagnostics } from "../../diagnostics"
import { PlaybookHoverProvider } from "../../hoverProvider"
import {
  findFormBuilderField,
  generateFormMethodDocs,
  loadFormBuilderMetadata,
} from "../../metadata"
import { findFormBuilderContext, parseFormBuilderMethod } from "../../parser"
import {
  createCancellationToken,
  createCompletionContext,
  createTestDocument,
  getCompletionItems,
} from "./testHelpers"

suite("Form Builder Test Suite", () => {
  const extensionPath = path.resolve(__dirname, "../../../")
  const builders = () => loadFormBuilderMetadata(extensionPath)

  suite("Metadata", () => {
    test("uses the method names Playbook's builder really defines", () => {
      const names = builders().fields.map((f) => f.name)
      for (const real of ["text_field", "check_box", "select", "date_picker", "typeahead", "time_picker"]) {
        assert.ok(names.includes(real), `${real} should be a builder method`)
      }
    })

    test("does not invent methods from file names", () => {
      const names = builders().fields.map((f) => f.name)
      for (const invented of ["checkbox_field", "select_field", "date_picker_field", "typeahead_field", "action_area"]) {
        assert.ok(!names.includes(invented), `${invented} is not a builder method`)
      }
    })

    test("maps each method to its kit", () => {
      assert.strictEqual(findFormBuilderField(builders(), "check_box")?.kit, "checkbox")
      assert.strictEqual(findFormBuilderField(builders(), "text_area")?.kit, "textarea")
    })

    test("combines builder-level props with the kit's Rails props", () => {
      const props = Object.keys(findFormBuilderField(builders(), "text_field")!.props)
      assert.ok(props.includes("input_options"), "builder-level prop")
      assert.ok(props.includes("label"))
    })

    test("excludes props that exist only in React", () => {
      const checkbox = findFormBuilderField(builders(), "check_box")!
      for (const [name, prop] of Object.entries(checkbox.props)) {
        assert.ok(!prop.platforms || prop.platforms.includes("rails"), `${name} is React-only`)
      }
    })

    test("carries the published contract", () => {
      const contract = findFormBuilderField(builders(), "text_field")!.contract!
      assert.ok(contract.signature?.startsWith("text_field("), contract.signature)
      assert.ok(contract.example?.includes("pb_form_with"), contract.example)
      assert.ok(contract.notes.some((n) => n.topic === "Binding"))
    })

    test("documents a method with signature, example and notes", () => {
      const docs = generateFormMethodDocs(findFormBuilderField(builders(), "text_field")!)
      assert.ok(docs.includes("# text_field"))
      assert.ok(docs.includes("text_field(name, props: {}"))
      assert.ok(docs.includes("pb_form_with"))
      assert.ok(docs.includes("**Binding:**"))
    })
  })

  suite("Diagnostics", () => {
    let diagnostics: PlaybookDiagnostics

    suiteSetup(() => {
      diagnostics = new PlaybookDiagnostics(extensionPath)
    })
    suiteTeardown(() => diagnostics.dispose())

    async function messages(content: string): Promise<string[]> {
      const document = await createTestDocument("erb", content)
      diagnostics.updateDiagnostics(document)
      return diagnostics.getDiagnostics(document.uri).map((d) => d.message)
    }

    test("validates props on check_box, which the old data missed", async () => {
      const result = await messages('<%= f.check_box :agree, props: { labell: "x" } %>')
      assert.ok(result.some((m) => m.includes('Unknown prop "labell"') && m.includes("check_box")), result.join("|"))
    })

    test("validates props on select and date_picker", async () => {
      assert.ok((await messages('<%= f.select :country, [], props: { labell: "x" } %>')).some((m) => m.includes("select")))
      assert.ok((await messages('<%= f.date_picker :on, props: { labell: "x" } %>')).some((m) => m.includes("date_picker")))
    })

    test("accepts valid props", async () => {
      assert.deepStrictEqual(await messages('<%= f.check_box :agree, props: { label: "x" } %>'), [])
      assert.deepStrictEqual(await messages('<%= f.text_field :email, props: { label: true, required: true } %>'), [])
    })

    test("flags an invalid enum value on a builder field", async () => {
      const result = await messages('<%= f.text_field :ssn, props: { mask: "bogus" } %>')
      assert.ok(result.some((m) => m.startsWith('Invalid value "bogus" for prop "mask"')), result.join("|"))
    })

    test("does not read another component's props as the field's", async () => {
      const result = await messages(`<%= f.date_picker :starts_on %>
<%= pb_rails("table", props: { size: "sm", container: false }) %>`)
      assert.deepStrictEqual(result, [])
    })

    test("places the warning on the unknown prop name", async () => {
      const content = '<%= f.text_field :email, props: { nope: true } %>'
      const document = await createTestDocument("erb", content)
      diagnostics.updateDiagnostics(document)
      const found = diagnostics.getDiagnostics(document.uri).find((d) => d.code === "unknown-prop")!
      assert.strictEqual(document.getText(found.range), "nope")
    })

    test("accepts global props and nested values", async () => {
      assert.deepStrictEqual(
        await messages('<%= f.text_field :email, props: { margin_bottom: "sm", input_options: { data: { x: 1 } } } %>'),
        []
      )
    })

    test("still validates text_field", async () => {
      const result = await messages('<%= f.text_field :email, props: { nope: true } %>')
      assert.ok(result.some((m) => m.includes('Unknown prop "nope"')))
    })
  })

  suite("Completion", () => {
    let provider: PlaybookCompletionProvider

    suiteSetup(() => {
      provider = new PlaybookCompletionProvider(extensionPath)
    })

    async function complete(content: string, line: number, character: number) {
      const document = await createTestDocument("erb", content)
      const result = await provider.provideCompletionItems(
        document,
        new vscode.Position(line, character),
        createCancellationToken(),
        createCompletionContext(".")
      )
      return getCompletionItems(result)
    }

    test("offers builder methods after f.", async () => {
      const items = await complete("<%= f.", 0, 6)
      const labels = items.map((i) => i.label)

      assert.ok(labels.includes("text_field") && labels.includes("check_box"))
      const snippet = items.find((i) => i.label === "check_box")!.insertText as vscode.SnippetString
      assert.ok(snippet.value.startsWith("check_box :"), snippet.value)
    })

    test("narrows to a partial method name via the editor's filter", async () => {
      const items = await complete("<%= form.sel", 0, 12)
      assert.ok(items.some((i) => i.label === "select"))
    })

    test("offers the field's props inside props: { }", async () => {
      const content = "<%= f.text_field :email, props: {  } %>"
      const items = await complete(content, 0, content.indexOf("{ ") + 2)
      const labels = items.map((i) => i.label)

      assert.ok(labels.includes("label"), "kit prop")
      assert.ok(labels.includes("input_options"), "builder prop")
      assert.ok(labels.includes("margin_bottom"), "global prop")
    })

    test("prefers a closer form builder call over an earlier pb_rails call", async () => {
      const content = `<%= pb_rails("button", props: { text: "x" }) %>\n<%= f.check_box :a, props: {\n  \n} %>`
      const items = await complete(content, 2, 2)
      const labels = items.map((i) => i.label)

      assert.ok(labels.includes("label"), "checkbox prop")
      assert.ok(!labels.includes("full_width"), "not the button's props")
    })

    test("keeps completing pb_rails props when no form call is near", async () => {
      const content = '<%= pb_rails("button", props: {  }) %>'
      const items = await complete(content, 0, content.indexOf("{ ") + 2)
      assert.ok(items.some((i) => i.label === "variant"))
    })
  })

  suite("Hover", () => {
    test("documents the method under the cursor", async () => {
      const provider = new PlaybookHoverProvider(extensionPath)
      const document = await createTestDocument("erb", "<%= f.check_box :agree, props: {} %>")
      const hover = (await provider.provideHover(document, new vscode.Position(0, 9))) as vscode.Hover
      const text = (hover.contents[0] as vscode.MarkdownString).value

      assert.ok(text.includes("# check_box"), text)
      assert.ok(text.includes("checkbox"), text)
    })

    test("does not treat unrelated receivers as form builders", async () => {
      const provider = new PlaybookHoverProvider(extensionPath)
      const document = await createTestDocument("erb", "<%= user.check_box :agree %>")
      const hover = await provider.provideHover(document, new vscode.Position(0, 12))
      assert.ok(!hover)
    })
  })

  suite("Parser helpers", () => {
    test("finds the nearest builder call above the cursor", async () => {
      const document = await createTestDocument("erb", "<%= f.text_field :a,\n  props: {\n  \n} %>")
      assert.deepStrictEqual(findFormBuilderContext(document, new vscode.Position(2, 2)), {
        fieldName: "text_field",
        line: 0,
      })
    })

    test("takes the last builder call on a line before the cursor", async () => {
      const document = await createTestDocument("erb", "<%= f.text_field :a %><%= f.check_box :b, props: {  } %>")
      const context = findFormBuilderContext(document, new vscode.Position(0, 51))
      assert.strictEqual(context?.fieldName, "check_box")
    })

    test("returns null when there is no builder call nearby", async () => {
      const document = await createTestDocument("erb", "<%= something %>")
      assert.strictEqual(findFormBuilderContext(document, new vscode.Position(0, 5)), null)
    })

    test("parseFormBuilderMethod only matches over the method name", async () => {
      const document = await createTestDocument("erb", "<%= f.text_field :a %>")
      assert.strictEqual(parseFormBuilderMethod(document, new vscode.Position(0, 9))?.methodName, "text_field")
      assert.strictEqual(parseFormBuilderMethod(document, new vscode.Position(0, 4)), null)
      assert.strictEqual(parseFormBuilderMethod(document, new vscode.Position(0, 20)), null)
    })
  })
})
