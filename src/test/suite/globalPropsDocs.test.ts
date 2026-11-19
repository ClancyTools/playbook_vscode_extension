import * as assert from "assert"
import * as path from "path"
import * as vscode from "vscode"
import { PlaybookHoverProvider } from "../../hoverProvider"
import {
  buildGlobalPropGroups,
  findComponentByRailsName,
  generateComponentDocs,
  generateGlobalPropsDocs,
  globalPropsSummaryLines,
  loadMetadata,
  PlaybookMetadata,
} from "../../metadata"
import { createTestDocument } from "./testHelpers"

suite("Global Props Docs Test Suite", () => {
  const extensionPath = path.resolve(__dirname, "../../../")
  let metadata: PlaybookMetadata

  suiteSetup(() => {
    metadata = loadMetadata(extensionPath)
  })

  suite("buildGlobalPropGroups", () => {
    test("groups props by purpose in a fixed order", () => {
      const titles = buildGlobalPropGroups(metadata, "react").map((g) => g.title)
      assert.deepStrictEqual(titles.slice(0, 3), ["Spacing", "Flexbox", "Grid"])
      assert.strictEqual(titles[titles.length - 1], "Other")
    })

    test("puts every global prop in exactly one group", () => {
      const grouped = buildGlobalPropGroups(metadata, "rails").flatMap((g) => g.rows.flatMap((r) => r.names))
      assert.strictEqual(grouped.length, Object.keys(metadata.globalProps!).length)
      assert.strictEqual(new Set(grouped).size, grouped.length)
    })

    test("names are alphabetized within a row and rows by their first name", () => {
      for (const group of buildGlobalPropGroups(metadata, "react")) {
        for (const row of group.rows) {
          assert.deepStrictEqual(row.names, [...row.names].sort((a, b) => a.localeCompare(b)))
        }
        const firsts = group.rows.map((r) => r.names[0])
        assert.deepStrictEqual(firsts, [...firsts].sort((a, b) => a.localeCompare(b)))
      }
    })

    test("margin and padding props that share the spacing scale are one row", () => {
      const spacing = buildGlobalPropGroups(metadata, "react").find((g) => g.title === "Spacing")!
      assert.strictEqual(spacing.rows.length, 1)
      assert.ok(spacing.rows[0].names.includes("marginBottom") && spacing.rows[0].names.includes("paddingX"))
      assert.deepStrictEqual(spacing.rows[0].values, ["none", "xxs", "xs", "sm", "md", "lg", "xl", "xxl", "auto", "initial", "inherit"])
      assert.ok(spacing.rows[0].responsive)
    })

    test("uses snake_case for Rails and camelCase for React", () => {
      const names = (platform: "rails" | "react") =>
        buildGlobalPropGroups(metadata, platform).flatMap((g) => g.rows.flatMap((r) => r.names))
      assert.ok(names("rails").includes("margin_bottom") && !names("rails").includes("marginBottom"))
      assert.ok(names("react").includes("marginBottom") && !names("react").includes("margin_bottom"))
    })

    test("never shortens a value list", () => {
      const flex = buildGlobalPropGroups(metadata, "react")
        .flatMap((g) => g.rows)
        .find((r) => r.names.includes("flex"))!
      assert.ok(flex.values!.length > 5, "flex has more than five values")
      assert.deepStrictEqual(flex.values, metadata.globalProps!.flex.values)
    })
  })

  suite("Kit hover summary", () => {
    test("lists every name per group, alphabetized, with no value truncation marker", () => {
      const text = globalPropsSummaryLines(metadata, "react").join("\n")
      assert.ok(text.includes("**Spacing** (14) — `margin` `marginBottom`"), text)
      assert.ok(text.includes("**Flexbox**") && text.includes("`justifyContent`"), text)
      assert.ok(!text.includes("..."), "no truncated enum lists")
      assert.ok(text.includes("**Spacing scale:** `xxs` 4px"), text)
    })

    test("is far shorter than the old one-line-per-prop list", () => {
      const lines = globalPropsSummaryLines(metadata, "react").filter((l) => l.trim() !== "")
      assert.ok(lines.length < 20, `${lines.length} lines`)
    })

    test("points at the full reference", () => {
      assert.ok(globalPropsSummaryLines(metadata, "react").join("\n").includes("Playbook: Show Global Props"))
    })

    test("a kit hover uses the editor's naming and keeps the section out for opted-out kits", () => {
      const button = findComponentByRailsName(metadata, "button")!
      const rails = generateComponentDocs("button", button, metadata, undefined, "erb")
      const react = generateComponentDocs("Button", button, metadata, undefined, "typescriptreact")
      assert.ok(rails.includes("`margin_bottom`") && !rails.includes("`marginBottom`"))
      assert.ok(react.includes("`marginBottom`") && !react.includes("`margin_bottom`"))

      const optedOut = generateComponentDocs("Button", { ...button, hasGlobalProps: false }, metadata)
      assert.ok(!optedOut.includes("## Global Props"))
    })

    test("a kit's own props are alphabetized", () => {
      const text = generateComponentDocs("Button", findComponentByRailsName(metadata, "button")!, metadata)
      const props = [...text.split("## Props")[1].split("## Global")[0].matchAll(/^\*\*([a-z_]+)\*\*/gm)].map((m) => m[1])
      assert.ok(props.length > 5)
      assert.deepStrictEqual(props, [...props].sort((a, b) => a.localeCompare(b)))
    })

    test("the hover provider renders the new section", async () => {
      const provider = new PlaybookHoverProvider(extensionPath)
      const document = await createTestDocument("typescriptreact", '<Button text="x" />')
      const hover = (await provider.provideHover(document, new vscode.Position(0, 3))) as vscode.Hover
      const text = (hover.contents[0] as vscode.MarkdownString).value
      assert.ok(text.includes("**Spacing** (14)"), text)
    })
  })

  suite("Full reference", () => {
    test("is a Markdown document with a table per group", () => {
      const doc = generateGlobalPropsDocs(metadata, "react")
      assert.ok(doc.startsWith("# Playbook global props"))
      assert.ok(doc.includes("## Spacing") && doc.includes("## Flexbox"))
      assert.ok(doc.includes("| Props | Values | ↔ |"))
    })

    test("writes every value of long enums in full", () => {
      const doc = generateGlobalPropsDocs(metadata, "react")
      const flexRow = doc.split("\n").find((l) => l.startsWith("| `flex` |"))!
      for (const value of metadata.globalProps!.flex.values!) {
        assert.ok(flexRow.includes(`\`${value}\``), `${value} missing from ${flexRow}`)
      }
    })

    test("explains responsive objects with the breakpoints, in the platform's syntax", () => {
      assert.ok(generateGlobalPropsDocs(metadata, "rails").includes('`{ default: "sm", md: "lg" }`'))
      assert.ok(generateGlobalPropsDocs(metadata, "react").includes("`{{ default: 'sm', md: 'lg' }}`"))
      assert.ok(generateGlobalPropsDocs(metadata, "react").includes("`md` 768px-991px"))
    })

    test("states which spelling it is showing", () => {
      assert.ok(generateGlobalPropsDocs(metadata, "rails").includes("Showing Rails names (snake_case)"))
      assert.ok(generateGlobalPropsDocs(metadata, "react").includes("Showing React names (camelCase)"))
    })

    test("no table cell contains a raw pipe from a type like 'string | responsive'", () => {
      for (const line of generateGlobalPropsDocs(metadata, "react").split("\n")) {
        if (line.startsWith("| ") && !line.startsWith("| Props") && !line.startsWith("|---")) {
          assert.strictEqual(line.split(/(?<!\\)\|/).length, 5, `bad table row: ${line}`)
        }
      }
    })

    test("the Show Global Props command is registered", async () => {
      await vscode.extensions.getExtension("ClancyTools.playbook-vscode")!.activate()
      assert.ok((await vscode.commands.getCommands(true)).includes("playbook.showGlobalProps"))
    })
  })
})
