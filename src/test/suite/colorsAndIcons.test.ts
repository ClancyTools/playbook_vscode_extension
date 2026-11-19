import * as assert from "assert"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import { PlaybookCompletionProvider } from "../../completionProvider"
import {
  colorAnnotations,
  isColorProp,
  loadColorTokens,
  resetColorTokens,
} from "../../colorTokens"
import { PlaybookDiagnostics } from "../../diagnostics"
import { PlaybookHoverProvider } from "../../hoverProvider"
import { checkIcons } from "../../iconRules"
import { loadMetadata, PlaybookMetadata } from "../../metadata"
import {
  buildIconIndex,
  iconPreviewDataUri,
  previewColorFor,
  recolor,
  iconSuggestions,
  loadIconIndex,
  locateIconPackage,
  resetIconIndex,
  resolveConfiguredPath,
  resolveIcon,
} from "../../playbookIcons"
import { ColorSwatches } from "../../previewHints"
import { PlaybookQuickFixProvider } from "../../quickFixes"
import { buildKitColors, mergeScssMaps, parseScssColors, parseScssMaps, readTokenDirectory } from "../../scssColors"
import { checkKitColors, isKnownKitColor, kitColorAnnotations, kitColorCss, loadKitColors } from "../../kitColors"
import {
  createCancellationToken,
  createCompletionContext,
  createTestDocument,
  getCompletionItems,
} from "./testHelpers"

const SVG = '<svg width="30" height="24" viewBox="0 0 30 24"><path fill="black" d="M0 0h30v24z"/></svg>'

/** A throwaway stand-in for the (private) icon package, in the same layout. */
function makeIconPackage(
  root: string,
  icons: Record<string, string[]>,
  aliases: Record<string, string> = {},
  version = "1.0.0"
): string {
  fs.mkdirSync(root, { recursive: true })
  for (const [category, names] of Object.entries(icons)) {
    fs.mkdirSync(path.join(root, "icons", category), { recursive: true })
    for (const name of names) {
      fs.writeFileSync(path.join(root, "icons", category, `${name}.svg`), SVG)
    }
  }
  fs.writeFileSync(path.join(root, "aliases.json"), JSON.stringify({ aliases }))
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version }))
  return root
}

