import * as assert from "assert"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { loadMetadata, PlaybookMetadata } from "../../metadata"
import { loadPlayground, Playground } from "../../playgrounds"
import { suggest, levenshtein, normalizeName } from "../../suggestions"
import { packageAvailability } from "../../workspacePackages"
import { scanReactUsages } from "../../usageScanner"
import {
  checkUsages,
  Finding,
  literalValue,
  RuleContext,
  VETTED_DEPENDENCIES,
} from "../../usageRules"

suite("Usage Rules Test Suite", () => {
  const extensionPath = path.resolve(__dirname, "../../../")
  let metadata: PlaybookMetadata

  suiteSetup(() => {
    metadata = loadMetadata(extensionPath)
  })

  function context(languageId: string, extra: Partial<RuleContext> = {}): RuleContext {
    return {
      languageId,
      metadata,
      getPlayground: (name) => loadPlayground(extensionPath, name),
      ...extra,
    }
  }

  function check(text: string, languageId: string, extra: Partial<RuleContext> = {}): Finding[] {
    return checkUsages(text, context(languageId, extra))
  }

  function codes(findings: Finding[]): string[] {
    return findings.map((f) => f.code)
  }

  suite("Deprecated props", () => {
    test("flags a Rails-deprecated prop on the prop name", () => {
      const text = '<%= pb_rails("flex", props: { horizontal: "center" }) %>'
      const [finding] = check(text, "erb")

      assert.strictEqual(finding.code, "deprecated-prop")
      assert.strictEqual(text.slice(finding.start, finding.end), "horizontal")
      assert.ok(finding.deprecated, "rendered struck through")
      assert.strictEqual(finding.severity, "information")
    })

    test("suggests the replacement when Playbook names one", () => {
      const text = '<%= pb_rails("caption", props: { text: "x", variant: "link" }) %>'
      const [finding] = check(text, "erb")
      assert.ok(finding.message.includes('Use "color" instead'), finding.message)
    })

    test("uses the React spelling of the replacement in React files", () => {
      const [finding] = check('<Body status="positive" text="x" />', "typescriptreact")
      assert.ok(finding.message.includes('Use "color" instead'), finding.message)
    })

    test("does not report a Rails-only deprecation in React", () => {
      assert.deepStrictEqual(check('<Flex horizontal="center" />', "typescriptreact"), [])
    })

    test("does not report the React-only deprecation in Rails", () => {
      assert.deepStrictEqual(
        check('<%= pb_rails("button", props: { type: "submit" }) %>', "erb"),
        []
      )
    })

    test("reports the React-only deprecation in React", () => {
      const findings = check('<Button type="submit" text="x" />', "typescriptreact")
      assert.deepStrictEqual(codes(findings), ["deprecated-prop"])
    })

    test("reports each deprecated prop in a usage", () => {
      const findings = check(
        '<%= pb_rails("flex", props: { horizontal: "left", vertical: "top", spacing: "none" }) %>',
        "erb"
      )
      assert.strictEqual(findings.length, 3)
    })

    test("is quiet for current props", () => {
      assert.deepStrictEqual(
        check('<%= pb_rails("flex", props: { justify: "center", align: "top" }) %>', "erb"),
        []
      )
    })

    test("can be turned off", () => {
      const text = '<%= pb_rails("flex", props: { horizontal: "center" }) %>'
      assert.deepStrictEqual(check(text, "erb", { options: { deprecations: false } }), [])
    })

    test("ignores unknown kits and subcomponents", () => {
      assert.deepStrictEqual(
        check('<%= pb_rails("not_a_kit", props: { horizontal: "x" }) %>', "erb"),
        []
      )
      assert.deepStrictEqual(
        check('<%= pb_rails("table/table_row", props: { horizontal: "x" }) %>', "erb"),
        []
      )
    })
  })

  suite("Prop dependencies", () => {
    test("flags a pill prop used without multiSelect", () => {
      const text = '<Dropdown options={o} showPillIndex />'
      const [finding] = check(text, "typescriptreact")

      assert.strictEqual(finding.code, "prop-dependency")
      assert.strictEqual(text.slice(finding.start, finding.end), "showPillIndex")
      assert.ok(finding.message.includes('"multiSelect"'), finding.message)
    })

    test("accepts the dependency as shorthand", () => {
      assert.deepStrictEqual(check("<Dropdown multiSelect showPillIndex />", "typescriptreact"), [])
    })

    test("flags the dependency when it is explicitly false", () => {
      const findings = check("<Dropdown multiSelect={false} showPillIndex />", "typescriptreact")
      assert.deepStrictEqual(codes(findings), ["prop-dependency"])
    })

    test("gives dynamic values the benefit of the doubt", () => {
      assert.deepStrictEqual(
        check("<Dropdown multiSelect={isMulti} showPillIndex />", "typescriptreact"),
        []
      )
    })

    test("works in Rails with snake_case names", () => {
      const text = '<%= pb_rails("dropdown", props: { form_pill_props: { size: "small" } }) %>'
      const [finding] = check(text, "erb")

      assert.strictEqual(finding.code, "prop-dependency")
      assert.strictEqual(text.slice(finding.start, finding.end), "form_pill_props")
      assert.ok(finding.message.includes('"multi_select"'), "uses Rails spelling")
    })

    test("is satisfied by the Rails dependency", () => {
      assert.deepStrictEqual(
        check(
          '<%= pb_rails("dropdown", props: { multi_select: true, show_pill_index: true }) %>',
          "erb"
        ),
        []
      )
    })

    test("flags link target without href", () => {
      const findings = check('<%= pb_rails("link", props: { text: "x", target: "_blank" }) %>', "erb")
      assert.deepStrictEqual(codes(findings), ["prop-dependency"])
    })

    test("is satisfied when href is present", () => {
      assert.deepStrictEqual(
        check('<%= pb_rails("link", props: { href: "/x", target: "_blank" }) %>', "erb"),
        []
      )
    })

    test("stays quiet when props are spread in, since they may supply the dependency", () => {
      assert.deepStrictEqual(check("<Dropdown {...rest} showPillIndex />", "typescriptreact"), [])
      assert.deepStrictEqual(
        check('<%= pb_rails("dropdown", props: { show_pill_index: true, **opts }) %>', "erb"),
        []
      )
    })

    test("only enforces vetted rules", () => {
      // Playbook's playground says Flex-style "horizontal" pairs with "vertical", but
      // that is a layout hint, not behaviour: it must not be reported.
      const toast = '<%= pb_rails("fixed_confirmation_toast", props: { horizontal: "left" }) %>'
      assert.ok(!codes(check(toast, "erb")).includes("prop-dependency"))
      const button = '<Button iconRight="arrow-right" text="x" />'
      assert.deepStrictEqual(check(button, "typescriptreact"), [])
    })

    test("treats a default that satisfies the rule as satisfied", () => {
      const playground: Playground = { conditionals: { target: { requires: { variant: "primary" } } } }
      const withDefault = check('<Button target="_blank" text="x" />', "typescriptreact", {
        getPlayground: (name) => (name === "button" ? playground : undefined),
      })
      assert.deepStrictEqual(withDefault, [], "variant defaults to primary")

      const overridden = check('<Button variant="link" target="_blank" text="x" />', "typescriptreact", {
        getPlayground: (name) => (name === "button" ? playground : undefined),
      })
      assert.deepStrictEqual(codes(overridden), ["prop-dependency"])
      assert.ok(overridden[0].message.includes('variant is "primary"'), overridden[0].message)
    })

    test("ignores a requirement that is not a real prop of the kit", () => {
      const playground: Playground = { conditionals: { target: { requires: "imaginaryProp" } } }
      assert.deepStrictEqual(
        check('<Button target="_blank" text="x" />', "typescriptreact", {
          getPlayground: () => playground,
        }),
        []
      )
    })

    test("can be turned off", () => {
      assert.deepStrictEqual(
        check("<Dropdown showPillIndex />", "typescriptreact", { options: { propDependencies: false } }),
        []
      )
    })

    test("every vetted rule still exists in the synced Playbook data", () => {
      for (const key of VETTED_DEPENDENCIES) {
        const [kit, prop] = key.split(".")
        const conditional = loadPlayground(extensionPath, kit)?.conditionals?.[prop]
        assert.ok(conditional?.requires, `${key} is no longer a Playbook conditional; re-vet or remove it`)
      }
    })
  })

  suite("Missing host packages", () => {
    test("flags a Highcharts kit when Highcharts is not installed", () => {
      const text = '<%= pb_rails("pb_bar_graph", props: { id: "x" }) %>'
      const [finding] = check(text, "erb", { isPackageAvailable: () => false })

      assert.strictEqual(finding.code, "missing-package")
      assert.strictEqual(finding.severity, "warning")
      assert.strictEqual(text.slice(finding.start, finding.end), "pb_bar_graph")
      assert.ok(finding.message.includes('"highcharts"'), finding.message)
    })

    test("lists only the packages that are missing", () => {
      const [finding] = check("<PbBarGraph />", "typescriptreact", {
        isPackageAvailable: (pkg) => pkg === "highcharts",
      })
      assert.ok(finding.message.includes('"highcharts-react-official"'), finding.message)
      assert.ok(!finding.message.includes('"highcharts",'), finding.message)
    })

    test("is quiet when every package is available", () => {
      assert.deepStrictEqual(check("<PbBarGraph />", "typescriptreact", { isPackageAvailable: () => true }), [])
    })

    test("is skipped when package availability is unknown", () => {
      assert.deepStrictEqual(check("<PbBarGraph />", "typescriptreact"), [])
    })

    test("is quiet for kits with no external dependencies", () => {
      assert.deepStrictEqual(check("<Button text='x' />", "typescriptreact", { isPackageAvailable: () => false }), [])
    })

    test("can be turned off", () => {
      assert.deepStrictEqual(
        check("<PbBarGraph />", "typescriptreact", {
          isPackageAvailable: () => false,
          options: { externalDependencies: false },
        }),
        []
      )
    })
  })

  suite("literalValue", () => {
    function literal(valueText: string | undefined): string | boolean | undefined {
      return literalValue({ name: "x", nameStart: 0, nameEnd: 1, valueText })
    }

    test("reads shorthand and boolean literals", () => {
      assert.strictEqual(literal(undefined), true)
      assert.strictEqual(literal("{true}"), true)
      assert.strictEqual(literal("true"), true)
      assert.strictEqual(literal("{false}"), false)
    })

    test("reads quoted strings and symbols", () => {
      assert.strictEqual(literal('"quickpick"'), "quickpick")
      assert.strictEqual(literal("'quickpick'"), "quickpick")
      assert.strictEqual(literal("{'quickpick'}"), "quickpick")
      assert.strictEqual(literal(":quickpick"), "quickpick")
    })

    test("returns undefined for anything dynamic", () => {
      assert.strictEqual(literal("{isMulti}"), undefined)
      assert.strictEqual(literal("some_variable"), undefined)
      assert.strictEqual(literal('"a #{b}"'), undefined)
      assert.strictEqual(literal("{`a-${b}`}"), undefined)
    })
  })

  suite("packageAvailability", () => {
    let tmp: string

    setup(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "playbook-pkg-"))
    })

    teardown(() => {
      fs.rmSync(tmp, { recursive: true, force: true })
    })

    test("is undefined when there is no package.json above the file", () => {
      assert.strictEqual(packageAvailability(path.join(tmp, "a", "file.tsx")), undefined)
    })

    test("sees dependencies declared in a package.json above the file", () => {
      fs.writeFileSync(
        path.join(tmp, "package.json"),
        JSON.stringify({ dependencies: { highcharts: "^11" }, devDependencies: { zod: "1" } })
      )
      const has = packageAvailability(path.join(tmp, "src", "file.tsx"))!

      assert.ok(has("highcharts"))
      assert.ok(has("zod"))
      assert.ok(!has("maplibre-gl"))
    })

    test("sees packages installed in a node_modules above the file", () => {
      fs.writeFileSync(path.join(tmp, "package.json"), "{}")
      const installed = path.join(tmp, "node_modules", "maplibre-gl")
      fs.mkdirSync(installed, { recursive: true })
      fs.writeFileSync(path.join(installed, "package.json"), "{}")

      assert.ok(packageAvailability(path.join(tmp, "src", "file.tsx"))!("maplibre-gl"))
    })

    test("merges a nested component's package.json with the root's", () => {
      fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ dependencies: { a: "1" } }))
      fs.mkdirSync(path.join(tmp, "components", "x"), { recursive: true })
      fs.writeFileSync(
        path.join(tmp, "components", "x", "package.json"),
        JSON.stringify({ dependencies: { b: "1" } })
      )
      const has = packageAvailability(path.join(tmp, "components", "x", "file.tsx"))!

      assert.ok(has("a") && has("b"))
    })

    test("tolerates an unreadable package.json", () => {
      fs.writeFileSync(path.join(tmp, "package.json"), "{ not json")
      const has = packageAvailability(path.join(tmp, "file.tsx"))!
      assert.ok(!has("anything"))
    })
  })

  suite("Suggestions", () => {
    test("normalizeName ignores case, underscores and dashes", () => {
      assert.strictEqual(normalizeName("margin_Bottom"), "marginbottom")
      assert.strictEqual(normalizeName("margin-bottom"), "marginbottom")
    })

    test("levenshtein counts single edits", () => {
      assert.strictEqual(levenshtein("kitten", "sitting"), 3)
      assert.strictEqual(levenshtein("same", "same"), 0)
      assert.strictEqual(levenshtein("", "abc"), 3)
    })

    test("suggests the same name in the other casing", () => {
      assert.deepStrictEqual(suggest("marginBottom", ["margin_bottom", "margin_top"]), ["margin_bottom"])
      assert.deepStrictEqual(suggest("marginbottom", ["margin_bottom"]), ["margin_bottom"])
    })

    test("suggests reordered words", () => {
      assert.strictEqual(suggest("bottom_margin", ["margin_bottom", "padding"])[0], "margin_bottom")
    })

    test("suggests typos, closest first", () => {
      const result = suggest("margin_botom", ["margin_bottom", "margin_top", "padding"])
      assert.strictEqual(result[0], "margin_bottom")
      assert.ok(!result.includes("padding"))
    })

    test("suggests nothing for unrelated names", () => {
      assert.deepStrictEqual(suggest("zzzzzz", ["margin_bottom", "padding"]), [])
    })

    test("does not suggest the input itself", () => {
      assert.deepStrictEqual(suggest("padding", ["padding"]), [])
    })

    test("limits the number of suggestions", () => {
      const candidates = ["align_a", "align_b", "align_c", "align_d", "align_e"]
      assert.strictEqual(suggest("align_", candidates, 2).length, 2)
    })

    test("allows fewer edits in short names", () => {
      assert.deepStrictEqual(suggest("sz", ["size", "text"]), [])
      assert.deepStrictEqual(suggest("size", ["sise"]), ["sise"])
    })

    test("returns nothing for empty input", () => {
      assert.deepStrictEqual(suggest("", ["a"]), [])
    })
  })

  suite("Scanner and rules agree on real usage", () => {
    test("a scanned React tag round-trips through the rules", () => {
      const text = '<Dropdown\n  showPillIndex\n  options={options}\n/>'
      const [usage] = scanReactUsages(text)
      const [finding] = check(text, "typescriptreact")

      assert.strictEqual(finding.start, usage.props[0].nameStart)
    })
  })
})
