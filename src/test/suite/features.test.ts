import * as assert from "assert"
import * as path from "path"
import * as vscode from "vscode"
import { PlaybookCompletionProvider } from "../../completionProvider"
import { PlaybookHoverProvider } from "../../hoverProvider"
import {
  ComponentMetadata,
  findComponentByRailsName,
  loadMetadata,
  PlaybookMetadata,
} from "../../metadata"
import { loadPlayground } from "../../playgrounds"
import { renderPresets } from "../../presets"
import { SpacingHints, spacingAnnotations, spacingPropNames } from "../../spacingHints"
import {
  createCancellationToken,
  createCompletionContext,
  createTestDocument,
  getCompletionItems,
} from "./testHelpers"

suite("Feature Test Suite", () => {
  const extensionPath = path.resolve(__dirname, "../../../")
  let metadata: PlaybookMetadata

  suiteSetup(() => {
    metadata = loadMetadata(extensionPath)
  })

  function kit(name: string): ComponentMetadata {
    const component = findComponentByRailsName(metadata, name)
    assert.ok(component, `kit ${name} should exist`)
    return component
  }

  function hoverText(hover: vscode.Hover | null | undefined): string {
    assert.ok(hover, "expected a hover")
    return hover.contents.map((c) => (c as vscode.MarkdownString).value).join("\n")
  }

  suite("renderPresets", () => {
    test("renders a preset as Rails props and JSX attributes", () => {
      const presets = renderPresets(kit("dropdown"), loadPlayground(extensionPath, "dropdown"), "erb")
      const tags = presets.find((p) => p.name === "Create tags")

      assert.ok(tags, "Dropdown has a Create tags preset")
      assert.strictEqual(
        tags.rails,
        'allow_option_creation: true, multi_select: true, name: "tags[]", label: "Tags"'
      )
      assert.strictEqual(tags.react, 'allowOptionCreation multiSelect name="tags[]" label="Tags"')
    })

    test("skips presets that need a composition rather than props", () => {
      const names = renderPresets(kit("dropdown"), loadPlayground(extensionPath, "dropdown"), "erb").map(
        (p) => p.name
      )
      assert.ok(!names.includes("Async search"), "structureMode presets need wrapper code")
    })

    test("keeps camelCase keys nested inside a value for Rails", () => {
      const presets = renderPresets(kit("dropdown"), loadPlayground(extensionPath, "dropdown"), "erb")
      const custom = presets.find((p) => p.name === "Quick pick custom")!

      assert.ok(custom.rails.includes("custom_quick_pick_dates: {"), custom.rails)
      assert.ok(custom.rails.includes("timePeriod:"), "nested data keeps its spelling")
    })

    test("renders nested objects as JSX expressions", () => {
      const presets = renderPresets(kit("dropdown"), loadPlayground(extensionPath, "dropdown"), "typescriptreact")
      const custom = presets.find((p) => p.name === "Quick pick custom")!
      assert.ok(custom.react.includes("customQuickPickDates={{ dates: ["), custom.react)
    })

    test("drops props that exist only on the other platform", () => {
      const component = {
        props: { foo: { type: "string", platforms: ["react"] }, bar: { type: "string" } },
      } as unknown as ComponentMetadata
      const playground = { presets: [{ name: "Mixed", props: { foo: 1, bar: "x" } }] }

      assert.strictEqual(renderPresets(component, playground, "erb")[0].rails, 'bar: "x"')
      assert.strictEqual(renderPresets(component, playground, "typescriptreact")[0].react, 'foo={1} bar="x"')
    })

    test("omits a preset with nothing left for the platform", () => {
      const component = { props: { foo: { type: "string", platforms: ["react"] } } } as unknown as ComponentMetadata
      const playground = { presets: [{ name: "ReactOnly", props: { foo: 1 } }] }
      assert.deepStrictEqual(renderPresets(component, playground, "erb"), [])
    })

    test("uses braces for strings that cannot sit in a quoted attribute", () => {
      const component = { props: {} } as unknown as ComponentMetadata
      const playground = { presets: [{ name: "Quote", props: { text: 'say "hi"' } }] }
      assert.strictEqual(renderPresets(component, playground, "typescriptreact")[0].react, 'text={"say \\"hi\\""}')
    })

    test("escapes Ruby interpolation in strings", () => {
      const component = { props: {} } as unknown as ComponentMetadata
      const playground = { presets: [{ name: "Hash", props: { text: "a #{b}" } }] }
      assert.strictEqual(renderPresets(component, playground, "erb")[0].rails, 'text: "a \\#{b}"')
    })

    test("returns nothing without a playground", () => {
      assert.deepStrictEqual(renderPresets(kit("button"), undefined, "erb"), [])
    })
  })

  suite("Preset completions", () => {
    let provider: PlaybookCompletionProvider

    suiteSetup(() => {
      provider = new PlaybookCompletionProvider(extensionPath)
    })

    async function complete(languageId: string, content: string, character: number) {
      const document = await createTestDocument(languageId, content)
      const result = await provider.provideCompletionItems(
        document,
        new vscode.Position(0, character),
        createCancellationToken(),
        createCompletionContext()
      )
      return getCompletionItems(result)
    }

    test("offers React presets next to the kit names", async () => {
      const items = await complete("typescriptreact", "<Dr", 3)
      const preset = items.find((i) => i.label === "Dropdown: Create tags")

      assert.ok(preset, "preset completion present")
      assert.ok(items.some((i) => i.label === "Dropdown"), "plain kit completion still present")
      const snippet = preset.insertText as vscode.SnippetString
      assert.ok(snippet.value.includes('allowOptionCreation multiSelect name="tags[]"'), snippet.value)
      assert.strictEqual(preset.detail, "Playbook preset")
    })

    test("closes a React preset for a kit without children", async () => {
      const items = await complete("typescriptreact", "<Ba", 3)
      const preset = items.find((i) => i.label.toString().startsWith("Badge: "))
      assert.ok(preset)
      assert.ok((preset.insertText as vscode.SnippetString).value.endsWith(" />"))
    })

    test("offers Rails presets after pb_rails(\"", async () => {
      const content = '<%= pb_rails("'
      const items = await complete("erb", content, content.length)
      const preset = items.find((i) => i.label === "dropdown: Create tags")

      assert.ok(preset, "preset completion present")
      assert.strictEqual(
        preset.insertText,
        'dropdown", props: { allow_option_creation: true, multi_select: true, name: "tags[]", label: "Tags" }'
      )
    })

    test("replaces an auto-closed quote and paren and restores the paren", async () => {
      const content = '<%= pb_rails("") %>'
      const items = await complete("erb", content, '<%= pb_rails("'.length)
      const preset = items.find((i) => i.label === "dropdown: Create tags")!

      assert.ok((preset.insertText as string).endsWith("}"+")"), preset.insertText as string)
      const range = preset.range as vscode.Range
      assert.strictEqual(range.end.character - range.start.character, 2, "swallows the \"\" and )")
    })

    test("only replaces the quote when no paren follows", async () => {
      const content = '<%= pb_rails("" %>'
      const items = await complete("erb", content, '<%= pb_rails("'.length)
      const preset = items.find((i) => i.label === "dropdown: Create tags")!

      assert.ok(!(preset.insertText as string).endsWith(")"))
      const range = preset.range as vscode.Range
      assert.strictEqual(range.end.character - range.start.character, 1)
    })

    test("sorts presets after the plain kit entry", async () => {
      const items = await complete("typescriptreact", "<Dr", 3)
      const kitItem = items.find((i) => i.label === "Dropdown")!
      const preset = items.find((i) => i.label === "Dropdown: Create tags")!
      assert.ok((kitItem.sortText ?? kitItem.label.toString()) < preset.sortText!)
    })

    test("writes top-level Rails props in snake_case", async () => {
      const content = '<%= pb_rails("'
      const items = await complete("erb", content, content.length)
      const preset = items.find((i) => i.label === "dropdown: Create tags")!

      assert.ok(!(preset.insertText as string).includes("allowOptionCreation"))
      assert.ok((preset.insertText as string).includes("allow_option_creation: true"))
    })
  })

  suite("Hover guidance", () => {
    let provider: PlaybookHoverProvider

    suiteSetup(() => {
      provider = new PlaybookHoverProvider(extensionPath)
    })

    test("kit hover shows gotchas and what it is confused with", async () => {
      const document = await createTestDocument("erb", '<%= pb_rails("advanced_table", props: {}) %>')
      const text = hoverText(await provider.provideHover(document, new vscode.Position(0, 18)))

      assert.ok(text.includes("Good to know"), text)
      assert.ok(text.includes("columnDefinitions"), text)
      assert.ok(text.includes("Often confused with"), text)
    })

    test("kit hover lists presets", async () => {
      const document = await createTestDocument("typescriptreact", '<Dropdown options={o} />')
      const text = hoverText(await provider.provideHover(document, new vscode.Position(0, 3)))
      assert.ok(text.includes("Presets:"), text)
      assert.ok(text.includes("Create tags"), text)
    })

    test("kit hover shows FAQs for kits that have them", async () => {
      const document = await createTestDocument("erb", '<%= pb_rails("dropdown", props: {}) %>')
      const text = hoverText(await provider.provideHover(document, new vscode.Position(0, 16)))
      assert.ok(text.includes("FAQ"), text)
    })

    test("kit hover lists deprecated props", async () => {
      const document = await createTestDocument("erb", '<%= pb_rails("caption", props: {}) %>')
      const text = hoverText(await provider.provideHover(document, new vscode.Position(0, 16)))
      assert.ok(text.includes("Deprecated props"), text)
      assert.ok(text.includes("`variant` → `color`"), text)
    })

    test("prop hover says what the prop is used with", async () => {
      const document = await createTestDocument(
        "typescriptreact",
        "<Dropdown formPillProps={{}} options={o} />"
      )
      const text = hoverText(await provider.provideHover(document, new vscode.Position(0, 12)))
      assert.ok(text.includes("Used together with `multiSelect`"), text)
    })

    test("prop hover uses Rails spelling in Rails files", async () => {
      const document = await createTestDocument(
        "erb",
        '<%= pb_rails("dropdown", props: { show_pill_index: true }) %>'
      )
      const text = hoverText(await provider.provideHover(document, new vscode.Position(0, 37)))
      assert.ok(text.includes("Used together with `multi_select`"), text)
    })

    test("prop hover warns about a deprecated prop", async () => {
      const document = await createTestDocument(
        "erb",
        '<%= pb_rails("caption", props: { variant: "link" }) %>'
      )
      const text = hoverText(await provider.provideHover(document, new vscode.Position(0, 36)))
      assert.ok(text.includes("Deprecated"), text)
      assert.ok(text.includes("Use `color` instead"), text)
    })

    test("prop hover shows the playground hint that applies", async () => {
      const document = await createTestDocument("typescriptreact", '<Button link="/x" text="Go" />')
      const text = hoverText(await provider.provideHover(document, new vscode.Position(0, 9)))
      assert.ok(text.includes("renders as an <a> tag"), text)
    })

    test("prop hover has no guidance block for plain props", async () => {
      const document = await createTestDocument("typescriptreact", '<Button text="Go" />')
      const text = hoverText(await provider.provideHover(document, new vscode.Position(0, 9)))
      assert.ok(!text.includes("Used together"), text)
      assert.ok(!text.includes("Deprecated"), text)
    })
  })

  suite("Spacing hints", () => {
    function annotate(languageId: string, text: string) {
      return spacingAnnotations(text, languageId, metadata).map((a) => ({
        after: text.slice(0, a.offset).slice(-6),
        label: a.label,
      }))
    }

    test("treats margin and padding as spacing props", () => {
      const names = spacingPropNames(metadata)
      for (const expected of ["padding", "margin", "margin_bottom", "padding_x"]) {
        assert.ok(names.has(expected), expected)
      }
      assert.ok(!names.has("text") && !names.has("dark"))
    })

    test("annotates a React token with its pixel value", () => {
      const result = annotate("typescriptreact", '<Card padding="md" />')
      assert.deepStrictEqual(result, [{ after: '"md"', label: "24px" }].map((r) => ({ ...r, after: 'g="md"' })))
    })

    test("places the hint right after the closing quote", () => {
      const text = '<Card padding="md" />'
      const [annotation] = spacingAnnotations(text, "typescriptreact", metadata)
      assert.strictEqual(text.slice(0, annotation.offset), '<Card padding="md"')
    })

    test("annotates a Rails token", () => {
      const text = '<%= pb_rails("card", props: { margin_bottom: "xs" }) %>'
      const [annotation] = spacingAnnotations(text, "erb", metadata)
      assert.strictEqual(annotation.label, "8px")
      assert.strictEqual(text.slice(0, annotation.offset).slice(-4), '"xs"')
    })

    test("annotates every token in a responsive object", () => {
      const labels = spacingAnnotations(
        '<Card padding={{ default: "sm", md: "lg" }} />',
        "typescriptreact",
        metadata
      ).map((a) => a.label)
      assert.deepStrictEqual(labels, ["16px", "32px"])
    })

    test("treats none as zero", () => {
      assert.deepStrictEqual(
        spacingAnnotations('<Card margin="none" />', "typescriptreact", metadata).map((a) => a.label),
        ["0"]
      )
    })

    test("ignores tokens that are not spacing steps", () => {
      assert.deepStrictEqual(spacingAnnotations('<Card padding="auto" />', "typescriptreact", metadata), [])
    })

    test("ignores non-spacing props that happen to hold a token name", () => {
      assert.deepStrictEqual(spacingAnnotations('<Title text="md" size={3} />', "typescriptreact", metadata), [])
    })

    test("ignores unknown components", () => {
      assert.deepStrictEqual(spacingAnnotations('<Whatever padding="md" />', "typescriptreact", metadata), [])
    })

    test("ignores dynamic values", () => {
      assert.deepStrictEqual(spacingAnnotations("<Card padding={size} />", "typescriptreact", metadata), [])
    })

    test("annotates several usages in one document", () => {
      const text = `<Card padding="sm">\n  <Body padding_x="md" paddingTop="lg" />\n</Card>`
      assert.strictEqual(spacingAnnotations(text, "typescriptreact", metadata).length, 3, "sm, md and lg")
    })

    test("produces nothing without spacing data", () => {
      const bare: PlaybookMetadata = { ...metadata, spacingTokens: undefined }
      assert.deepStrictEqual(spacingAnnotations('<Card padding="md" />', "typescriptreact", bare), [])
    })

    test("SpacingHints.compute turns annotations into end-of-token decorations", async () => {
      const hints = new SpacingHints(extensionPath)
      try {
        const document = await createTestDocument("typescriptreact", '<Card padding="md" />')
        const [decoration] = hints.compute(document)

        assert.strictEqual(decoration.range.start.character, '<Card padding="md"'.length)
        assert.ok(decoration.range.isEmpty)
        assert.strictEqual(decoration.renderOptions?.after?.contentText, " 24px")
      } finally {
        hints.dispose()
      }
    })
  })
})
