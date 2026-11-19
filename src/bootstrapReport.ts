import { BOOTSTRAP_FAMILIES, BootstrapHit } from "./bootstrapCatalog"

export interface LocatedBootstrap extends BootstrapHit {
  /** Path relative to the workspace. */
  file: string
  line: number
  column: number
}

export interface BootstrapSummary {
  families: Array<{ id: string; label: string; playbook: string; count: number; files: number }>
  files: Array<{ file: string; count: number }>
  folders: Array<{ folder: string; count: number }>
}

/** Up to the first three path segments, e.g. components/accounting/app. */
export function folderOf(file: string): string {
  const parts = file.split("/")
  return parts.slice(0, Math.min(3, Math.max(parts.length - 1, 1))).join("/")
}

const byCountThenName = <T extends { count: number }>(name: (x: T) => string) => (a: T, b: T) =>
  b.count - a.count || name(a).localeCompare(name(b))

export function summarizeBootstrap(results: LocatedBootstrap[]): BootstrapSummary {
  const families = BOOTSTRAP_FAMILIES.map((family) => {
    const hits = results.filter((r) => r.family === family.id)
    return {
      id: family.id,
      label: family.label,
      playbook: family.playbook,
      count: hits.length,
      files: new Set(hits.map((h) => h.file)).size,
    }
  })
    .filter((f) => f.count > 0)
    .sort(byCountThenName((f) => f.label))

  const perFile = new Map<string, number>()
  const perFolder = new Map<string, number>()
  for (const hit of results) {
    perFile.set(hit.file, (perFile.get(hit.file) ?? 0) + 1)
    perFolder.set(folderOf(hit.file), (perFolder.get(folderOf(hit.file)) ?? 0) + 1)
  }
  return {
    families,
    files: [...perFile].map(([file, count]) => ({ file, count })).sort(byCountThenName((f) => f.file)),
    folders: [...perFolder].map(([folder, count]) => ({ folder, count })).sort(byCountThenName((f) => f.folder)),
  }
}

/** A Markdown report of where Bootstrap markup is, to plan a migration from. */
export function buildBootstrapReport(
  results: LocatedBootstrap[],
  scopeLabel: string,
  filesScanned: number,
  topFiles = 30,
  topFolders = 25
): string {
  const summary = summarizeBootstrap(results)
  const lines: string[] = []
  lines.push(`# Bootstrap markup in ${scopeLabel}`)
  lines.push("")
  lines.push(
    `${results.length} class attributes use Bootstrap classes across ${summary.files.length} of ${filesScanned} scanned files. ` +
      "Matching is by class name only, so check the leads: names like `row`, `table` and `card` may belong to the app's own CSS."
  )
  lines.push("")
  lines.push("## By kind")
  lines.push("")
  lines.push("| Bootstrap | Class attributes | Files | Playbook |")
  lines.push("|---|---:|---:|---|")
  for (const f of summary.families) {
    lines.push(`| ${f.label} | ${f.count} | ${f.files} | ${f.playbook} |`)
  }
  lines.push("")
  lines.push(`## Folders with the most (top ${Math.min(topFolders, summary.folders.length)})`)
  lines.push("")
  lines.push("| Folder | Class attributes |")
  lines.push("|---|---:|")
  for (const f of summary.folders.slice(0, topFolders)) {
    lines.push(`| ${f.folder} | ${f.count} |`)
  }
  lines.push("")
  lines.push(`## Files with the most (top ${Math.min(topFiles, summary.files.length)})`)
  lines.push("")
  lines.push("| File | Class attributes |")
  lines.push("|---|---:|")
  for (const f of summary.files.slice(0, topFiles)) {
    lines.push(`| ${f.file} | ${f.count} |`)
  }
  lines.push("")
  return lines.join("\n")
}
