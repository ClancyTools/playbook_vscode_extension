import * as assert from "assert"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import { AxisHints } from "../../axisHints"
import { PlaybookCompletionProvider } from "../../completionProvider"
import { PlaybookDefinitionProvider } from "../../definitionProvider"
import { PlaybookDiagnostics } from "../../diagnostics"
import { PlaybookHoverProvider } from "../../hoverProvider"
import { resetIconIndex } from "../../playbookIcons"
import { ColorSwatches } from "../../previewHints"
import { PlaybookQuickFixProvider } from "../../quickFixes"
import { enabled, setting } from "../../settings"
import { SpacingHints } from "../../spacingHints"
import {
  createCancellationToken,
  createCompletionContext,
  createTestDocument,
  getCompletionItems,
} from "./testHelpers"

suite("Opt-out Settings Test Suite", function () {
  // Each test changes settings and reopens documents, which is slow on CI runners (macOS timed out at 10s).
  this.timeout(60000)

  const extensionPath = path.resolve(__dirname, "../../../")
  const config = () => vscode.workspace.getConfiguration("playbook")

  /** Runs `fn` with a setting changed, then puts it back. */
  async function with_(settings: Record<string, unknown>, fn: () => Promise<void> | void): Promise<void> {
    for (const [key, value] of Object.entries(settings)) {
      await config().update(key, value, vscode.ConfigurationTarget.Global)
    }
    try {
      await fn()
    } finally {
      for (const key of Object.keys(settings)) {
        await config().update(key, undefined, vscode.ConfigurationTarget.Global)
      }
    }
  }

  const hoverText = (hover: vscode.Hover | null | undefined) =>
    hover ? hover.contents.map((c) => (c as vscode.MarkdownString).value).join("\n") : ""

  async function hoverAt(languageId: string, content: string, needle: string, offset = 1) {
    const provider = new PlaybookHoverProvider(extensionPath)
    const document = await createTestDocument(languageId, content)
    return provider.provideHover(document, document.positionAt(content.indexOf(needle) + offset)) as vscode.Hover | null
  }

  async function complete(languageId: string, content: string, marker: string) {
    const provider = new PlaybookCompletionProvider(extensionPath)
    const document = await createTestDocument(languageId, content)
    const position = document.positionAt(content.indexOf(marker) + marker.length)
    return getCompletionItems(
      await provider.provideCompletionItems(document, position, createCancellationToken(), createCompletionContext())
    )
  }

  suite("Declared settings", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionPath, "package.json"), "utf-8"))
    const properties: Record<string, { type: string; default: unknown; description: string }> =
      manifest.contributes.configuration.properties

    const SWITCHES = [
      "playbook.enabled",
      "playbook.hover.enabled",
      "playbook.hover.kitGuidance",
      "playbook.hover.globalProps",
      "playbook.hover.valuePreviews",
      "playbook.completion.enabled",
      "playbook.completion.presets",
      "playbook.completion.icons",
      "playbook.diagnostics.enabled",
      "playbook.diagnostics.validation",
      "playbook.diagnostics.propOrder",
      "playbook.diagnostics.deprecations",
      "playbook.diagnostics.propDependencies",
      "playbook.diagnostics.externalDependencies",
      "playbook.diagnostics.unknownIcons",
      "playbook.diagnostics.unknownColors",
      "playbook.diagnostics.combineSpacing",
      "playbook.diagnostics.requiredIndicator",
      "playbook.diagnostics.bootstrap",
      "playbook.quickFixes.enabled",
      "playbook.flexAxis.enabled",
      "playbook.spacingHints",
      "playbook.axisHints",
      "playbook.colorSwatches",
      "playbook.definition.enabled",
      "playbook.statusBar.enabled",
      "playbook.kitBrowser.enabled",
    ]

    test("every feature has a boolean switch with a description", () => {
      for (const key of SWITCHES) {
        assert.ok(properties[key], `${key} is declared`)
        assert.strictEqual(properties[key].type, "boolean", key)
        assert.ok(properties[key].description.length > 20, `${key} is described`)
      }
    })

    test("everything is on by default except the opt-in Bootstrap hint", () => {
      for (const key of SWITCHES) {
        assert.strictEqual(properties[key].default, key === "playbook.diagnostics.bootstrap" ? false : true, key)
      }
    })

    test("no boolean setting is missing from the list of switches", () => {
      const declared = Object.entries(properties).filter(([, v]) => v.type === "boolean").map(([k]) => k)
      assert.deepStrictEqual(declared.filter((k) => !SWITCHES.includes(k)), [], "add new switches to SWITCHES")
    })

    test("the Explorer view follows the kit browser switch", () => {
      assert.strictEqual(manifest.contributes.views.explorer[0].when, "playbook.kitBrowserEnabled")
    })

    test("enabled() needs the master and every key", async () => {
      assert.ok(enabled("hover.enabled"))
      await with_({ enabled: false }, () => {
        assert.ok(!enabled())
        assert.ok(!enabled("hover.enabled"))
      })
      await with_({ "hover.enabled": false }, () => {
        assert.ok(!enabled("hover.enabled"))
        assert.ok(enabled("completion.enabled"))
        assert.strictEqual(setting("hover.enabled", true), false)
      })
    })
  })

  suite("Hover", () => {
    const BUTTON = '<Button text="x" />'

    test("hover.enabled turns every hover off", async () => {
      assert.ok(await hoverAt("typescriptreact", BUTTON, "Button", 2))
      await with_({ "hover.enabled": false }, async () => {
        assert.strictEqual(await hoverAt("typescriptreact", BUTTON, "Button", 2), null)
        assert.strictEqual(await hoverAt("typescriptreact", BUTTON, "text"), null)
      })
    })

    test("hover.kitGuidance removes Playbook's notes but keeps the kit docs", async () => {
      const kit = '<Dropdown options={o} />'
      assert.ok(hoverText(await hoverAt("typescriptreact", kit, "Dropdown", 2)).includes("Presets:"))
      await with_({ "hover.kitGuidance": false }, async () => {
        const text = hoverText(await hoverAt("typescriptreact", kit, "Dropdown", 2))
        assert.ok(!text.includes("Presets:") && !text.includes("FAQ"), text)
        assert.ok(text.includes("## Props"), "the props list is still there")
      })
    })

    test("hover.kitGuidance also removes what a prop is used with", async () => {
      const prop = "<Dropdown formPillProps={{}} options={o} />"
      assert.ok(hoverText(await hoverAt("typescriptreact", prop, "formPillProps", 3)).includes("Used together with"))
      await with_({ "hover.kitGuidance": false }, async () => {
        assert.ok(!hoverText(await hoverAt("typescriptreact", prop, "formPillProps", 3)).includes("Used together with"))
      })
    })

    test("hover.globalProps removes the global props section", async () => {
      assert.ok(hoverText(await hoverAt("typescriptreact", BUTTON, "Button", 2)).includes("## Global Props"))
      await with_({ "hover.globalProps": false }, async () => {
        const text = hoverText(await hoverAt("typescriptreact", BUTTON, "Button", 2))
        assert.ok(!text.includes("## Global Props") && text.includes("## Props"), text)
      })
    })

    test("hover.valuePreviews removes the color hover", async () => {
      const card = '<Card background="bg_light" />'
      assert.ok(hoverText(await hoverAt("typescriptreact", card, "bg_light", 2)).includes("Playbook color token"))
      await with_({ "hover.valuePreviews": false }, async () => {
        assert.ok(!hoverText(await hoverAt("typescriptreact", card, "bg_light", 2)).includes("Playbook color token"))
      })
    })

    test("the master switch turns hover off", async () => {
      await with_({ enabled: false }, async () => {
        assert.strictEqual(await hoverAt("typescriptreact", BUTTON, "Button", 2), null)
      })
    })
  })

  suite("Completion", () => {
    test("completion.enabled turns every completion off", async () => {
      assert.ok((await complete("typescriptreact", "<Bu", "<Bu")).length > 0)
      await with_({ "completion.enabled": false }, async () => {
        assert.deepStrictEqual(await complete("typescriptreact", "<Bu", "<Bu"), [])
        assert.deepStrictEqual(await complete("erb", '<%= pb_rails("', '<%= pb_rails("'), [])
        assert.deepStrictEqual(await complete("erb", "<%= f.", "<%= f."), [])
      })
    })

    test("completion.presets removes presets but keeps kit names", async () => {
      assert.ok((await complete("typescriptreact", "<Dr", "<Dr")).some((i) => i.label === "Dropdown: Create tags"))
      await with_({ "completion.presets": false }, async () => {
        const items = await complete("typescriptreact", "<Dr", "<Dr")
        assert.ok(!items.some((i) => i.detail === "Playbook preset"))
        assert.ok(items.some((i) => i.label === "Dropdown"))
        const rails = await complete("erb", '<%= pb_rails("', '<%= pb_rails("')
        assert.ok(!rails.some((i) => i.detail === "Playbook preset") && rails.some((i) => i.label === "dropdown"))
      })
    })

    test("completion.icons removes icon names", async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "playbook-optout-"))
      fs.mkdirSync(path.join(tmp, "icons", "a"), { recursive: true })
      fs.writeFileSync(path.join(tmp, "icons", "a", "wrench.svg"), "<svg/>")
      try {
        await with_({ "icons.path": tmp }, async () => {
          resetIconIndex()
          assert.ok((await complete("typescriptreact", '<Button icon="" />', 'icon="')).some((i) => i.label === "wrench"))
          await with_({ "completion.icons": false }, async () => {
            assert.ok(!(await complete("typescriptreact", '<Button icon="" />', 'icon="')).some((i) => i.label === "wrench"))
          })
        })
      } finally {
        resetIconIndex()
        fs.rmSync(tmp, { recursive: true, force: true })
      }
    })

    test("the master switch turns completion off", async () => {
      await with_({ enabled: false }, async () => {
        assert.deepStrictEqual(await complete("typescriptreact", "<Bu", "<Bu"), [])
      })
    })
  })

  suite("Diagnostics", () => {
    let diagnostics: PlaybookDiagnostics

    suiteSetup(() => {
      diagnostics = new PlaybookDiagnostics(extensionPath)
    })
    suiteTeardown(() => diagnostics.dispose())

    async function codes(languageId: string, content: string) {
      const document = await createTestDocument(languageId, content)
      diagnostics.updateDiagnostics(document)
      return { document, list: diagnostics.getDiagnostics(document.uri) }
    }

    const BAD = '<%= pb_rails("flex", props: { horizontal: "center", not_a_prop: 1 }) %>'

    test("diagnostics.enabled turns them all off and clears the ones already shown", async () => {
      const { document, list } = await codes("erb", BAD)
      assert.ok(list.length >= 2, "deprecated prop and unknown prop")
      await with_({ "diagnostics.enabled": false }, async () => {
        diagnostics.updateDiagnostics(document)
        assert.deepStrictEqual(diagnostics.getDiagnostics(document.uri), [])
      })
    })

    test("diagnostics.validation turns off the core checks but not the other rules", async () => {
      await with_({ "diagnostics.validation": false }, async () => {
        const { list } = await codes("erb", BAD)
        assert.ok(!list.some((d) => d.code === "unknown-prop"), "no unknown-prop")
        assert.ok(list.some((d) => d.code === "deprecated-prop"), "deprecations still reported")
      })
    })

    test("diagnostics.validation also covers form builder props and snake_case React props", async () => {
      await with_({ "diagnostics.validation": false }, async () => {
        assert.deepStrictEqual((await codes("erb", '<%= f.text_field :a, props: { nope: 1 } %>')).list, [])
        assert.ok(!(await codes("typescriptreact", '<Flex margin_bottom="xs" />')).list.some((d) => d.code === "wrong-prop-case"))
      })
    })

    test("diagnostics.propOrder turns off the alphabetical order warning only", async () => {
      const outOfOrder = '<Button variant="link" text="x" />'
      assert.ok((await codes("typescriptreact", outOfOrder)).list.some((d) => d.message.includes("alphabetical")))
      await with_({ "diagnostics.propOrder": false }, async () => {
        assert.ok(!(await codes("typescriptreact", outOfOrder)).list.some((d) => d.message.includes("alphabetical")))
        assert.ok((await codes("typescriptreact", '<Button nope="x" />')).list.some((d) => d.code === "unknown-prop"), "other checks stay")
      })
    })

    test("each rule has its own switch", async () => {
      const cases: Array<[string, string, string, string]> = [
        ["diagnostics.deprecations", "erb", BAD, "deprecated-prop"],
        ["diagnostics.propDependencies", "typescriptreact", "<Dropdown options={o} showPillIndex />", "prop-dependency"],
        ["diagnostics.combineSpacing", "typescriptreact", '<Card paddingTop="sm" paddingBottom="sm" />', "combine-spacing"],
        ["diagnostics.requiredIndicator", "typescriptreact", '<TextInput label="Name *" />', "required-indicator"],
        ["diagnostics.unknownColors", "typescriptreact", '<Icon icon="x" color="gray" />', "unknown-kit-color"],
      ]
      for (const [key, language, content, code] of cases) {
        assert.ok((await codes(language, content)).list.some((d) => d.code === code), `${code} is on by default`)
        await with_({ [key]: false }, async () => {
          assert.ok(!(await codes(language, content)).list.some((d) => d.code === code), `${key} turns ${code} off`)
        })
      }
    })

    test("the master switch turns diagnostics off", async () => {
      await with_({ enabled: false }, async () => {
        assert.deepStrictEqual((await codes("erb", BAD)).list, [])
      })
    })
  })

  suite("Quick fixes", () => {
    async function actions() {
      const diagnostics = new PlaybookDiagnostics(extensionPath)
      const fixes = new PlaybookQuickFixProvider(extensionPath)
      const document = await createTestDocument("erb", '<%= pb_rails("flex", props: { margin_botom: "xs" }) %>')
      diagnostics.updateDiagnostics(document)
      const found = diagnostics.getDiagnostics(document.uri).filter((d) => d.code === "unknown-prop")
      const result = fixes.provideCodeActions(document, found[0].range, {
        diagnostics: found,
        only: undefined,
        triggerKind: vscode.CodeActionTriggerKind.Invoke,
      })
      diagnostics.dispose()
      return result
    }

    test("quickFixes.enabled turns them off while the diagnostics stay", async () => {
      assert.ok((await actions()).length > 0)
      await with_({ "quickFixes.enabled": false }, async () => {
        assert.deepStrictEqual(await actions(), [])
      })
    })

    test("the master switch turns them off", async () => {
      await with_({ enabled: false }, async () => {
        // with everything off there are no diagnostics to fix, and no fixes either way
        const fixes = new PlaybookQuickFixProvider(extensionPath)
        const document = await createTestDocument("erb", "x")
        assert.deepStrictEqual(
          fixes.provideCodeActions(document, new vscode.Range(0, 0, 0, 0), {
            diagnostics: [],
            only: undefined,
            triggerKind: vscode.CodeActionTriggerKind.Invoke,
          }),
          []
        )
      })
    })
  })

  suite("Flex axis", () => {
    const FLEX = '<Flex justify="center" />'
    const DEPRECATED = '<%= pb_rails("flex", props: { horizontal: "center" }) %>'

    test("flexAxis.enabled turns off the inline hint", async () => {
      const hints = new AxisHints(extensionPath)
      try {
        const document = await createTestDocument("typescriptreact", FLEX)
        assert.strictEqual(hints.compute(document).length, 1)
        await with_({ "flexAxis.enabled": false }, () => assert.deepStrictEqual(hints.compute(document), []))
        await with_({ axisHints: false }, () => assert.deepStrictEqual(hints.compute(document), []))
      } finally {
        hints.dispose()
      }
    })

    test("flexAxis.enabled turns off the axis hover", async () => {
      assert.ok(hoverText(await hoverAt("typescriptreact", FLEX, "justify", 2)).includes("**Axis:**"))
      await with_({ "flexAxis.enabled": false }, async () => {
        assert.ok(!hoverText(await hoverAt("typescriptreact", FLEX, "justify", 2)).includes("**Axis:**"))
      })
    })

    test("flexAxis.enabled turns off the axis detail on value completions", async () => {
      const detail = async () =>
        (await complete("typescriptreact", '<Flex justify="" />', 'justify="')).find((i) => i.label === "start")?.detail ?? ""
      assert.ok((await detail()).includes("↔"))
      await with_({ "flexAxis.enabled": false }, async () => {
        assert.ok(!(await detail()).includes("↔"))
      })
    })

    test("flexAxis.enabled turns off the migration message and fix", async () => {
      const diagnostics = new PlaybookDiagnostics(extensionPath)
      const fixes = new PlaybookQuickFixProvider(extensionPath)
      const run = async () => {
        const document = await createTestDocument("erb", DEPRECATED)
        diagnostics.updateDiagnostics(document)
        const d = diagnostics.getDiagnostics(document.uri).find((x) => x.code === "deprecated-prop")!
        const actions = fixes.provideCodeActions(document, d.range, {
          diagnostics: [d],
          only: undefined,
          triggerKind: vscode.CodeActionTriggerKind.Invoke,
        })
        return { message: d.message, actions }
      }
      try {
        const on = await run()
        assert.ok(on.message.includes("Use justify"), on.message)
        assert.ok(on.actions.length > 0)
        await with_({ "flexAxis.enabled": false }, async () => {
          const off = await run()
          assert.strictEqual(off.message, 'Prop "horizontal" is deprecated.')
          assert.deepStrictEqual(off.actions, [])
        })
      } finally {
        diagnostics.dispose()
      }
    })
  })

  suite("Inline hints and definition", () => {
    test("spacingHints and colorSwatches follow their switches and the master", async () => {
      const spacing = new SpacingHints(extensionPath)
      const colors = new ColorSwatches(extensionPath)
      try {
        const card = await createTestDocument("typescriptreact", '<Card padding="md" background="bg_light" />')
        assert.strictEqual(spacing.compute(card).length, 1)
        assert.strictEqual(colors.compute(card).length, 1)
        await with_({ enabled: false }, () => {
          assert.deepStrictEqual(spacing.compute(card), [])
          assert.deepStrictEqual(colors.compute(card), [])
        })
        await with_({ spacingHints: false }, () => assert.deepStrictEqual(spacing.compute(card), []))
        await with_({ colorSwatches: false }, () => assert.deepStrictEqual(colors.compute(card), []))
      } finally {
        spacing.dispose()
        colors.dispose()
      }
    })

    test("definition.enabled turns off go to definition", async () => {
      const provider = new PlaybookDefinitionProvider(extensionPath)
      const content = '<%= pb_rails("button", props: {}) %>'
      const document = await createTestDocument("erb", content)
      const position = document.positionAt(content.indexOf("button") + 2)
      assert.ok(provider.provideDefinition(document, position), "on by default")
      await with_({ "definition.enabled": false }, () => {
        assert.ok(!provider.provideDefinition(document, position))
      })
      await with_({ enabled: false }, () => {
        assert.ok(!provider.provideDefinition(document, position))
      })
    })
  })
})
