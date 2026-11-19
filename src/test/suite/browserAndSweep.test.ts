import * as assert from "assert"
import * as path from "path"
import * as vscode from "vscode"
import { languageIdForFile, mightUsePlaybook } from "../../deprecatedUsages"
import { summarize, sweepText } from "../../deprecationSweep"
import { KitTreeProvider, platformForEditor } from "../../kitBrowser"
import {
  buildCatalog,
  categoryLabel,
  exampleFor,
  filterCatalog,
  kitActions,
} from "../../kitCatalog"
import { ComponentMetadata, findComponentByRailsName, loadMetadata, PlaybookMetadata } from "../../metadata"
import { loadPlayground } from "../../playgrounds"
import { PlaybookStatusBar } from "../../statusBar"
import { createTestDocument } from "./testHelpers"

suite("Kit Browser and Sweep Test Suite", () => {
  const extensionPath = path.resolve(__dirname, "../../../")
  let metadata: PlaybookMetadata

  suiteSetup(() => {
    metadata = loadMetadata(extensionPath)
  })

  function kit(name: string): ComponentMetadata {
    return findComponentByRailsName(metadata, name)!
  }

  suite("Catalog", () => {
    test("groups every kit under its category, sorted", () => {
      const catalog = buildCatalog(metadata)
      const total = catalog.reduce((n, c) => n + c.kits.length, 0)

      assert.strictEqual(total, Object.keys(metadata.components).length)
      const labels = catalog.map((c) => c.label)
      assert.deepStrictEqual(labels, [...labels].sort((a, b) => a.localeCompare(b)))
      const buttons = catalog.find((c) => c.id === "buttons")!
      assert.ok(buttons.kits.some((k) => k.react === "Button"))
      assert.deepStrictEqual(
        buttons.kits.map((k) => k.react),
        buttons.kits.map((k) => k.react).sort((a, b) => a.localeCompare(b))
      )
    })

    test("turns category ids into labels", () => {
      assert.strictEqual(categoryLabel("form_selection"), "Form selection")
      assert.strictEqual(categoryLabel("buttons"), "Buttons")
    })

    test("attaches category descriptions when given", () => {
      const catalog = buildCatalog(metadata, { buttons: "Clickable things" })
      assert.strictEqual(catalog.find((c) => c.id === "buttons")!.description, "Clickable things")
    })

    test("filters out kits that do not exist on the platform", () => {
      const names = (platform: "rails" | "react") =>
        buildCatalog(metadata, {}, platform).flatMap((c) => c.kits.map((k) => k.rails))

      assert.ok(!names("rails").includes("map"), "map is React-only")
      assert.ok(names("react").includes("map"))
      assert.ok(!names("react").includes("form"), "form is Rails-only")
      assert.ok(names("rails").includes("form"))
    })

    test("searches name, description and look-alike phrases, all words must match", () => {
      const catalog = buildCatalog(metadata)
      const kits = (q: string) => filterCatalog(catalog, q).flatMap((c) => c.kits.map((k) => k.rails))

      assert.ok(kits("dropdown").includes("dropdown"))
      assert.ok(kits("date range").includes("date_range_inline"))
      assert.ok(kits("sortable headers").includes("advanced_table"), "matches lookalike text")
      assert.deepStrictEqual(kits("dropdown zzzzqqq"), [])
    })

    test("an empty query returns everything", () => {
      const catalog = buildCatalog(metadata)
      assert.strictEqual(filterCatalog(catalog, "  "), catalog)
    })

    test("drops categories with no matching kits", () => {
      const result = filterCatalog(buildCatalog(metadata), "dropdown")
      assert.ok(result.every((c) => c.kits.length > 0))
    })

    test("exampleFor returns each platform's documented example", () => {
      assert.ok(exampleFor(kit("badge"), "rails")!.includes("pb_rails"))
      assert.ok(exampleFor(kit("badge"), "react")!.startsWith("<Badge"))
    })
  })

  suite("Kit actions", () => {
    test("offers the example and presets for the editor's platform", () => {
      const dropdown = kit("dropdown")
      const actions = kitActions(dropdown, loadPlayground(extensionPath, "dropdown"), "react")

      assert.strictEqual(actions[0].label, "Insert example")
      assert.strictEqual(actions[0].kind, "example")
      const preset = actions.find((a) => a.label === "Insert preset: Create tags")!
      assert.ok(preset.text!.startsWith("<Dropdown allowOptionCreation multiSelect"), preset.text)
      assert.ok(actions.some((a) => a.kind === "docs"))
    })

    test("writes presets as pb_rails calls in Rails files", () => {
      const actions = kitActions(kit("dropdown"), loadPlayground(extensionPath, "dropdown"), "rails")
      const preset = actions.find((a) => a.label === "Insert preset: Create tags")!
      assert.ok(preset.text!.startsWith('<%= pb_rails("dropdown", props: { allow_option_creation: true'), preset.text)
    })

    test("wraps a preset for a kit with children in a block", () => {
      const card = kit("card")
      const text = kitActions(card, { presets: [{ name: "P", props: { id: "x" } }] }, "rails").find(
        (a) => a.kind === "preset"
      )!.text!
      assert.ok(text.includes("do %>") && text.endsWith("<% end %>"), text)
    })

    test("offers copies of both examples when no editor platform is known", () => {
      const labels = kitActions(kit("badge"), undefined, undefined).map((a) => a.label)
      assert.deepStrictEqual(labels, ["Copy React example", "Copy Rails example", "Open Playbook docs"])
    })

    test("only offers copies for platforms the kit supports", () => {
      const labels = kitActions(kit("map"), undefined, undefined).map((a) => a.label)
      assert.ok(labels.includes("Copy React example"))
      assert.ok(!labels.includes("Copy Rails example"))
    })
  })

  suite("Deprecation sweep", () => {
    test("finds a deprecated prop with its position", () => {
      const text = '<div>\n  <%= pb_rails("flex", props: { horizontal: "center" }) %>\n</div>'
      const [found] = sweepText(text, "erb", metadata)

      assert.strictEqual(found.kind, "prop")
      assert.strictEqual(found.kit, "flex")
      assert.strictEqual(found.prop, "horizontal")
      assert.strictEqual(found.line, 1)
      assert.strictEqual(text.split("\n")[1].slice(found.column, found.column + 10), "horizontal")
    })

    test("records the replacement", () => {
      const [found] = sweepText('<Body status="positive" text="x" />', "typescriptreact", metadata)
      assert.strictEqual(found.replacement, "color")
    })

    test("reports a deprecated kit", () => {
      const deprecated: PlaybookMetadata = {
        ...metadata,
        components: {
          ...metadata.components,
          Badge: { ...metadata.components.Badge, status: "deprecated" },
        },
      }
      const [found] = sweepText('<Badge text="x" />', "typescriptreact", deprecated)
      assert.deepStrictEqual([found.kind, found.kit, found.prop], ["kit", "badge", undefined])
    })

    test("returns results in file order", () => {
      const text = `<Caption variant="link" text="a" />\n<Caption variant="link" text="b" />`
      assert.deepStrictEqual(
        sweepText(text, "typescriptreact", metadata).map((f) => f.line),
        [0, 1]
      )
    })

    test("is quiet for current code", () => {
      assert.deepStrictEqual(sweepText('<Button text="x" />', "typescriptreact", metadata), [])
    })

    test("summarises by kit and prop, most used first", () => {
      const groups = summarize([
        { kind: "prop", kit: "flex", prop: "vertical", line: 0, column: 0, message: "" },
        { kind: "prop", kit: "flex", prop: "horizontal", line: 1, column: 0, message: "" },
        { kind: "prop", kit: "flex", prop: "horizontal", line: 2, column: 0, message: "" },
        { kind: "kit", kit: "badge", line: 3, column: 0, message: "" },
      ])
      assert.deepStrictEqual(
        groups.map((g) => [g.label, g.count]),
        [
          ["flex · horizontal", 2],
          ["badge (kit)", 1],
          ["flex · vertical", 1],
        ]
      )
    })

    test("maps file extensions to languages", () => {
      assert.strictEqual(languageIdForFile("a/b.html.erb"), "erb")
      assert.strictEqual(languageIdForFile("a/b.tsx"), "typescriptreact")
      assert.strictEqual(languageIdForFile("a/b.rb"), "ruby")
      assert.strictEqual(languageIdForFile("a/b.css"), undefined)
    })

    test("skips files that cannot use Playbook", () => {
      assert.ok(mightUsePlaybook('<%= pb_rails("button") %>'))
      assert.ok(mightUsePlaybook("import { Button } from 'playbook-ui'"))
      assert.ok(mightUsePlaybook("<Button text='x' />"))
      assert.ok(!mightUsePlaybook("puts 'hello'"))
    })
  })

  suite("Tree view", () => {
    test("lists categories at the root and kits beneath them", () => {
      const provider = new KitTreeProvider(extensionPath)
      const categories = provider.getChildren()
      assert.ok(categories.length > 5)

      const buttons = categories.find((n) => n.type === "category" && n.category.id === "buttons")!
      const kits = provider.getChildren(buttons)
      assert.ok(kits.some((n) => n.type === "kit" && n.kit.react === "Button"))
      assert.deepStrictEqual(provider.getChildren(kits[0]), [])
    })

    test("a kit item opens that kit's actions when clicked", () => {
      const provider = new KitTreeProvider(extensionPath)
      const node = provider
        .getChildren(provider.getChildren().find((n) => n.type === "category" && n.category.id === "buttons")!)
        .find((n) => n.type === "kit" && n.kit.react === "Button")!
      const item = provider.getTreeItem(node)

      assert.strictEqual(item.label, "Button")
      assert.strictEqual(item.command?.command, "playbook.kitActions")
      assert.deepStrictEqual(item.command?.arguments, ["button"])
      assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None)
    })

    test("a category item shows how many kits it holds", () => {
      const provider = new KitTreeProvider(extensionPath)
      const node = provider.getChildren()[0]
      const item = provider.getTreeItem(node)
      assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed)
      assert.ok(node.type === "category" && item.description === String(node.category.kits.length))
    })

    test("refresh notifies listeners", () => {
      const provider = new KitTreeProvider(extensionPath)
      let fired = 0
      provider.onDidChangeTreeData(() => fired++)
      provider.refresh()
      assert.strictEqual(fired, 1)
    })
  })

  suite("Editor platform", () => {
    async function platformOf(languageId: string) {
      const document = await createTestDocument(languageId, "")
      const editor = await vscode.window.showTextDocument(document)
      return platformForEditor(editor)
    }

    test("maps languages to platforms", async () => {
      assert.strictEqual(await platformOf("erb"), "rails")
      assert.strictEqual(await platformOf("ruby"), "rails")
      assert.strictEqual(await platformOf("typescriptreact"), "react")
      assert.strictEqual(await platformOf("javascript"), "react")
    })

    test("has no platform for other languages or no editor", async () => {
      assert.strictEqual(await platformOf("plaintext"), undefined)
      assert.strictEqual(platformForEditor(undefined), undefined)
    })
  })

  suite("Status bar", () => {
    test("says the metadata is bundled when the workspace has none", () => {
      const bar = new PlaybookStatusBar(extensionPath)
      try {
        const { text, tooltip } = bar.describe()
        assert.ok(text.includes("Playbook v"), text)
        assert.ok(text.includes("(bundled)"), text)
        assert.ok(tooltip.includes("Install playbook-ui"), tooltip)
      } finally {
        bar.dispose()
      }
    })
  })

  suite("Commands", () => {
    test("registers every Playbook command on activation", async () => {
      await vscode.extensions.getExtension("ClancyTools.playbook-vscode")!.activate()
      const commands = await vscode.commands.getCommands(true)
      for (const id of [
        "playbook.browseKits",
        "playbook.findDeprecated",
        "playbook.reloadMetadata",
        "playbook.showInfo",
        "playbook.kitActions",
      ]) {
        assert.ok(commands.includes(id), `${id} should be registered`)
      }
    })

    test("reloading metadata succeeds and keeps providing docs", async () => {
      await vscode.extensions.getExtension("ClancyTools.playbook-vscode")!.activate()
      await vscode.commands.executeCommand("playbook.reloadMetadata")
      assert.ok(Object.keys(loadMetadata(extensionPath).components).length > 100)
    })
  })
})
