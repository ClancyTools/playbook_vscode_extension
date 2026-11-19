import * as assert from "assert"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import { buttonVariant, describeHit, familyById, scanBootstrap } from "../../bootstrapCatalog"
import { LocatedBootstrap, buildBootstrapReport, folderOf, summarizeBootstrap } from "../../bootstrapReport"
import { sweepBootstrap } from "../../bootstrapSweep"
import { sweepScope } from "../../deprecatedUsages"
import { PlaybookDiagnostics } from "../../diagnostics"
import { filesInScope, pathFromArgument, scopeFromArgument } from "../../scope"
import { lineColumn } from "../../textPosition"
import { createTestDocument } from "./testHelpers"

const NO_PROGRESS: vscode.Progress<{ message?: string }> = { report: () => undefined }
const NOT_CANCELLED = new vscode.CancellationTokenSource().token

suite("Scope and Bootstrap Test Suite", () => {
  const extensionPath = path.resolve(__dirname, "../../../")
  let tmp: string

  setup(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "playbook-scope-"))
  })

  teardown(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  suite("Scope arguments", () => {
    test("reads a path from a string, a Uri, an object or an array", () => {
      assert.strictEqual(pathFromArgument("components/x"), "components/x")
      assert.strictEqual(pathFromArgument(vscode.Uri.file("/a/b")), vscode.Uri.file("/a/b").fsPath)
      assert.strictEqual(pathFromArgument({ path: "components/y" }), "components/y")
      assert.strictEqual(pathFromArgument([vscode.Uri.file("/a/c")]), vscode.Uri.file("/a/c").fsPath)
      assert.strictEqual(pathFromArgument(undefined), undefined)
      assert.strictEqual(pathFromArgument(42), undefined)
    })

    test("a folder argument becomes a folder scope labelled relative to the workspace", () => {
      const folder = path.join(tmp, "components", "billing")
      fs.mkdirSync(folder, { recursive: true })
      const scope = scopeFromArgument(vscode.Uri.file(folder), [tmp])!
      assert.strictEqual(scope.kind, "folder")
      assert.strictEqual(scope.label, path.join("components", "billing"))
    })

    test("a relative path is resolved against each workspace root", () => {
      fs.mkdirSync(path.join(tmp, "components", "billing"), { recursive: true })
      const scope = scopeFromArgument({ path: "components/billing" }, ["/not/here", tmp])!
      assert.strictEqual(scope.kind, "folder")
      assert.ok(scope.kind === "folder" && scope.uri.fsPath === path.join(tmp, "components", "billing"))
    })

    test("a file argument becomes a file scope", () => {
      const file = path.join(tmp, "a.erb")
      fs.writeFileSync(file, "")
      assert.strictEqual(scopeFromArgument(file, [tmp])?.kind, "file")
    })

    test("{ scope: 'workspace' } explicitly asks for everything", () => {
      assert.strictEqual(scopeFromArgument({ scope: "workspace" }, [tmp])?.kind, "workspace")
    })

    test("a path that doesn't exist, or no argument, means ask the user", () => {
      assert.strictEqual(scopeFromArgument("nope/missing", [tmp]), undefined)
      assert.strictEqual(scopeFromArgument(undefined, [tmp]), undefined)
    })

    test("a file scope lists just that file", async () => {
      const file = vscode.Uri.file(path.join(tmp, "a.erb"))
      const files = await filesInScope({ kind: "file", uri: file, label: "a.erb" }, "**/*.erb")
      assert.deepStrictEqual(files.map((f) => f.fsPath), [file.fsPath])
    })
  })

  suite("Bootstrap scanner", () => {
    const families = (text: string) => scanBootstrap(text).map((h) => [h.family, h.classes.join(" ")])

    test("groups the classes of one attribute by family", () => {
      assert.deepStrictEqual(families('<a class="btn btn-primary btn-sm">x</a>'), [["button", "btn btn-primary btn-sm"]])
    })

    test("reports each family in an attribute separately", () => {
      assert.deepStrictEqual(families('<div class="row d-flex mt-3">'), [
        ["grid", "row"],
        ["flex", "d-flex"],
        ["spacing", "mt-3"],
      ])
    })

    test("reads class, className and Ruby class: attributes", () => {
      assert.deepStrictEqual(families('<div class="alert alert-danger">'), [["alert", "alert alert-danger"]])
      assert.deepStrictEqual(families('<div className="panel panel-default">'), [["card", "panel panel-default"]])
      assert.deepStrictEqual(families("<div className={'table table-striped'}>"), [["table", "table table-striped"]])
      assert.deepStrictEqual(families('content_tag :div, class: "badge badge-info"'), [["badge", "badge badge-info"]])
    })

    test("ignores classes that aren't Bootstrap", () => {
      assert.deepStrictEqual(families('<div class="my-widget pb_card_kit">'), [])
    })

    test("skips tokens with ERB or interpolation instead of guessing", () => {
      assert.deepStrictEqual(families('<a class="btn <%= variant %> btn-<%= size %>">'), [["button", "btn"]])
      assert.deepStrictEqual(families('<div class="col-md-#{n}">'), [])
    })

    test("covers the common grid, form, nav and spacing names", () => {
      assert.deepStrictEqual(families('<div class="col-xs-12 col-md-6">'), [["grid", "col-xs-12 col-md-6"]])
      assert.deepStrictEqual(families('<input class="form-control">'), [["form", "form-control"]])
      assert.deepStrictEqual(families('<ul class="nav nav-tabs">'), [["nav", "nav nav-tabs"]])
      assert.deepStrictEqual(families('<p class="text-muted pull-right">'), [["text", "text-muted pull-right"]])
      assert.deepStrictEqual(families('<i class="glyphicon glyphicon-plus">'), [["icon", "glyphicon glyphicon-plus"]])
    })

    test("positions a hit on its first class", () => {
      const text = '<div class="foo btn btn-primary">'
      const [hit] = scanBootstrap(text)
      assert.strictEqual(text.slice(hit.start, hit.end), "btn btn-primary")
    })

    test("finds several attributes in order", () => {
      const text = '<div class="row">\n  <a class="btn">x</a>\n</div>'
      assert.deepStrictEqual(scanBootstrap(text).map((h) => h.family), ["grid", "button"])
    })

    test("suggests a Playbook Button variant where there is a clear one", () => {
      assert.strictEqual(buttonVariant(["btn", "btn-primary"]), "primary")
      assert.strictEqual(buttonVariant(["btn", "btn-default"]), "secondary")
      assert.strictEqual(buttonVariant(["btn", "btn-danger"]), "danger")
      assert.strictEqual(buttonVariant(["btn", "btn-sm"]), undefined)
    })

    test("describes a hit with its Playbook equivalent", () => {
      const [hit] = scanBootstrap('<a class="btn btn-primary">')
      assert.strictEqual(
        describeHit(hit),
        'Bootstrap "btn btn-primary" → Playbook Button — pb_rails("button") / <Button> (variant: "primary")'
      )
      assert.ok(familyById("grid")!.playbook.includes("Flex"))
    })
  })

  suite("Bootstrap report", () => {
    const hit = (file: string, family: string, line = 0): LocatedBootstrap => ({
      file,
      family,
      classes: ["x"],
      start: 0,
      end: 1,
      line,
      column: 0,
    })
    const results = [
      hit("components/a/app/views/x.erb", "button"),
      hit("components/a/app/views/x.erb", "button"),
      hit("components/a/app/views/y.erb", "grid"),
      hit("components/b/app/views/z.erb", "button"),
    ]

    test("counts by family with file counts, most first", () => {
      const { families } = summarizeBootstrap(results)
      assert.deepStrictEqual(
        families.map((f) => [f.id, f.count, f.files]),
        [["button", 3, 2], ["grid", 1, 1]]
      )
    })

    test("counts by file and by folder", () => {
      const { files, folders } = summarizeBootstrap(results)
      assert.deepStrictEqual(files[0], { file: "components/a/app/views/x.erb", count: 2 })
      assert.deepStrictEqual(folders, [
        { folder: "components/a/app", count: 3 },
        { folder: "components/b/app", count: 1 },
      ])
    })

    test("folderOf keeps up to three segments of the directory", () => {
      assert.strictEqual(folderOf("components/a/app/views/x.erb"), "components/a/app")
      assert.strictEqual(folderOf("app/views/x.erb"), "app/views")
      assert.strictEqual(folderOf("x.erb"), "x.erb".split("/").slice(0, 1).join("/"))
    })

    test("the Markdown report has the headline, tables and a caution", () => {
      const report = buildBootstrapReport(results, "components/a", 12)
      assert.ok(report.startsWith("# Bootstrap markup in components/a"))
      assert.ok(report.includes("4 class attributes use Bootstrap classes across 3 of 12 scanned files"))
      assert.ok(report.includes("| Buttons (btn, btn-*) | 3 | 2 |"))
      assert.ok(report.includes("| components/a/app | 3 |"))
      assert.ok(report.includes("class name only"))
    })

    test("limits how many files and folders are listed", () => {
      const many = Array.from({ length: 10 }, (_, i) => hit(`components/c${i}/app/v/f${i}.erb`, "button"))
      const report = buildBootstrapReport(many, "x", 10, 3, 2)
      assert.ok(report.includes("top 3"), report)
      assert.ok(report.includes("top 2"), report)
    })
  })

  suite("Scoped sweeps", () => {
    test("the deprecation sweep reads only the file it is scoped to", async () => {
      const file = path.join(tmp, "a.erb")
      fs.writeFileSync(file, '<%= pb_rails("flex", props: { horizontal: "center" }) %>')
      fs.writeFileSync(path.join(tmp, "b.erb"), '<%= pb_rails("flex", props: { horizontal: "left" }) %>')

      const outcome = await sweepScope(extensionPath, { kind: "file", uri: vscode.Uri.file(file), label: "a.erb" }, NO_PROGRESS, NOT_CANCELLED)
      assert.strictEqual(outcome.filesScanned, 1)
      assert.deepStrictEqual(outcome.results.map((r) => [r.kit, r.prop]), [["flex", "horizontal"]])
      assert.strictEqual(outcome.results[0].uri.fsPath, file)
    })

    test("a file with no Playbook usage is not counted as scanned", async () => {
      const file = path.join(tmp, "plain.erb")
      fs.writeFileSync(file, "<p>hello</p>")
      const outcome = await sweepScope(extensionPath, { kind: "file", uri: vscode.Uri.file(file), label: "plain.erb" }, NO_PROGRESS, NOT_CANCELLED)
      assert.deepStrictEqual(outcome, { results: [], filesScanned: 0 })
    })

    test("the Bootstrap sweep finds hits with line numbers in the scoped file", async () => {
      const file = path.join(tmp, "page.erb")
      fs.writeFileSync(file, '<div class="row">\n  <a class="btn btn-primary">Go</a>\n</div>\n')
      const outcome = await sweepBootstrap({ kind: "file", uri: vscode.Uri.file(file), label: "page.erb" }, NO_PROGRESS, NOT_CANCELLED)

      assert.strictEqual(outcome.filesScanned, 1)
      assert.deepStrictEqual(outcome.results.map((r) => [r.family, r.line]), [["grid", 0], ["button", 1]])
    })

    test("a cancelled sweep stops early", async () => {
      const source = new vscode.CancellationTokenSource()
      source.cancel()
      const file = path.join(tmp, "page.erb")
      fs.writeFileSync(file, '<div class="row">')
      const outcome = await sweepBootstrap({ kind: "file", uri: vscode.Uri.file(file), label: "page.erb" }, NO_PROGRESS, source.token)
      assert.deepStrictEqual(outcome.results, [])
    })

    test("lineColumn locates an offset", () => {
      assert.deepStrictEqual(lineColumn("ab\ncd\nef", 4), { line: 1, column: 1 })
      assert.deepStrictEqual(lineColumn("ab", 1), { line: 0, column: 1 })
    })
  })

  suite("In-editor Bootstrap hint", () => {
    let diagnostics: PlaybookDiagnostics

    suiteSetup(() => {
      diagnostics = new PlaybookDiagnostics(extensionPath)
    })
    suiteTeardown(() => diagnostics.dispose())

    const config = () => vscode.workspace.getConfiguration("playbook")

    teardown(async () => {
      await config().update("diagnostics.bootstrap", undefined, vscode.ConfigurationTarget.Global)
    })

    async function codes(content: string) {
      const document = await createTestDocument("erb", content)
      diagnostics.updateDiagnostics(document)
      return diagnostics.getDiagnostics(document.uri)
    }

    test("is off by default", async () => {
      assert.ok(!(await codes('<a class="btn btn-primary">x</a>')).some((d) => d.code === "bootstrap-class"))
    })

    test("when on, hints at the Playbook equivalent without being a warning", async () => {
      await config().update("diagnostics.bootstrap", true, vscode.ConfigurationTarget.Global)
      const found = (await codes('<a class="btn btn-primary">x</a>')).filter((d) => d.code === "bootstrap-class")
      assert.strictEqual(found.length, 1)
      assert.strictEqual(found[0].severity, vscode.DiagnosticSeverity.Hint)
      assert.ok(found[0].message.includes("Playbook Button"), found[0].message)
    })
  })
})
