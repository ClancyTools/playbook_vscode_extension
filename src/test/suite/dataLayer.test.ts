import * as assert from "assert"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { compareVersions, discoverAiDirs, overrideWorkspaceRoots, pickNewest } from "../../aiData"
import {
  findComponentByRailsName,
  getPropDefault,
  getPropDeprecation,
  getPropType,
  getPropValues,
  isBooleanProp,
  loadMetadata,
  PlaybookMetadata,
  resetMetadataCache,
  PropMetadata,
} from "../../metadata"
import { scanReact, scanRuby } from "../../deprecationScan"
import { loadPlayground } from "../../playgrounds"

function makeAiDir(root: string, relative: string, version: string): string {
  const dir = path.join(root, relative, "node_modules", "playbook-ui", "dist", "ai")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "all-schemas.json"), "{}")
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify({ version }))
  return dir
}

suite("Data Layer Test Suite", () => {
  const extensionPath = path.resolve(__dirname, "../../../")
  let metadata: PlaybookMetadata
  let tmp: string

  suiteSetup(() => {
    metadata = loadMetadata(extensionPath)
  })

  setup(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "playbook-ai-"))
  })

  teardown(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  suite("compareVersions", () => {
    test("orders by numeric segment, not string", () => {
      assert.ok(compareVersions("18.10.0", "18.9.0") > 0)
      assert.ok(compareVersions("18.3.0", "18.4.0") < 0)
      assert.strictEqual(compareVersions("18.3.0", "18.3.0"), 0)
    })

    test("a release candidate sorts below its release", () => {
      assert.ok(compareVersions("18.4.0-rc.4", "18.4.0") < 0)
      assert.ok(compareVersions("18.4.0", "18.4.0-rc.9") > 0)
    })

    test("a release candidate sorts above the previous release", () => {
      assert.ok(compareVersions("18.4.0-rc.0", "18.3.0") > 0)
    })

    test("compares rc numbers numerically", () => {
      assert.ok(compareVersions("18.4.0-rc.10", "18.4.0-rc.9") > 0)
    })
  })

  suite("Source discovery", () => {
    test("finds playbook-ui in the workspace root", () => {
      const dir = makeAiDir(tmp, ".", "18.3.0")
      assert.deepStrictEqual(discoverAiDirs([tmp]), [dir])
    })

    test("finds playbook-ui inside monorepo component folders", () => {
      const dir = makeAiDir(tmp, path.join("components", "billing"), "18.3.0")
      assert.deepStrictEqual(discoverAiDirs([tmp]), [dir])
    })

    test("ignores folders that have no all-schemas.json", () => {
      const dir = path.join(tmp, "node_modules", "playbook-ui", "dist", "ai")
      fs.mkdirSync(dir, { recursive: true })
      assert.deepStrictEqual(discoverAiDirs([tmp]), [])
    })

    test("returns nothing when no workspace has Playbook", () => {
      assert.deepStrictEqual(discoverAiDirs([tmp]), [])
      assert.strictEqual(pickNewest([]), null)
    })

    test("prefers the newest installed version", () => {
      const older = makeAiDir(tmp, path.join("components", "a"), "18.3.0")
      const newer = makeAiDir(tmp, path.join("components", "b"), "18.4.0-rc.4")
      const picked = pickNewest(discoverAiDirs([tmp]))

      assert.strictEqual(picked?.dir, newer)
      assert.strictEqual(picked?.version, "18.4.0-rc.4")
      assert.strictEqual(picked?.bundled, false)
      assert.notStrictEqual(picked?.dir, older)
    })

    test("treats an unreadable index.json as the lowest version", () => {
      const broken = makeAiDir(tmp, path.join("components", "a"), "x")
      fs.writeFileSync(path.join(broken, "index.json"), "not json")
      const good = makeAiDir(tmp, path.join("components", "b"), "18.3.0")

      assert.strictEqual(pickNewest(discoverAiDirs([tmp]))?.dir, good)
    })
  })

  suite("Loading from a workspace install", () => {
    const extensionPath = path.resolve(__dirname, "../../../")

    /** A workspace whose node_modules holds a copy of the bundled data at `version`. */
    function installPlaybook(relative: string, version: string): string {
      const dir = path.join(tmp, relative, "node_modules", "playbook-ui", "dist", "ai")
      fs.mkdirSync(path.dirname(dir), { recursive: true })
      fs.cpSync(path.join(extensionPath, "data", "ai"), dir, { recursive: true })
      const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf-8"))
      fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify({ ...index, version }))
      return dir
    }

    teardown(() => {
      overrideWorkspaceRoots(undefined)
      resetMetadataCache()
    })

    test("uses the installed version, including platform-split props", () => {
      const dir = installPlaybook(".", "99.1.0")
      overrideWorkspaceRoots([tmp])
      resetMetadataCache()

      const loaded = loadMetadata(extensionPath)
      assert.strictEqual(loaded.source?.bundled, false)
      assert.strictEqual(loaded.source?.dir, dir)
      assert.strictEqual(loaded.version, "99.1.0")
      assert.ok(findComponentByRailsName(loaded, "avatar")!.props.size.valuesByPlatform?.rails)
    })

    test("finds an install inside a monorepo component", () => {
      installPlaybook(path.join("components", "billing"), "99.2.0")
      overrideWorkspaceRoots([tmp])
      resetMetadataCache()

      assert.strictEqual(loadMetadata(extensionPath).version, "99.2.0")
    })

    test("takes the newest of several installs", () => {
      installPlaybook(path.join("components", "a"), "18.3.0")
      installPlaybook(path.join("components", "b"), "18.4.0-rc.4")
      overrideWorkspaceRoots([tmp])
      resetMetadataCache()

      assert.strictEqual(loadMetadata(extensionPath).version, "18.4.0-rc.4")
    })

    test("reads playgrounds from the installed version too", () => {
      const dir = installPlaybook(".", "99.3.0")
      fs.writeFileSync(
        path.join(dir, "playgrounds", "button.json"),
        JSON.stringify({ presets: [{ name: "From workspace", props: { text: "x" } }] })
      )
      overrideWorkspaceRoots([tmp])
      resetMetadataCache()

      assert.strictEqual(loadPlayground(extensionPath, "button")?.presets?.[0].name, "From workspace")
    })

    test("falls back to the bundled copy when the install's schema is unreadable", () => {
      const dir = installPlaybook(".", "99.4.0")
      fs.writeFileSync(path.join(dir, "all-schemas.json"), "{ not json")
      overrideWorkspaceRoots([tmp])
      resetMetadataCache()

      const loaded = loadMetadata(extensionPath)
      assert.strictEqual(loaded.source?.bundled, true)
      assert.ok(Object.keys(loaded.components).length > 100)
    })

    test("falls back to the bundled copy when there is no install", () => {
      overrideWorkspaceRoots([tmp])
      resetMetadataCache()
      assert.strictEqual(loadMetadata(extensionPath).source?.bundled, true)
    })

    test("a missing playground is not an error", () => {
      overrideWorkspaceRoots([tmp])
      resetMetadataCache()
      assert.strictEqual(loadPlayground(extensionPath, "not_a_kit"), undefined)
      assert.strictEqual(loadPlayground(extensionPath, "../../etc/passwd"), undefined)
    })
  })

  suite("Bundled metadata", () => {
    test("loads from the bundled copy with a version", () => {
      assert.ok(metadata.source?.bundled, "test workspace has no playbook-ui, so bundled is used")
      assert.ok(metadata.version, "bundled metadata reports a version")
    })

    test("loads every kit", () => {
      assert.ok(Object.keys(metadata.components).length >= 100)
    })

    test("attaches visual-index gotchas and lookalikes", () => {
      const advancedTable = findComponentByRailsName(metadata, "advanced_table")
      assert.ok(advancedTable?.visual?.gotchas?.some((g) => g.includes("columnDefinitions")))
      assert.deepStrictEqual(advancedTable?.visual?.not, ["table"])
    })

    test("no kit's Rails example contains raw JSX (see KNOWN_LIMITATIONS #8)", () => {
      const leaking = Object.values(metadata.components)
        .filter((c) => /<[A-Z][\w.]*[\s/>]/.test(c.railsExample || ""))
        .map((c) => c.rails)
      assert.deepStrictEqual(leaking, [])
    })

    test("attaches kit FAQs where Playbook publishes them", () => {
      const dropdown = findComponentByRailsName(metadata, "dropdown")
      assert.ok(dropdown?.faqs && dropdown.faqs.length > 0)
    })
  })

  suite("Platform-split props", () => {
    test("keeps each platform's enum values and exposes the union", () => {
      const size = findComponentByRailsName(metadata, "avatar")!.props.size
      assert.ok(size.valuesByPlatform?.react && size.valuesByPlatform?.rails)

      const react = getPropValues(size, "typescriptreact")!
      const rails = getPropValues(size, "erb")!
      assert.deepStrictEqual(react, size.valuesByPlatform!.react)
      assert.deepStrictEqual(rails, size.valuesByPlatform!.rails)
      for (const value of [...react, ...rails]) {
        assert.ok(size.values!.includes(value), `union should include ${value}`)
      }
    })

    test("falls back to the union when no platform is given", () => {
      const size = findComponentByRailsName(metadata, "avatar")!.props.size
      assert.deepStrictEqual(getPropValues(size), size.values)
    })

    test("returns per-platform types", () => {
      const loading = findComponentByRailsName(metadata, "advanced_table")!.props.loading
      assert.strictEqual(getPropType(loading, "erb"), "boolean")
      assert.ok(getPropType(loading, "typescriptreact").includes("string"))
    })

    test("treats a union containing boolean as a boolean prop", () => {
      const loading = findComponentByRailsName(metadata, "advanced_table")!.props.loading
      assert.ok(isBooleanProp(loading, "erb"))
      assert.ok(isBooleanProp(loading, "typescriptreact"), "boolean | string is still boolean-capable")
    })

    test("does not treat non-boolean types as boolean", () => {
      const prop: PropMetadata = { type: "string" }
      assert.ok(!isBooleanProp(prop, "erb"))
      assert.ok(!isBooleanProp({ type: "booleanish" }, "erb"))
    })

    test("returns per-platform defaults", () => {
      const prop: PropMetadata = {
        type: "string",
        default: "a",
        defaultByPlatform: { react: "a", rails: "b" },
      }
      assert.strictEqual(getPropDefault(prop, "typescriptreact"), "a")
      assert.strictEqual(getPropDefault(prop, "erb"), "b")
      assert.strictEqual(getPropDefault(prop), "a")
    })
  })

  suite("Schema corrections", () => {
    test("does not enforce React's tooltip position values on Rails", () => {
      const position = findComponentByRailsName(metadata, "tooltip")!.props.position
      assert.deepStrictEqual(getPropValues(position, "erb"), [])
    })

    test("keeps React's tooltip position values for React", () => {
      const position = findComponentByRailsName(metadata, "tooltip")!.props.position
      assert.deepStrictEqual(getPropValues(position, "typescriptreact"), ["absolute", "fixed"])
    })
  })

  suite("Deprecations", () => {
    test("marks Rails-deprecated props", () => {
      const flex = findComponentByRailsName(metadata, "flex")!
      assert.ok(getPropDeprecation(flex, "horizontal", "erb"))
    })

    test("does not report a Rails-only deprecation for React files", () => {
      const flex = findComponentByRailsName(metadata, "flex")!
      assert.strictEqual(getPropDeprecation(flex, "horizontal", "typescriptreact"), undefined)
    })

    test("carries the replacement prop when Playbook names one", () => {
      const caption = findComponentByRailsName(metadata, "caption")!
      assert.strictEqual(getPropDeprecation(caption, "variant", "erb")?.replacement, "color")
    })

    test("returns undefined for props that are not deprecated", () => {
      const button = findComponentByRailsName(metadata, "button")!
      assert.strictEqual(getPropDeprecation(button, "text", "erb"), undefined)
    })
  })

  suite("scanRuby", () => {
    test("finds deprecated: true", () => {
      const source = `
        prop :status, type: Playbook::Props::Enum,
                      values: %w[neutral positive negative],
                      default: "neutral",
                      deprecated: true
        prop :text
      `
      assert.deepStrictEqual(scanRuby(source), [{ prop: "status", message: undefined }])
    })

    test("captures a deprecation message", () => {
      const source = `prop :form_system, deprecated: "Playbook only supports form_with", type: Playbook::Props::Base`
      assert.deepStrictEqual(scanRuby(source), [
        { prop: "form_system", message: "Playbook only supports form_with" },
      ])
    })

    test("does not bleed one prop's deprecation onto the next", () => {
      const source = `
        prop :old, deprecated: true

        prop :current
      `
      assert.deepStrictEqual(
        scanRuby(source).map((d) => d.prop),
        ["old"]
      )
    })

    test("ignores props without a deprecated flag", () => {
      assert.deepStrictEqual(scanRuby(`prop :text\nprop :size, default: "md"`), [])
    })
  })

  suite("scanReact", () => {
    test("uses the prop named in the comment, not the one in the condition", () => {
      const source = `if (props.variant) deprecatedProps() //status prop is deprecated, use color instead please`
      assert.deepStrictEqual(scanReact(source), [
        {
          prop: "status",
          message: "status prop is deprecated, use color instead please",
          replacement: "color",
        },
      ])
    })

    test("falls back to the condition's prop with no comment", () => {
      assert.deepStrictEqual(scanReact(`if (props.plugins) deprecatedProps()`), [
        { prop: "plugins", message: undefined, replacement: undefined },
      ])
    })

    test("finds @schemaOmit Deprecated markers above a prop type", () => {
      const source = `
        // @schemaOmit Deprecated. Use \`htmlType\`.
        type?: string,
      `
      assert.deepStrictEqual(scanReact(source), [
        { prop: "type", message: "Use `htmlType`." },
      ])
    })

    test("converts camelCase props to snake_case", () => {
      const source = `if (props.dateFormat) deprecatedProps() //dateFormat prop is deprecated, use format instead`
      const [found] = scanReact(source)
      assert.strictEqual(found.prop, "date_format")
      assert.strictEqual(found.replacement, "format")
    })
  })
})