suite("Colors and Icons Test Suite", () => {
  const extensionPath = path.resolve(__dirname, "../../../")
  let metadata: PlaybookMetadata
  let tmp: string

  suiteSetup(() => {
    metadata = loadMetadata(extensionPath)
  })

  setup(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "playbook-icons-"))
  })

  teardown(async () => {
    await vscode.workspace.getConfiguration("playbook").update("icons.path", undefined, vscode.ConfigurationTarget.Global)
    await vscode.workspace.getConfiguration("playbook").update("diagnostics.unknownIcons", undefined, vscode.ConfigurationTarget.Global)
    resetIconIndex()
    resetColorTokens()
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  async function useIcons(icons: Record<string, string[]>, aliases: Record<string, string> = {}) {
    const dir = makeIconPackage(path.join(tmp, "pkg"), icons, aliases)
    await vscode.workspace.getConfiguration("playbook").update("icons.path", dir, vscode.ConfigurationTarget.Global)
    resetIconIndex()
    return dir
  }

  suite("parseScssColors", () => {
    test("reads hex colors", () => {
      assert.deepStrictEqual(parseScssColors("$royal: #0056CF !default;\n$white: #fff;"), {
        royal: "#0056CF",
        white: "#fff",
      })
    })

    test("resolves references, including chains", () => {
      const tokens = parseScssColors("$a: #111111;\n$b: $a;\n$c: $b !default;")
      assert.strictEqual(tokens.c, "#111111")
    })

    test("a later !default does not overwrite an existing value", () => {
      const tokens = parseScssColors("$royal: #0056CF;\n$primary: $royal;\n$primary: $primary !default;")
      assert.strictEqual(tokens.primary, "#0056CF")
    })

    test("a later plain assignment does overwrite", () => {
      assert.strictEqual(parseScssColors("$x: #111111;\n$x: #222222;").x, "#222222")
    })

    test("reads rgb/rgba with literal numbers and rgba($var, alpha)", () => {
      const tokens = parseScssColors("$ink: #102030;\n$a: rgba(0, 0, 0, .5);\n$b: rgba($ink, 0.25);\n$c: rgb(1,2,3);")
      assert.strictEqual(tokens.a, "rgba(0, 0, 0, 0.5)")
      assert.strictEqual(tokens.b, "rgba(16, 32, 48, 0.25)")
      assert.strictEqual(tokens.c, "rgba(1, 2, 3, 1)")
    })

    test("skips computed values, maps and unknown references", () => {
      const tokens = parseScssColors("$a: lighten(#000000, 10%);\n$b: $missing;\n$m: (x: #fff);\n$ok: #123456;")
      assert.deepStrictEqual(tokens, { ok: "#123456" })
    })

    test("ignores comments and survives circular references", () => {
      const tokens = parseScssColors("// $c: #000000;\n$a: $b;\n$b: $a;\n$d: #abcdef; // trailing")
      assert.deepStrictEqual(tokens, { d: "#abcdef" })
    })
  })

  suite("Color tokens", () => {
    test("the bundled tokens include the semantic and background colors", () => {
      const tokens = loadColorTokens(extensionPath)
      assert.strictEqual(tokens.primary, "#0056CF")
      assert.ok(tokens.bg_light && tokens.text_light && tokens.success)
    })

    test("reads a token directory in either file-name spelling", () => {
      fs.writeFileSync(path.join(tmp, "colors.scss"), "$one: #111111;")
      fs.writeFileSync(path.join(tmp, "_colors_accessible.scss"), "$two: #222222;")
      assert.deepStrictEqual(readTokenDirectory(tmp), { one: "#111111", two: "#222222" })
    })

    test("a directory with no token files yields none", () => {
      assert.deepStrictEqual(readTokenDirectory(tmp), {})
    })

    test("a prop takes colors when it is named for color and most of its values are tokens", () => {
      const tokens = { a: "#1", b: "#2", c: "#3" }
      assert.ok(isColorProp("background_color", ["a", "b", "c", "x"], tokens))
      assert.ok(isColorProp("pill_color", ["a", "b", "c"], tokens))
      assert.ok(isColorProp("background", ["a", "b", "c", "none"], tokens), "none doesn't count against it")
    })

    test("is not fooled by semantic names, thin overlap or a non-color prop", () => {
      const tokens = { a: "#1", b: "#2", c: "#3" }
      assert.ok(!isColorProp("variant", ["a", "b", "c"], tokens), "name doesn't say color")
      assert.ok(!isColorProp("color", ["a", "b", "x", "y", "z", "w"], tokens), "only half are tokens")
      assert.ok(!isColorProp("color", ["a", "b"], tokens), "too few tokens")
      assert.ok(!isColorProp("color", undefined, tokens))
    })
  })

  suite("Color annotations", () => {
    const tokens = () => loadColorTokens(extensionPath)
    const annotate = (languageId: string, text: string) => colorAnnotations(text, languageId, metadata, tokens())

    test("shows the token's color after a color prop (React)", () => {
      const text = '<Card background="bg_light" />'
      const [a] = annotate("typescriptreact", text)
      assert.strictEqual(a.swatch, tokens().bg_light)
      assert.strictEqual(text.slice(0, a.offset), '<Card background="bg_light"')
    })

    test("works in Rails", () => {
      const [a] = annotate("erb", '<%= pb_rails("card", props: { background: "bg_light" }) %>')
      assert.strictEqual(a.swatch, tokens().bg_light)
    })

    test("does not draw a color for a semantic value that shares a token's name", () => {
      // On Body, color="default" is the default text color, not the unrelated token $default
      assert.deepStrictEqual(annotate("typescriptreact", '<Body color="default" />'), [])
      assert.deepStrictEqual(annotate("typescriptreact", '<Title size="default" />'), [])
      assert.deepStrictEqual(annotate("typescriptreact", '<Pill variant="primary" text="x" />'), [])
    })

    test("ignores dynamic values, unknown values and unknown kits", () => {
      assert.deepStrictEqual(annotate("typescriptreact", "<Card background={c} />"), [])
      assert.deepStrictEqual(annotate("typescriptreact", '<Card background="not_a_token" />'), [])
      assert.deepStrictEqual(annotate("typescriptreact", '<Whatever background="bg_light" />'), [])
    })

    test("produces nothing without tokens", () => {
      assert.deepStrictEqual(colorAnnotations('<Card background="bg_light" />', "typescriptreact", metadata, {}), [])
    })

    test("ColorSwatches turns a swatch into a colored box", async () => {
      const hints = new ColorSwatches(extensionPath)
      try {
        const document = await createTestDocument("typescriptreact", '<Card background="bg_light" />')
        const [decoration] = hints.compute(document)
        assert.strictEqual(decoration.renderOptions?.after?.backgroundColor, tokens().bg_light)
      } finally {
        hints.dispose()
      }
    })

    test("the swatch is a square that scales with the font and stays under the line height", async () => {
      const hints = new ColorSwatches(extensionPath)
      try {
        const document = await createTestDocument("typescriptreact", '<Card background="bg_light" />')
        const after = hints.compute(document)[0].renderOptions!.after!
        assert.strictEqual(after.width, after.height, "equal width and height")
        assert.ok(/^\d*\.?\d+em$/.test(String(after.width)), "sized in em, so it follows the font")
        assert.ok(parseFloat(String(after.height)) < 1, "shorter than the line, so lines can't be pushed apart")
        assert.strictEqual(after.contentText, "", "no text content, so it sits on the baseline")
      } finally {
        hints.dispose()
      }
    })

    test("can be turned off with playbook.colorSwatches, for tokens and Icon/Legend colors alike", async () => {
      const config = vscode.workspace.getConfiguration("playbook")
      const hints = new ColorSwatches(extensionPath)
      try {
        const token = await createTestDocument("typescriptreact", '<Card background="bg_light" />')
        const icon = await createTestDocument("typescriptreact", '<Icon icon="x" color="primary" />')
        assert.strictEqual(hints.compute(token).length, 1)
        assert.strictEqual(hints.compute(icon).length, 1)

        await config.update("colorSwatches", false, vscode.ConfigurationTarget.Global)
        assert.deepStrictEqual(hints.compute(token), [])
        assert.deepStrictEqual(hints.compute(icon), [])
      } finally {
        await config.update("colorSwatches", undefined, vscode.ConfigurationTarget.Global)
        hints.dispose()
      }
    })

    test("the setting is declared, on by default, and described", () => {
      const manifest = JSON.parse(fs.readFileSync(path.join(extensionPath, "package.json"), "utf-8"))
      const setting = manifest.contributes.configuration.properties["playbook.colorSwatches"]
      assert.strictEqual(setting.type, "boolean")
      assert.strictEqual(setting.default, true)
      assert.ok(setting.description.length > 10)
    })
  })

  suite("Icon index", () => {
    test("indexes icons by name with their category", () => {
      const index = buildIconIndex(makeIconPackage(path.join(tmp, "p"), { arrows: ["arrow-left"], alert: ["bell"] }))!
      assert.strictEqual(index.icons.size, 2)
      assert.strictEqual(index.icons.get("bell")?.category, "alert")
      assert.ok(index.icons.get("arrow-left")?.file.endsWith("arrow-left.svg"))
    })

    test("keeps aliases only when their target exists and they don't shadow an icon", () => {
      const index = buildIconIndex(
        makeIconPackage(path.join(tmp, "p"), { a: ["circle-info", "info"] }, { "info-circle": "circle-info", gone: "missing", info: "circle-info" })
      )!
      assert.deepStrictEqual([...index.aliases.entries()], [["info-circle", "circle-info"]])
    })

    test("ignores files that aren't SVGs and stray files", () => {
      const dir = makeIconPackage(path.join(tmp, "p"), { a: ["one"] })
      fs.writeFileSync(path.join(dir, "icons", "a", "notes.txt"), "x")
      fs.writeFileSync(path.join(dir, "icons", "stray.svg"), SVG)
      assert.deepStrictEqual([...buildIconIndex(dir)!.icons.keys()], ["one"])
    })

    test("the first category wins when a name repeats", () => {
      const index = buildIconIndex(makeIconPackage(path.join(tmp, "p"), { b: ["dup"], a: ["dup"] }))!
      assert.strictEqual(index.icons.get("dup")?.category, "a")
    })

    test("returns nothing for a folder without icons", () => {
      assert.strictEqual(buildIconIndex(tmp), undefined)
      fs.mkdirSync(path.join(tmp, "icons"))
      assert.strictEqual(buildIconIndex(tmp), undefined)
    })

    test("reads the package version", () => {
      assert.strictEqual(buildIconIndex(makeIconPackage(path.join(tmp, "p"), { a: ["x"] }, {}, "2.11.0"))?.version, "2.11.0")
    })

    test("resolves an alias to its icon", () => {
      const index = buildIconIndex(makeIconPackage(path.join(tmp, "p"), { a: ["circle-info"] }, { "info-circle": "circle-info" }))!
      const resolved = resolveIcon(index, "info-circle")!
      assert.strictEqual(resolved.info.name, "circle-info")
      assert.ok(resolved.viaAlias)
      assert.ok(!resolveIcon(index, "circle-info")!.viaAlias)
      assert.strictEqual(resolveIcon(index, "nope"), undefined)
    })

    test("suggests close names, including aliases", () => {
      const index = buildIconIndex(makeIconPackage(path.join(tmp, "p"), { a: ["chevron-down", "trash"] }, { "trash-can": "trash" }))!
      assert.deepStrictEqual(iconSuggestions(index, "chevron-dwon"), ["chevron-down"])
      assert.ok(iconSuggestions(index, "trash-cann").includes("trash-can"))
      assert.deepStrictEqual(iconSuggestions(index, "zzzzzzzz"), [])
    })

    test("builds an image in the requested color", () => {
      const index = buildIconIndex(makeIconPackage(path.join(tmp, "p"), { a: ["x"] }))!
      const uri = iconPreviewDataUri(index.icons.get("x")!, "#d4d4d4")!
      const svg = Buffer.from(uri.split(",")[1], "base64").toString("utf-8")
      assert.ok(uri.startsWith("data:image/svg+xml;base64,"))
      assert.ok(!svg.includes('fill="black"') && svg.includes('fill="#d4d4d4"'), svg)
    })

    test("recolors Playbook's real fills, not just black (most icons are #242B42)", () => {
      const svg = '<svg fill="none"><path fill="#242B42"/><path fill="black"/><path fill="#0A0527"/><path stroke="#000000"/></svg>'
      const out = recolor(svg, "#abcdef")
      assert.ok(!/#242B42|black|#0A0527|#000000/i.test(out), out)
      assert.strictEqual((out.match(/#abcdef/g) || []).length, 4)
    })

    test("leaves none, white cut-outs and gradient references alone", () => {
      const out = recolor('<svg fill="none"><path fill="white"/><path fill="#FFF"/><path fill="url(#g)"/><path fill="red"/></svg>', "#abcdef")
      assert.ok(out.includes('fill="none"') && out.includes('fill="white"') && out.includes('fill="#FFF"') && out.includes('fill="url(#g)"'), out)
      assert.ok(out.includes('fill="#abcdef"') && !out.includes('fill="red"'), out)
    })

    test("recolors fills written in a style attribute", () => {
      assert.ok(recolor('<path style="fill:#242B42;opacity:1"/>', "#abcdef").includes("fill:#abcdef"))
    })

    test("the theme picks the color: light gray on dark themes, dark gray on light", () => {
      assert.strictEqual(previewColorFor(vscode.ColorThemeKind.Dark, ""), "#d4d4d4")
      assert.strictEqual(previewColorFor(vscode.ColorThemeKind.HighContrast, ""), "#d4d4d4")
      assert.strictEqual(previewColorFor(vscode.ColorThemeKind.Light, ""), "#3c3c3c")
      assert.strictEqual(previewColorFor(vscode.ColorThemeKind.HighContrastLight, ""), "#3c3c3c")
    })

    test("a valid playbook.icons.previewColor overrides the theme; an invalid one is ignored", () => {
      assert.strictEqual(previewColorFor(vscode.ColorThemeKind.Dark, "#4fc3f7"), "#4fc3f7")
      assert.strictEqual(previewColorFor(vscode.ColorThemeKind.Dark, "white"), "white")
      assert.strictEqual(previewColorFor(vscode.ColorThemeKind.Light, "rgb(10, 20, 30)"), "rgb(10, 20, 30)")
      assert.strictEqual(previewColorFor(vscode.ColorThemeKind.Dark, 'red" onload="x'), "#d4d4d4", "can't inject markup")
      assert.strictEqual(previewColorFor(vscode.ColorThemeKind.Dark, "  "), "#d4d4d4")
    })

    test("with no color given it follows the theme and the setting", async () => {
      const index = buildIconIndex(makeIconPackage(path.join(tmp, "p"), { a: ["x"] }))!
      const decode = (uri: string) => Buffer.from(uri.split(",")[1], "base64").toString("utf-8")
      const config = vscode.workspace.getConfiguration("playbook")
      try {
        await config.update("icons.previewColor", "#ff00aa", vscode.ConfigurationTarget.Global)
        assert.ok(decode(iconPreviewDataUri(index.icons.get("x")!)!).includes('fill="#ff00aa"'))
      } finally {
        await config.update("icons.previewColor", undefined, vscode.ConfigurationTarget.Global)
      }
      const expected = previewColorFor(vscode.window.activeColorTheme.kind, "")
      assert.ok(decode(iconPreviewDataUri(index.icons.get("x")!)!).includes(`fill="${expected}"`))
    })

    test("skips an oversized SVG", () => {
      const dir = makeIconPackage(path.join(tmp, "p"), { a: ["big"] })
      fs.writeFileSync(path.join(dir, "icons", "a", "big.svg"), "<svg>" + "x".repeat(50_000) + "</svg>")
      assert.strictEqual(iconPreviewDataUri(buildIconIndex(dir)!.icons.get("big")!), undefined)
    })

    test("returns nothing for an unreadable file", () => {
      assert.strictEqual(iconPreviewDataUri({ name: "x", category: "a", file: path.join(tmp, "gone.svg") }), undefined)
    })
  })

  suite("Locating the icon package", () => {
    test("expands ~ and resolves relative paths against the workspace", () => {
      assert.strictEqual(resolveConfiguredPath("~/icons", ["/ws"]), path.join(os.homedir(), "icons"))
      assert.strictEqual(resolveConfiguredPath("vendor/icons", ["/ws"]), path.join("/ws", "vendor/icons"))
      assert.strictEqual(resolveConfiguredPath("/abs/icons", ["/ws"]), "/abs/icons")
    })

    test("uses a configured folder only if it has icons", () => {
      const dir = makeIconPackage(path.join(tmp, "p"), { a: ["x"] })
      assert.strictEqual(locateIconPackage(dir, []), dir)
      assert.strictEqual(locateIconPackage(path.join(tmp, "missing"), []), undefined)
    })

    test("a configured folder wins over the workspace's install", () => {
      const configured = makeIconPackage(path.join(tmp, "checkout"), { a: ["x"] })
      makeIconPackage(path.join(tmp, "ws", "node_modules", "@powerhome", "playbook-icons"), { a: ["y"] })
      assert.strictEqual(locateIconPackage(configured, [path.join(tmp, "ws")]), configured)
    })

    test("finds the newest installed package in the workspace, including components", () => {
      makeIconPackage(path.join(tmp, "ws", "node_modules", "@powerhome", "playbook-icons"), { a: ["x"] }, {}, "2.0.0")
      const newer = makeIconPackage(
        path.join(tmp, "ws", "components", "billing", "node_modules", "@powerhome", "playbook-icons"),
        { a: ["x"] },
        {},
        "2.11.0"
      )
      assert.strictEqual(locateIconPackage("", [path.join(tmp, "ws")]), newer)
    })

    test("is undefined when no package is installed", () => {
      assert.strictEqual(locateIconPackage("", [tmp]), undefined)
    })

    test("loadIconIndex follows the playbook.icons.path setting", async () => {
      assert.strictEqual(loadIconIndex()?.dir === undefined || true, true)
      await useIcons({ a: ["wrench"] })
      assert.ok(loadIconIndex()?.icons.has("wrench"))
    })
  })

  suite("Icon checks", () => {
    const index = () => buildIconIndex(path.join(tmp, "pkg"))!

    setup(async () => {
      await useIcons({ arrows: ["chevron-down", "arrow-right"], alert: ["circle-info"] }, { "info-circle": "circle-info" })
    })

    test("flags a likely typo with the closest name", () => {
      const text = '<Button icon="chevron-dwon" />'
      const [finding] = checkIcons(text, "typescriptreact", metadata, index())
      assert.strictEqual(finding.code, "unknown-icon")
      assert.ok(finding.message.includes('Did you mean "chevron-down"'), finding.message)
      assert.ok(finding.message.includes("Font Awesome"), "reminds that FA names are fine")
      assert.strictEqual(text.slice(finding.start, finding.end), '"chevron-down"'.replace("chevron-down", "chevron-dwon"))
    })

    test("does not flag a name with no close match, which may be Font Awesome", () => {
      assert.deepStrictEqual(checkIcons('<Button icon="cloud-slash" />', "typescriptreact", metadata, index()), [])
    })

    test("does not flag known icons or aliases", () => {
      assert.deepStrictEqual(checkIcons('<Button icon="chevron-down" />', "typescriptreact", metadata, index()), [])
      assert.deepStrictEqual(checkIcons('<Button icon="info-circle" />', "typescriptreact", metadata, index()), [])
    })

    test("icons are never drawn inline in the code (an image can't follow the line height)", () => {
      const manifest = JSON.parse(fs.readFileSync(path.join(extensionPath, "package.json"), "utf-8"))
      assert.strictEqual(manifest.contributes.configuration.properties["playbook.iconPreviews"], undefined)
      assert.ok(!fs.existsSync(path.join(extensionPath, "out", "previewHints.js")) ||
        !fs.readFileSync(path.join(extensionPath, "out", "previewHints.js"), "utf-8").includes("IconPreviews"))
    })
  })

  suite("Icon completions, hover and quick fix", () => {
    setup(async () => {
      await useIcons({ arrows: ["chevron-down", "arrow-right"] }, { "chevron": "chevron-down" })
    })

    async function complete(content: string, marker: string) {
      const provider = new PlaybookCompletionProvider(extensionPath)
      const document = await createTestDocument("typescriptreact", content)
      const position = document.positionAt(content.indexOf(marker) + marker.length)
      const items = getCompletionItems(
        await provider.provideCompletionItems(document, position, createCancellationToken(), createCompletionContext())
      )
      return { provider, items }
    }

    test("offers icon names and aliases for an icon prop", async () => {
      const { items } = await complete('<Button icon="" />', 'icon="')
      const down = items.find((i) => i.label === "chevron-down")!
      assert.strictEqual(down.detail, "arrows")
      assert.strictEqual(down.insertText, "chevron-down", "inside quotes, only the name")
      assert.strictEqual(items.find((i) => i.label === "chevron")?.detail, "alias of chevron-down")
      assert.ok(down.sortText! < items.find((i) => i.label === "chevron")!.sortText!, "icons sort before aliases")
    })

    test("completes an icon name as you type inside existing quotes", async () => {
      const provider = new PlaybookCompletionProvider(extensionPath)
      for (const [languageId, content] of [
        ["typescriptreact", '<Button icon="chev|" />'],
        ["erb", '<%= pb_rails("button", props: { icon: "chev|" }) %>'],
      ]) {
        const document = await createTestDocument(languageId, content.replace("|", ""))
        const items = getCompletionItems(
          await provider.provideCompletionItems(
            document,
            document.positionAt(content.indexOf("|")),
            createCancellationToken(),
            createCompletionContext("v")
          )
        )
        assert.ok(items.some((i) => i.label === "chevron-down"), languageId)
      }
    })

    test("adds quotes when the value isn't quoted yet", async () => {
      const { items } = await complete("<Button icon= />", "icon=")
      assert.strictEqual(items.find((i) => i.label === "arrow-right")?.insertText, '"arrow-right"')
    })

    test("builds the preview only when an item is resolved", async () => {
      const { provider, items } = await complete('<Button icon="" />', 'icon="')
      const item = items.find((i) => i.label === "chevron-down")!
      assert.strictEqual(item.documentation, undefined)
      const resolved = provider.resolveCompletionItem(item) as vscode.CompletionItem
      assert.ok((resolved.documentation as vscode.MarkdownString).value.startsWith("![chevron-down](data:image/svg+xml"))
    })

    test("offers no icons for other props or without an icon package", async () => {
      const other = await complete('<Button text="" />', 'text="')
      assert.ok(!other.items.some((i) => i.label === "chevron-down"))

      await vscode.workspace.getConfiguration("playbook").update("icons.path", path.join(tmp, "nowhere"), vscode.ConfigurationTarget.Global)
      resetIconIndex()
      const none = await complete('<Button icon="" />', 'icon="')
      assert.ok(!none.items.some((i) => i.label === "chevron-down"))
    })

    test("hovering an icon value shows its preview, category and alias note", async () => {
      const provider = new PlaybookHoverProvider(extensionPath)
      const content = '<Button icon="chevron" />'
      const document = await createTestDocument("typescriptreact", content)
      const hover = (await provider.provideHover(document, document.positionAt(content.indexOf("chevron") + 2))) as vscode.Hover
      const text = (hover.contents[0] as vscode.MarkdownString).value
      assert.ok(text.includes("![chevron-down](data:image/svg+xml"), text)
      assert.ok(text.includes("playbook-icons · arrows"), text)
      assert.ok(text.includes("`chevron` is an alias of `chevron-down`"), text)
      assert.ok(text.includes("Font Awesome"), text)
    })

    test("hovering a color token shows the color", async () => {
      const provider = new PlaybookHoverProvider(extensionPath)
      const content = '<Card background="bg_light" />'
      const document = await createTestDocument("typescriptreact", content)
      const hover = (await provider.provideHover(document, document.positionAt(content.indexOf("bg_light") + 2))) as vscode.Hover
      const text = (hover.contents[0] as vscode.MarkdownString).value
      assert.ok(text.includes("`bg_light`") && text.includes(loadColorTokens(extensionPath).bg_light), text)
    })

    test("hovering a non-color, non-icon value falls through to normal hover", async () => {
      const provider = new PlaybookHoverProvider(extensionPath)
      const content = '<Button text="hello" />'
      const document = await createTestDocument("typescriptreact", content)
      const hover = await provider.provideHover(document, document.positionAt(content.indexOf("hello") + 1))
      assert.ok(!hover || !(hover.contents[0] as vscode.MarkdownString).value.includes("playbook-icons"))
    })

    test("a typo is flagged and fixed", async () => {
      const diagnostics = new PlaybookDiagnostics(extensionPath)
      const fixes = new PlaybookQuickFixProvider(extensionPath)
      try {
        const document = await createTestDocument("typescriptreact", '<Button icon="chevron-dwon" />')
        diagnostics.updateDiagnostics(document)
        const diagnostic = diagnostics.getDiagnostics(document.uri).find((d) => d.code === "unknown-icon")!
        assert.ok(diagnostic, "unknown-icon reported")
        const [action] = fixes.provideCodeActions(document, diagnostic.range, {
          diagnostics: [diagnostic],
          only: undefined,
          triggerKind: vscode.CodeActionTriggerKind.Invoke,
        })
        assert.strictEqual(action.title, 'Change to "chevron-down"')
        await vscode.workspace.applyEdit(action.edit!)
        assert.strictEqual(document.getText(), '<Button icon="chevron-down" />')
      } finally {
        diagnostics.dispose()
      }
    })

    test("the typo check can be turned off", async () => {
      await vscode.workspace.getConfiguration("playbook").update("diagnostics.unknownIcons", false, vscode.ConfigurationTarget.Global)
      const diagnostics = new PlaybookDiagnostics(extensionPath)
      try {
        const document = await createTestDocument("typescriptreact", '<Button icon="chevron-dwon" />')
        diagnostics.updateDiagnostics(document)
        assert.ok(!diagnostics.getDiagnostics(document.uri).some((d) => d.code === "unknown-icon"))
      } finally {
        diagnostics.dispose()
      }
    })
  })

  suite("Opacity and map parsing", () => {
    test("resolves rgba(\$color, \$opacity) through a numeric variable", () => {
      const tokens = parseScssColors("$opacity_4: .4;\n$white: #FFFFFF;\n$soft: rgba($white, $opacity_4);")
      assert.strictEqual(tokens.soft, "rgba(255, 255, 255, 0.4)")
    })

    test("an alpha variable it can't find drops the color instead of making it transparent", () => {
      assert.strictEqual(parseScssColors("$white: #FFFFFF;\n$soft: rgba($white, $missing);").soft, undefined)
    })

    test("reads maps, with quoted keys, resolving values through tokens", () => {
      const tokens = { royal: "#0056CF", teal: "#00C4D7" }
      const maps = parseScssMaps('$main: (\n  primary: $royal,\n  "light": $teal,\n  other: #123456\n);', tokens)
      assert.deepStrictEqual(maps.main, { primary: "#0056CF", light: "#00C4D7", other: "#123456" })
    })

    test("keeps a key whose color can't be resolved, with no color", () => {
      assert.deepStrictEqual(parseScssMaps("$m: (a: lighten($x, 10%), b: #111111);", {}).m, { a: "", b: "#111111" })
    })

    test("handles nested parentheses and comments in a map", () => {
      const maps = parseScssMaps("$m: (\n  // note\n  a: rgba(1, 2, 3, .5),\n  b: #222222 /* c */\n);", {})
      assert.deepStrictEqual(Object.keys(maps.m), ["a", "b"])
    })

    test("map-merge keeps the later map's value for a repeated key, in order", () => {
      const merged = mergeScssMaps("$one: map-merge($a, $b);\n$two: map-merge($one, $c);", {
        a: { x: "#111111", y: "#222222" },
        b: { y: "#333333" },
        c: { z: "#444444" },
      })
      assert.deepStrictEqual(merged.two, { x: "#111111", y: "#333333", z: "#444444" })
    })

    test("buildKitColors derives Icon's colors from its stylesheet and Legend's from data_colors", () => {
      fs.writeFileSync(
        path.join(tmp, "_colors.scss"),
        "$royal: #0056CF;\n$red: #DA0014;\n$status_colors: (primary: $royal);\n$data_colors: (data_1: $royal, data_2: $red);\n$text_colors: (text_x: $red);"
      )
      const iconScss = '$extra: ("link": $royal);\n$m1: map-merge($status_colors, $text_colors);\n$icon_colors: map-merge($m1, $extra);'
      const colors = buildKitColors(tmp, iconScss)
      assert.deepStrictEqual(colors.icon, { primary: "#0056CF", text_x: "#DA0014", link: "#0056CF" })
      assert.deepStrictEqual(colors.legend, { data_1: "#0056CF", data_2: "#DA0014" })
    })
  })

  suite("Kit colors (Icon and Legend)", () => {
    const colors = () => loadKitColors(extensionPath)
    const annotate = (languageId: string, text: string) => kitColorAnnotations(text, languageId, metadata, colors())

    test("the bundled Icon colors match Playbook's documented examples", () => {
      for (const name of ["primary", "link", "light", "lighter", "data_4", "product_5_background", "text_dk_lighter", "success"]) {
        assert.ok(name in colors().icon, name)
      }
      assert.ok(!("secondary" in colors().icon), "Playbook defines no secondary color for Icon")
      assert.strictEqual(Object.keys(colors().legend).length, 8)
    })

    test("Icon color shows a swatch (Rails)", () => {
      const text = '<%= pb_rails("icon", props: { icon: "copy", color: "primary", size: "1x" }) %>'
      const [a] = annotate("erb", text)
      assert.strictEqual(a.swatch, "#0056CF")
      assert.strictEqual(text.slice(0, a.offset).slice(-9), '"primary"')
    })

    test("Icon color shows a swatch (React)", () => {
      assert.strictEqual(annotate("typescriptreact", '<Icon icon="user" color="data_4" />')[0].swatch, "#1CA05C")
    })

    test("a color Playbook doesn't define gets no swatch", () => {
      assert.deepStrictEqual(annotate("erb", '<%= pb_rails("icon", props: { color: "secondary" }) %>'), [])
    })

    test("a valid name whose color can't be worked out gets no swatch", () => {
      assert.deepStrictEqual(annotate("typescriptreact", '<Icon icon="x" color="success_secondary" />'), [])
    })

    test("Legend takes data colors or a hex string", () => {
      assert.strictEqual(annotate("typescriptreact", '<Legend color="data_2" text="x" />')[0].swatch, "#F9BB00")
      assert.strictEqual(annotate("typescriptreact", '<Legend color="#123456" text="x" />')[0].swatch, "#123456")
      assert.strictEqual(kitColorCss("icon", "#123456", colors()), undefined, "Icon takes names, not hex")
    })

    test("kits with semantic color names show their own color, not the same-named token", () => {
      // Token `default` is #93a8b8; Body's default is the default *text* color.
      assert.strictEqual(annotate("typescriptreact", '<Body color="default" />')[0].swatch, "#242B42")
      assert.strictEqual(annotate("typescriptreact", '<Body color="link" text="x" />')[0].swatch, "#0056CF")
      assert.strictEqual(annotate("typescriptreact", '<Caption color="lighter" />')[0].swatch, "#617290")
      assert.strictEqual(annotate("typescriptreact", '<Title color="success" />')[0].swatch, "#158149")
      assert.strictEqual(annotate("typescriptreact", '<Detail color="light" />')[0].swatch, "#4B546B")
      assert.strictEqual(annotate("typescriptreact", '<Link color="muted" href="/" />')[0].swatch, "#687887")
      assert.strictEqual(annotate("typescriptreact", '<Overlay color="bg_light" />')[0].swatch, "#F3F7FB")
      assert.strictEqual(annotate("erb", '<%= pb_rails("body", props: { color: "light" }) %>')[0].swatch, "#4B546B")
    })

    test("Card background shows the product and extra colors", () => {
      assert.strictEqual(annotate("typescriptreact", '<Card background="dark" />')[0].swatch, "#0a0527")
      assert.strictEqual(annotate("typescriptreact", '<Card background="windows" />')[0].swatch, "#003DB2")
      assert.strictEqual(annotate("erb", '<%= pb_rails("card", props: { background: "light" }) %>')[0].swatch, "#F3F7FB")
      assert.deepStrictEqual(annotate("typescriptreact", '<Card background="none" />'), [])
    })

    test("Card header_color shows a swatch on the header subcomponent", () => {
      assert.strictEqual(annotate("erb", '<%= pb_rails("card/card_header", props: { header_color: "dark" }) %>')[0].swatch, "#0a0527")
      assert.strictEqual(annotate("typescriptreact", '<Card.Header headerColor="category_1" />')[0]?.swatch?.startsWith("#"), true)
      assert.deepStrictEqual(annotate("erb", '<%= pb_rails("card/card_header", props: { header_color: "blue" }) %>'), [])
      assert.deepStrictEqual(annotate("erb", '<%= pb_rails("table/table_row", props: { header_color: "dark" }) %>'), [])
    })

    test("a value in an unrelated prop of those kits gets none", () => {
      assert.deepStrictEqual(annotate("typescriptreact", '<Body color="nope" />'), [])
      assert.deepStrictEqual(annotate("typescriptreact", '<Body size="light" />'), [])
    })

    test("the kit's color wins over the same-named token (one swatch, not two)", async () => {
      const hints = new ColorSwatches(extensionPath)
      try {
        const document = await createTestDocument("typescriptreact", '<Card background="light" />')
        const decorations = hints.compute(document)
        assert.strictEqual(decorations.length, 1)
        assert.strictEqual(decorations[0].renderOptions?.after?.backgroundColor, "#F3F7FB")
      } finally {
        hints.dispose()
      }
    })

    test("hovering a Body color shows the kit's color", async () => {
      const provider = new PlaybookHoverProvider(extensionPath)
      const content = '<Body color="default" text="x" />'
      const document = await createTestDocument("typescriptreact", content)
      const hover = (await provider.provideHover(document, document.positionAt(content.indexOf('"default"') + 2))) as vscode.Hover
      const text = (hover.contents[0] as vscode.MarkdownString).value
      assert.ok(text.includes("#242B42") && !text.includes("#93a8b8"), text)
    })

    test("dynamic values, other props and other kits get none", () => {
      assert.deepStrictEqual(annotate("typescriptreact", "<Icon icon=\"x\" color={c} />"), [])
      assert.deepStrictEqual(annotate("typescriptreact", '<Icon icon="x" size="1x" />'), [])
      assert.deepStrictEqual(annotate("typescriptreact", '<Title color="primary" />'), [])
    })

    test("the swatch decoration is produced for Icon color too", async () => {
      const hints = new ColorSwatches(extensionPath)
      try {
        const document = await createTestDocument("erb", '<%= pb_rails("icon", props: { icon: "copy", color: "primary" }) %>')
        const [decoration] = hints.compute(document)
        assert.strictEqual(decoration.renderOptions?.after?.backgroundColor, "#0056CF")
      } finally {
        hints.dispose()
      }
    })

    test("hovering an Icon color shows the color", async () => {
      const provider = new PlaybookHoverProvider(extensionPath)
      const content = '<%= pb_rails("icon", props: { icon: "copy", color: "link" }) %>'
      const document = await createTestDocument("erb", content)
      const hover = (await provider.provideHover(document, document.positionAt(content.indexOf('"link"') + 2))) as vscode.Hover
      const text = (hover.contents[0] as vscode.MarkdownString).value
      assert.ok(text.includes("`link`") && text.includes("#0056CF"), text)
    })

    suite("Unknown color names", () => {
      const flagged = (languageId: string, text: string) => checkKitColors(text, languageId, metadata, colors())

      test("flags an Icon color Playbook doesn't define", () => {
        const text = '<%= pb_rails("icon", props: { icon: "copy", color: "secondary" }) %>'
        const [finding] = flagged("erb", text)
        assert.strictEqual(finding.code, "unknown-kit-color")
        assert.ok(finding.message.startsWith('Icon has no color named "secondary", so none is applied.'), finding.message)
        assert.strictEqual(text.slice(finding.start, finding.end), '"secondary"')
      })

      test("flags the other names Nitro uses that Playbook doesn't define", () => {
        for (const name of ["default", "gray", "black", "white"]) {
          assert.strictEqual(flagged("typescriptreact", `<Icon icon="x" color="${name}" />`).length, 1, name)
        }
      })

      test("accepts real names, including by prefix, as the CSS does", () => {
        for (const name of ["primary", "link", "light", "text_lt_light", "primary_action", "neutral_secondary", "product_6_highlight"]) {
          assert.deepStrictEqual(flagged("typescriptreact", `<Icon icon="x" color="${name}" />`), [], name)
        }
      })

      test("suggests a close name for a typo", () => {
        assert.ok(flagged("typescriptreact", '<Icon icon="x" color="prmary" />')[0].message.includes('Did you mean "primary"?'))
      })

      test("Legend: data colors and hex are fine, others are flagged", () => {
        assert.deepStrictEqual(flagged("typescriptreact", '<Legend color="data_3" text="x" />'), [])
        assert.deepStrictEqual(flagged("typescriptreact", '<Legend color="#abcdef" text="x" />'), [])
        assert.strictEqual(flagged("typescriptreact", '<Legend color="data_9" text="x" />').length, 1)
      })

      test("is quiet for dynamic values, hex, interpolation, spreads and other kits", () => {
        assert.deepStrictEqual(flagged("typescriptreact", "<Icon icon=\"x\" color={c} />"), [])
        assert.deepStrictEqual(flagged("typescriptreact", '<Icon icon="x" color="#fff" />'), [])
        assert.deepStrictEqual(flagged("erb", '<%= pb_rails("icon", props: { color: "#{c}" }) %>'), [])
        assert.deepStrictEqual(flagged("typescriptreact", '<Icon {...rest} icon="x" color="gray" />'), [])
        assert.deepStrictEqual(flagged("typescriptreact", '<Title color="gray" />'), [])
      })

      test("isKnownKitColor treats a kit with no color list as unknowable", () => {
        assert.ok(isKnownKitColor("button", "anything", colors()))
        assert.ok(isKnownKitColor("icon", "", colors()))
      })

      test("is reported, fixed, and can be turned off", async () => {
        const diagnostics = new PlaybookDiagnostics(extensionPath)
        const fixes = new PlaybookQuickFixProvider(extensionPath)
        const config = vscode.workspace.getConfiguration("playbook")
        try {
          const document = await createTestDocument("typescriptreact", '<Icon icon="x" color="prmary" />')
          diagnostics.updateDiagnostics(document)
          const diagnostic = diagnostics.getDiagnostics(document.uri).find((d) => d.code === "unknown-kit-color")!
          assert.ok(diagnostic)
          assert.strictEqual(diagnostic.severity, vscode.DiagnosticSeverity.Information)
          const [action] = fixes.provideCodeActions(document, diagnostic.range, {
            diagnostics: [diagnostic],
            only: undefined,
            triggerKind: vscode.CodeActionTriggerKind.Invoke,
          })
          assert.strictEqual(action.title, 'Change to "primary"')
          await vscode.workspace.applyEdit(action.edit!)
          assert.strictEqual(document.getText(), '<Icon icon="x" color="primary" />')

          await config.update("diagnostics.unknownColors", false, vscode.ConfigurationTarget.Global)
          const off = await createTestDocument("typescriptreact", '<Icon icon="x" color="gray" />')
          diagnostics.updateDiagnostics(off)
          assert.ok(!diagnostics.getDiagnostics(off.uri).some((d) => d.code === "unknown-kit-color"))
        } finally {
          await config.update("diagnostics.unknownColors", undefined, vscode.ConfigurationTarget.Global)
          diagnostics.dispose()
        }
      })
    })
  })
})
