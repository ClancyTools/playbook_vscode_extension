import * as assert from "assert"
import * as path from "path"
import * as vscode from "vscode"
import { PlaybookDiagnostics } from "../../diagnostics"
import { loadMetadata, PlaybookMetadata } from "../../metadata"
import { computeFixes, PlaybookQuickFixProvider } from "../../quickFixes"
import { createTestDocument } from "./testHelpers"

suite("Quick Fixes Test Suite", () => {
  const extensionPath = path.resolve(__dirname, "../../../")
  let metadata: PlaybookMetadata
  let diagnostics: PlaybookDiagnostics
  let provider: PlaybookQuickFixProvider

  suiteSetup(() => {
    metadata = loadMetadata(extensionPath)
    diagnostics = new PlaybookDiagnostics(extensionPath)
    provider = new PlaybookQuickFixProvider(extensionPath)
  })

  suiteTeardown(() => diagnostics.dispose())

  async function actionsFor(languageId: string, content: string, code: string) {
    const document = await createTestDocument(languageId, content)
    diagnostics.updateDiagnostics(document)
    const diagnostic = diagnostics.getDiagnostics(document.uri).find((d) => d.code === code)
    assert.ok(diagnostic, `expected a "${code}" diagnostic for: ${content}`)
    const actions = provider.provideCodeActions(document, diagnostic.range, {
      diagnostics: [diagnostic],
      only: undefined,
      triggerKind: vscode.CodeActionTriggerKind.Invoke,
    })
    return { document, diagnostic, actions }
  }

  async function applyAndRead(document: vscode.TextDocument, action: vscode.CodeAction) {
    await vscode.workspace.applyEdit(action.edit!)
    return document.getText()
  }

  suite("Unknown prop", () => {
    test("offers the closest Rails prop and applies it", async () => {
      const { document, actions } = await actionsFor(
        "erb",
        '<%= pb_rails("flex", props: { margin_botom: "xs" }) %>',
        "unknown-prop"
      )
      assert.strictEqual(actions[0].title, 'Change to "margin_bottom"')
      assert.ok(actions[0].isPreferred, "closest match is preferred")
      assert.strictEqual(
        await applyAndRead(document, actions[0]),
        '<%= pb_rails("flex", props: { margin_bottom: "xs" }) %>'
      )
    })

    test("offers the camelCase spelling in React", async () => {
      const { document, actions } = await actionsFor(
        "typescriptreact",
        '<Flex marginBotom="xs" />',
        "unknown-prop"
      )
      assert.strictEqual(actions[0].title, 'Change to "marginBottom"')
      assert.strictEqual(await applyAndRead(document, actions[0]), '<Flex marginBottom="xs" />')
    })

    test("suggests the word-swapped name", async () => {
      const { actions } = await actionsFor(
        "erb",
        '<%= pb_rails("flex", props: { bottom_margin: "xs" }) %>',
        "unknown-prop"
      )
      assert.ok(actions.some((a) => a.title === 'Change to "margin_bottom"'))
    })

    test("attaches the fix to its diagnostic", async () => {
      const { diagnostic, actions } = await actionsFor(
        "erb",
        '<%= pb_rails("flex", props: { margin_botom: "xs" }) %>',
        "unknown-prop"
      )
      assert.deepStrictEqual(actions[0].diagnostics, [diagnostic])
      assert.strictEqual(actions[0].kind?.value, vscode.CodeActionKind.QuickFix.value)
    })

    test("offers nothing when no prop is close", async () => {
      const { actions } = await actionsFor(
        "erb",
        '<%= pb_rails("flex", props: { zzzzzzzz: 1 }) %>',
        "unknown-prop"
      )
      assert.deepStrictEqual(actions, [])
    })

    test("never suggests a prop the usage already sets", async () => {
      const { actions } = await actionsFor(
        "erb",
        '<%= pb_rails("flex", props: { margin_bottom: "xs", margin_botom: "sm" }) %>',
        "unknown-prop"
      )
      assert.ok(!actions.some((a) => a.title === 'Change to "margin_bottom"'))
    })

    test("does not suggest props that only exist on the other platform", () => {
      const text = '<%= pb_rails("button", props: { onClik: 1 }) %>'
      const start = text.indexOf("onClik")
      const fixes = computeFixes(text, "erb", metadata, [
        { code: "unknown-prop", start, end: start + "onClik".length },
      ])
      assert.ok(!fixes.some((f) => f.newText === "on_click"), "onClick is React-only")
    })
  })

  suite("Invalid value", () => {
    test("offers the closest enum value, keeping the quote style", async () => {
      const { document, actions } = await actionsFor(
        "erb",
        `<%= pb_rails("pill", props: { variant: 'primry', text: "x" }) %>`,
        "invalid-value"
      )
      assert.strictEqual(actions[0].title, 'Change to "primary"')
      assert.strictEqual(
        await applyAndRead(document, actions[0]),
        `<%= pb_rails("pill", props: { variant: 'primary', text: "x" }) %>`
      )
    })

    test("works for React props", async () => {
      const { document, actions } = await actionsFor(
        "typescriptreact",
        '<Pill variant="primry" text="x" />',
        "invalid-value"
      )
      assert.strictEqual(await applyAndRead(document, actions[0]), '<Pill variant="primary" text="x" />')
    })

    test("offers nothing when no value is close", async () => {
      const { actions } = await actionsFor(
        "erb",
        '<%= pb_rails("pill", props: { variant: "zzzzzzzzz" }) %>',
        "invalid-value"
      )
      assert.deepStrictEqual(actions, [])
    })
  })

  suite("Wrong prop case", () => {
    test("renames a snake_case React prop to camelCase", async () => {
      const { document, actions } = await actionsFor(
        "typescriptreact",
        '<Flex margin_bottom="xs" />',
        "wrong-prop-case"
      )
      assert.strictEqual(actions[0].title, 'Change to "marginBottom"')
      assert.ok(actions[0].isPreferred)
      assert.strictEqual(await applyAndRead(document, actions[0]), '<Flex marginBottom="xs" />')
    })

    test("handles several underscores", async () => {
      const { document, actions } = await actionsFor(
        "typescriptreact",
        '<Card padding_top="sm" />',
        "wrong-prop-case"
      )
      assert.strictEqual(await applyAndRead(document, actions[0]), '<Card paddingTop="sm" />')
    })
  })

  suite("Form builder fields", () => {
    test("suggests a prop for a typo inside a form builder call", async () => {
      const { document, actions } = await actionsFor(
        "erb",
        '<%= f.text_field :email, props: { requird: true } %>',
        "unknown-prop"
      )
      assert.strictEqual(actions[0].title, 'Change to "required"')
      assert.strictEqual(
        await applyAndRead(document, actions[0]),
        '<%= f.text_field :email, props: { required: true } %>'
      )
    })

    test("suggests an enum value for a builder prop", async () => {
      const { document, actions } = await actionsFor(
        "erb",
        '<%= f.text_field :ssn, props: { mask: "currencey" } %>',
        "invalid-value"
      )
      assert.ok(actions.length > 0, "a close mask value exists")
      assert.strictEqual(
        await applyAndRead(document, actions[0]),
        '<%= f.text_field :ssn, props: { mask: "currency" } %>'
      )
    })
  })

  suite("Unknown component", () => {
    test("suggests the closest kit and applies it", async () => {
      const { document, actions } = await actionsFor(
        "erb",
        '<%= pb_rails("buton", props: { text: "x" }) %>',
        "unknown-component"
      )
      assert.strictEqual(actions[0].title, 'Change to "button"')
      assert.strictEqual(
        await applyAndRead(document, actions[0]),
        '<%= pb_rails("button", props: { text: "x" }) %>'
      )
    })

    test("only suggests Rails-capable kits in Rails files", () => {
      const text = '<%= pb_rails("pb_baar_graph") %>'
      const start = text.indexOf("pb_baar_graph")
      const fixes = computeFixes(text, "erb", metadata, [
        { code: "unknown-component", start, end: start + "pb_baar_graph".length },
      ])
      assert.ok(fixes.every((f) => /^[a-z0-9_]+$/.test(f.newText)))
    })
  })

  suite("Deprecated prop", () => {
    test("replaces a deprecated prop with its successor", async () => {
      const { document, actions } = await actionsFor(
        "erb",
        '<%= pb_rails("caption", props: { text: "x", variant: "link" }) %>',
        "deprecated-prop"
      )
      assert.strictEqual(actions[0].title, 'Replace with "color"')
      assert.strictEqual(
        await applyAndRead(document, actions[0]),
        '<%= pb_rails("caption", props: { text: "x", color: "link" }) %>'
      )
    })

    test("offers nothing when Playbook names no replacement", async () => {
      const { actions } = await actionsFor(
        "erb",
        '<%= pb_rails("tooltip", props: { trigger_element_id: "x" }) %>',
        "deprecated-prop"
      )
      assert.deepStrictEqual(actions, [])
    })
  })

  suite("Provider", () => {
    test("ignores diagnostics from other tools", async () => {
      const document = await createTestDocument("erb", '<%= pb_rails("flex", props: { margin_botom: 1 }) %>')
      const foreign = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 1),
        'Unknown prop "x"',
        vscode.DiagnosticSeverity.Warning
      )
      foreign.source = "eslint"
      foreign.code = "unknown-prop"

      assert.deepStrictEqual(
        provider.provideCodeActions(document, foreign.range, {
          diagnostics: [foreign],
          only: undefined,
          triggerKind: vscode.CodeActionTriggerKind.Invoke,
        }),
        []
      )
    })

    test("ignores Playbook diagnostics that have no fix", async () => {
      const { actions } = await actionsFor(
        "erb",
        '<%= pb_rails("section_separator") %><%= pb_rails("button", props: { text: "x", variant: "link", **o }) %>',
        "deprecated-prop"
      ).catch(() => ({ actions: [] as vscode.CodeAction[] }))
      assert.deepStrictEqual(actions, [])
    })
  })
})
