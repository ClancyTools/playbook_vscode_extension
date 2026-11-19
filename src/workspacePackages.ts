import * as fs from "fs"
import * as path from "path"

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]

/**
 * Builds a predicate that says whether an npm package is available to the file
 * at `fromFile`: installed in a node_modules above it, or declared in a
 * package.json above it (monorepo components declare their own).
 *
 * Returns undefined when no package.json exists above the file, so callers can
 * skip checks in repos that aren't JavaScript projects at all.
 */
export function packageAvailability(
  fromFile: string
): ((pkg: string) => boolean) | undefined {
  const directories: string[] = []
  let dir = path.dirname(fromFile)
  for (;;) {
    directories.push(dir)
    const parent = path.dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }

  const declared = new Set<string>()
  let foundManifest = false
  for (const directory of directories) {
    const manifest = path.join(directory, "package.json")
    if (!fs.existsSync(manifest)) {
      continue
    }
    foundManifest = true
    try {
      const json = JSON.parse(fs.readFileSync(manifest, "utf-8"))
      for (const field of DEPENDENCY_FIELDS) {
        Object.keys(json[field] || {}).forEach((name) => declared.add(name))
      }
    } catch {
      // An unreadable manifest just contributes nothing.
    }
  }
  if (!foundManifest) {
    return undefined
  }

  return (pkg: string) =>
    declared.has(pkg) ||
    directories.some((directory) =>
      fs.existsSync(path.join(directory, "node_modules", pkg, "package.json"))
    )
}
