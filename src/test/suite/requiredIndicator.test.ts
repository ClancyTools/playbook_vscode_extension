import * as assert from "assert"
import * as path from "path"
import * as vscode from "vscode"
import { PlaybookDiagnostics } from "../../diagnostics"
import { loadFormBuilderMetadata, loadMetadata, PlaybookMetadata } from "../../metadata"
import { PlaybookQuickFixProvider } from "../../quickFixes"
import { findRequiredIndicatorIssues, withoutTrailingAsterisk } from "../../requiredIndicator"
import { applyEdits } from "../../spacingCombine"
import { createTestDocument } from "./testHelpers"

suite("Required Indicator Test Suite", () => {
  const extensionPath = path.resolve(__dirname, "../../../")
  let metadata: PlaybookMetadata

  suiteSetup(() => {
    metadata = loadMetadata(extensionPath)
  })

  const issues = (languageId: string, text: string) =>
    findRequiredIndicatorIssues(text, languageId, metadata, loadFormBuilderMetadata(extensionPath))

  /** The text after applying the first issue's fix. */
  const fixed = (languageId: string, text: string) => {
    const [issue] = issues(languageId, text)
    assert.ok(issue, `expected an issue in: ${text}`)
    return applyEdits(text, issue.edits)
  }

  suite("withoutTrailingAsterisk", () => {
    test("strips a trailing asterisk, with or without a space or parens", () => {
      assert.strictEqual(withoutTrailingAsterisk("Name *"), "Name")
      assert.strictEqual(withoutTrailingAsterisk("SUBJECT*"), "SUBJECT")
      assert.strictEqual(withoutTrailingAsterisk("Name (*)"), "Name")
      assert.strictEqual(withoutTrailingAsterisk("Regions, Territories, and Branches*"), "Regions, Territories, and Branches")
      assert.strictEqual(withoutTrailingAsterisk("Name **"), "Name")
    })

    test("leaves alone anything that isn't a trailing required marker", () => {
      assert.strictEqual(withoutTrailingAsterisk("*"), undefined, "a lone asterisk")
      assert.strictEqual(withoutTrailingAsterisk("*REQUIRED: do this"), undefined, "a leading note")
      assert.strictEqual(withoutTrailingAsterisk("Hourly Rate * 1.5"), undefined, "mid-text")
      assert.strictEqual(withoutTrailingAsterisk("Name"), undefined)
      assert.strictEqual(withoutTrailingAsterisk(""), undefined)
      assert.strictEqual(withoutTrailingAsterisk('Name <%= x %> *'), undefined, "interpolated")
      assert.strictEqual(withoutTrailingAsterisk("Name #{x} *"), undefined)
    })
  })

  suite("Labels on inputs", () => {
    test("React: removes the asterisk and adds requiredIndicator", () => {
      const text = '<TextInput label="Name *" />'
      const [issue] = issues("typescriptreact", text)
      assert.strictEqual(issue.kind, "label")
      assert.strictEqual(text.slice(issue.start, issue.end), '"Name *"')
      assert.ok(issue.message.includes('Use requiredIndicator instead of a "*" in the label'), issue.message)
      assert.ok(issue.message.includes("visual only"), issue.message)
      assert.strictEqual(fixed("typescriptreact", text), '<TextInput label="Name" requiredIndicator />')
    })

    test("React: inserts the prop in alphabetical position so the order warning isn't triggered", () => {
      assert.strictEqual(
        fixed("typescriptreact", '<TextInput label="Name *" value={v} />'),
        '<TextInput label="Name" requiredIndicator value={v} />'
      )
      assert.strictEqual(
        fixed("typescriptreact", '<TextInput label="Name *" placeholder="x" />'),
        '<TextInput label="Name" placeholder="x" requiredIndicator />'
      )
    })

    test("React: works across lines", () => {
      assert.strictEqual(
        fixed("typescriptreact", '<Select\n  label="Tier *"\n  options={o}\n  value={v}\n/>'),
        '<Select\n  label="Tier"\n  options={o}\n  requiredIndicator value={v}\n/>'
      )
    })

    test("Rails: adds required_indicator: true after the label", () => {
      assert.strictEqual(
        fixed("erb", '<%= pb_rails("text_input", props: { label: "Name *", placeholder: "x" }) %>'),
        '<%= pb_rails("text_input", props: { label: "Name", required_indicator: true, placeholder: "x" }) %>'
      )
    })

    test("form builder calls are covered", () => {
      const text = '<%= f.text_field :name, props: { label: "Name *" } %>'
      assert.strictEqual(fixed("erb", text), '<%= f.text_field :name, props: { label: "Name", required_indicator: true } %>')
      assert.strictEqual(issues("erb", text).length, 1, "reported once")
    })

    test("Checkbox's label is its text prop", () => {
      assert.strictEqual(fixed("typescriptreact", '<Checkbox text="Agree *" />'), '<Checkbox requiredIndicator text="Agree" />')
    })

    test("covers the kits that have a required indicator", () => {
      for (const kit of ["TextInput", "Textarea", "Select", "Dropdown", "Typeahead", "DatePicker", "MultiLevelSelect"]) {
        assert.strictEqual(issues("typescriptreact", `<${kit} label="Field *" />`).length, 1, kit)
      }
    })

    test("turns on a required indicator that was explicitly off", () => {
      assert.strictEqual(
        fixed("typescriptreact", '<TextInput label="Name *" requiredIndicator={false} />'),
        '<TextInput label="Name" requiredIndicator />'
      )
      assert.strictEqual(
        fixed("erb", '<%= pb_rails("text_input", props: { label: "Name *", required_indicator: false }) %>'),
        '<%= pb_rails("text_input", props: { label: "Name", required_indicator: true }) %>'
      )
    })

    test("handles single quotes and a brace-wrapped label", () => {
      assert.strictEqual(fixed("typescriptreact", "<TextInput label='Name *' />"), "<TextInput label='Name' requiredIndicator />")
      assert.strictEqual(fixed("typescriptreact", '<TextInput label={"Name *"} />'), '<TextInput label={"Name"} requiredIndicator />')
    })
  })

  suite("False positives it must avoid", () => {
    test("a label with no trailing asterisk", () => {
      assert.deepStrictEqual(issues("typescriptreact", '<TextInput label="Name" />'), [])
      assert.deepStrictEqual(issues("typescriptreact", '<TextInput label="Rate * 1.5" />'), [])
      assert.deepStrictEqual(issues("typescriptreact", '<TextInput label="*" />'), [])
    })

    test("dynamic labels", () => {
      assert.deepStrictEqual(issues("typescriptreact", "<TextInput label={label} />"), [])
      assert.deepStrictEqual(issues("typescriptreact", "<TextInput label={`${name} *`} />"), [])
      assert.deepStrictEqual(issues("erb", '<%= pb_rails("text_input", props: { label: "#{name} *" }) %>'), [])
    })

    test("kits that have no required indicator", () => {
      assert.deepStrictEqual(issues("typescriptreact", '<LabelValue label="Recipient Type*" />'), [], "label_value has no indicator")
      assert.deepStrictEqual(issues("typescriptreact", '<Body text="$3,500*" />'), [])
      assert.deepStrictEqual(issues("typescriptreact", '<Title text="Special Offer*" />'), [])
      assert.deepStrictEqual(issues("typescriptreact", '<Radio label="Option *" />'), [])
    })

    test("an app's own wrapper components, which may not forward the prop", () => {
      assert.deepStrictEqual(issues("typescriptreact", '<InputField label="First Name *" />'), [])
      assert.deepStrictEqual(issues("typescriptreact", '<Field label="Pay *" />'), [])
    })

    test("props spread in, which may supply the indicator", () => {
      assert.deepStrictEqual(issues("typescriptreact", '<TextInput {...rest} label="Name *" />'), [])
      assert.deepStrictEqual(issues("erb", '<%= pb_rails("text_input", props: { label: "Name *", **opts }) %>'), [])
    })

    test("required_indicator set from a variable", () => {
      assert.deepStrictEqual(issues("typescriptreact", '<TextInput label="Name *" requiredIndicator={isRequired} />'), [])
    })

    test("the asterisk in the placeholder, text or other props of an input", () => {
      assert.deepStrictEqual(issues("typescriptreact", '<TextInput label="Name" placeholder="Required *" />'), [])
    })

    test("a kit used with an unknown name", () => {
      assert.deepStrictEqual(issues("erb", '<%= pb_rails("not_a_kit", props: { label: "Name *" }) %>'), [])
    })
  })

  suite("Both an asterisk and the indicator", () => {
    test("is a warning that the asterisk shows twice, fixed by removing it", () => {
      const text = '<TextInput label="Name *" requiredIndicator />'
      const [issue] = issues("typescriptreact", text)
      assert.strictEqual(issue.kind, "double")
      assert.ok(issue.message.includes("shows twice"), issue.message)
      assert.strictEqual(applyEdits(text, issue.edits), '<TextInput label="Name" requiredIndicator />')
    })

    test("also in Rails", () => {
      const [issue] = issues("erb", '<%= pb_rails("text_input", props: { label: "Name *", required_indicator: true }) %>')
      assert.strictEqual(issue.kind, "double")
    })
  })

  suite("A Caption standing in for an input's label", () => {
    const pair = (caption: string, next: string) => `${caption}\n${next}`

    test("is a soft hint when it sits right before an input with no label", () => {
      const text = pair('<Caption text="Amount *" />', '<TextInput name="amount" />')
      const [issue] = issues("typescriptreact", text)
      assert.strictEqual(issue.kind, "caption")
      assert.ok(issue.message.includes("text_input"), issue.message)
      assert.deepStrictEqual(issue.edits, [], "no automatic edit: moving the label is the developer's call")
    })

    test("works in Rails", () => {
      const text = pair('<%= pb_rails("caption", props: { text: "Salary *" }) %>', '<%= pb_rails("text_input", props: { name: "s" }) %>')
      assert.strictEqual(issues("erb", text)[0].kind, "caption")
    })

    test("is not raised when the input already has its own label", () => {
      assert.deepStrictEqual(issues("typescriptreact", pair('<Caption text="Amount *" />', '<TextInput label="Amount" />')), [])
    })

    test("is not raised when what follows isn't an input with a required indicator", () => {
      assert.deepStrictEqual(issues("typescriptreact", pair('<Caption text="Pick one *" />', '<Radio name="a" />')), [], "radio has no indicator")
      assert.deepStrictEqual(issues("typescriptreact", pair('<Caption text="Notes *" />', "<Body text='x' />")), [])
      assert.deepStrictEqual(issues("typescriptreact", pair('<Caption text="Section *" />', "<Flex />")), [])
    })

    test("is not raised when the input is far away", () => {
      assert.deepStrictEqual(issues("typescriptreact", pair('<Caption text="Amount *" />', " ".repeat(500) + '<TextInput name="a" />')), [])
    })

    test("is not raised for captions without an asterisk, or dynamic text", () => {
      assert.deepStrictEqual(issues("typescriptreact", pair('<Caption text="Amount" />', '<TextInput name="a" />')), [])
      assert.deepStrictEqual(issues("typescriptreact", pair("<Caption text={t} />", '<TextInput name="a" />')), [])
    })
  })

  suite("Diagnostics and quick fix", () => {
    let diagnostics: PlaybookDiagnostics
    let fixes: PlaybookQuickFixProvider

    suiteSetup(() => {
      diagnostics = new PlaybookDiagnostics(extensionPath)
      fixes = new PlaybookQuickFixProvider(extensionPath)
    })
    suiteTeardown(() => diagnostics.dispose())

    async function run(languageId: string, content: string) {
      const document = await createTestDocument(languageId, content)
      diagnostics.updateDiagnostics(document)
      return { document, found: diagnostics.getDiagnostics(document.uri).filter((d) => /required-indicator/.test(String(d.code))) }
    }

    test("reports an information diagnostic with a code", async () => {
      const { found } = await run("typescriptreact", '<TextInput label="Name *" />')
      assert.strictEqual(found.length, 1)
      assert.strictEqual(found[0].code, "required-indicator")
      assert.strictEqual(found[0].severity, vscode.DiagnosticSeverity.Information)
    })

    test("the double case is a warning and the caption case a hint", async () => {
      assert.strictEqual(
        (await run("typescriptreact", '<TextInput label="Name *" requiredIndicator />')).found[0].severity,
        vscode.DiagnosticSeverity.Warning
      )
      assert.strictEqual(
        (await run("typescriptreact", '<Caption text="A *" />\n<TextInput name="a" />')).found[0].severity,
        vscode.DiagnosticSeverity.Hint
      )
    })

    test("the quick fix applies the whole change in one edit", async () => {
      const { document, found } = await run("typescriptreact", '<TextInput label="Name *" value={v} />')
      const [action] = fixes.provideCodeActions(document, found[0].range, {
        diagnostics: [found[0]],
        only: undefined,
        triggerKind: vscode.CodeActionTriggerKind.Invoke,
      })
      assert.strictEqual(action.title, 'Remove the "*" and use requiredIndicator')
      await vscode.workspace.applyEdit(action.edit!)
      assert.strictEqual(document.getText(), '<TextInput label="Name" requiredIndicator value={v} />')
    })

    test("the fix doesn't introduce a prop-order warning", async () => {
      const { document, found } = await run("typescriptreact", '<TextInput label="Name *" value={v} />')
      const [action] = fixes.provideCodeActions(document, found[0].range, {
        diagnostics: [found[0]],
        only: undefined,
        triggerKind: vscode.CodeActionTriggerKind.Invoke,
      })
      await vscode.workspace.applyEdit(action.edit!)
      diagnostics.updateDiagnostics(document)
      assert.ok(!diagnostics.getDiagnostics(document.uri).some((d) => d.message.includes("alphabetical")))
    })

    test("the caption hint has no quick fix", async () => {
      const { document, found } = await run("typescriptreact", '<Caption text="A *" />\n<TextInput name="a" />')
      assert.deepStrictEqual(
        fixes.provideCodeActions(document, found[0].range, {
          diagnostics: [found[0]],
          only: undefined,
          triggerKind: vscode.CodeActionTriggerKind.Invoke,
        }),
        []
      )
    })

    test("can be turned off", async () => {
      const config = vscode.workspace.getConfiguration("playbook")
      await config.update("diagnostics.requiredIndicator", false, vscode.ConfigurationTarget.Global)
      try {
        assert.deepStrictEqual((await run("typescriptreact", '<TextInput label="Name *" />')).found, [])
      } finally {
        await config.update("diagnostics.requiredIndicator", undefined, vscode.ConfigurationTarget.Global)
      }
    })
  })
})
