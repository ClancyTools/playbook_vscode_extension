/**
 * Refreshes the Playbook data bundled with the extension.
 *
 *   npm run sync:data
 *   npm run sync:data -- --from /path/to/playbook-ui/dist/ai --repo /path/to/playbook/playbook
 *
 * 1. Copies Playbook's published AI metadata (`playbook-ui/dist/ai`) into
 *    `data/ai/`. The extension reads the same layout from a workspace's
 *    node_modules when it can, and falls back to this bundled copy.
 * 2. Scans the Playbook source for deprecated props and writes
 *    `data/deprecations.json`. Playbook's published schema carries no
 *    deprecation data, so this is the only place it comes from.
 *
 * Defaults: `--from` is `$PLAYBOOK_AI_DIR` or `<repo>/dist/ai`; `--repo` is
 * `$PLAYBOOK_REPO_PATH` or `../playbook/playbook`.
 */
import * as fs from "fs"
import * as path from "path"
import { scanDeprecations } from "../src/deprecationScan"

const FILES_TO_COPY = [
  "all-schemas.json",
  "index.json",
  "visual-index.json",
  "forms.json",
  "external-dependencies.json",
  "global-props.schema.json",
  "global-event-props.schema.json",
]

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

function main(): void {
  const repo = path.resolve(arg("repo") || process.env.PLAYBOOK_REPO_PATH || "../playbook/playbook")
  const from = path.resolve(
    arg("from") || process.env.PLAYBOOK_AI_DIR || path.join(repo, "dist", "ai")
  )
  const root = path.resolve(__dirname, "..")
  const dest = path.join(root, "data", "ai")

  if (!fs.existsSync(path.join(from, "index.json"))) {
    console.error(`No Playbook AI metadata at ${from}. Run \`yarn build:ai\` in the Playbook repo or pass --from.`)
    process.exit(1)
  }

  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(path.join(dest, "playgrounds"), { recursive: true })
  for (const file of FILES_TO_COPY) {
    fs.copyFileSync(path.join(from, file), path.join(dest, file))
  }
  const playgrounds = fs.readdirSync(path.join(from, "playgrounds")).filter((f) => f.endsWith(".json"))
  for (const file of playgrounds) {
    fs.copyFileSync(path.join(from, "playgrounds", file), path.join(dest, "playgrounds", file))
  }
  const version = JSON.parse(fs.readFileSync(path.join(from, "index.json"), "utf-8")).version
  console.log(`Copied Playbook AI metadata v${version} (${FILES_TO_COPY.length} files + ${playgrounds.length} playgrounds) from ${from}`)

  if (fs.existsSync(path.join(repo, "app", "pb_kits", "playbook"))) {
    const deprecations = scanDeprecations(repo)
    fs.writeFileSync(
      path.join(root, "data", "deprecations.json"),
      JSON.stringify(deprecations, null, 2) + "\n"
    )
    const count = Object.values(deprecations.props).reduce((n, p) => n + Object.keys(p).length, 0)
    console.log(`Found ${count} deprecated props across ${Object.keys(deprecations.props).length} kits in ${repo}`)
  } else {
    console.warn(`Playbook source not found at ${repo}; data/deprecations.json left unchanged`)
  }
}

if (require.main === module) {
  main()
}
