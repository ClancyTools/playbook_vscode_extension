# Known Limitations

Gaps in this extension, mostly blocked on Playbook's shared metadata
(`node_modules/playbook-ui/dist/ai/`) rather than on this codebase. Each entry
lists the concrete check to re-run — if the check's answer changes, the
limitation may be fixable here.

Last audited: 2026-11-18, against `playbook-ui`'s `dist/ai/` built from the
Playbook repo (18.3.0 + unreleased) and as installed in nitro-web
(18.4.0-rc.4).

## Resolved since the last audit (2026-07-31)

- **JSX leaking into Rails usage examples** — 15 of 108 kits had a
  `usage.rails.example` containing raw JSX. Now 0 of 109. The recheck is kept
  below (#8) as a regression guard.
- **`playgrounds/*.json` and `visual-index.json` were unused** — they now drive
  preset completions, gotchas/"often confused with" hover notes, prop
  dependency checks, and the kit browser.
- **The workspace's `playbook-ui` could silently be ignored** — Playbook's
  schema now splits `type`/`values`/`default` per platform
  (`{ "react": ..., "rails": ... }`); the old loader threw on those and quietly
  fell back to the bundled copy. Both are handled, and the status bar shows
  which source is in use.

## 1. Subcomponent props aren't validated

`pb_rails("table/table_row", ...)`, `<Dialog.Header>`, etc. are recognized as
valid (see `findRailsSubcomponent`/`findReactSubcomponent` in
`src/metadata.ts`), but their own props (e.g. `table_row`'s `sideHighlightColor`,
`collapsible`, `dragId`) are never checked. Diagnostics deliberately skip prop
validation for subcomponents rather than validate against the *parent* kit's
schema, which would produce a different set of false positives.

**Why:** Playbook's `dist/ai` doesn't publish a schema for the subcomponent
itself — no props, no Rails name. The only place subcomponents appear is
`playgrounds/<kit>.json` → `structureModes.modes.subcomponents.template`, and
only for 4 kits (`collapsible`, `dialog`, `dropdown`, `table`), as a plain JSX
string (`<Table.Head>`), not structured data.

**Recheck:**

```bash
grep -l 'subComponents\|"table_row"\|"dialog_header"' \
  node_modules/playbook-ui/dist/ai/all-schemas.json \
  node_modules/playbook-ui/dist/ai/index.json
```

If this returns hits, add real prop validation for subcomponents in
`usageRules.ts`/`diagnostics.ts` and carry the subcomponent's own prop list
through `transformSchema` in `metadata.ts`.

## 2. No authoritative list of subcomponent names to offer as completions

Real Rails subcomponent names don't follow one consistent pattern relative to
their kit name — `table/table_row`, `advanced_table/table_row` (not
`advanced_table_table_row`), `layout/header` (no prefix at all), `flex/flex_item`.
Because there's no formula, `completionProvider.ts` doesn't attempt to
autocomplete subcomponent names — guessing would insert wrong syntax.

**Recheck:** same as #1 — a real per-kit subcomponent list would let
completions offer real options instead of guessing.

## 3. `PropMetadata.required` is always `undefined`

The `required` field exists on the `PropMetadata` type and is rendered in
hover docs (`generatePropDocs`) and snippet generation, but no kit in the
current schema ever sets it — it's effectively dead data.

**Recheck:**

```bash
node -e 'const d=require("./data/ai/all-schemas.json");
  console.log(Object.values(d.kits).flatMap(k=>Object.values(k.props)).filter(p=>p.required!==undefined).length)'
```

If this is non-zero, `transformProp` in `metadata.ts` already copies `type`,
`values`, `default`, `platforms`, `description`, `example`, `responsive` and
`properties`; add `required` to that list.

## 4. Playground "requires" rules aren't all real constraints

Playbook's `playgrounds/<kit>.json` → `conditionals.<prop>.requires` says when a
control is *shown in the docs playground*. Some are real behaviour (Link
`target` is ignored without `href`; Dropdown `formPillProps` needs
`multiSelect`), others are playground layout hints (Flex `horizontal` "needs"
`vertical`; Button `iconRight` "needs" `icon` — it doesn't). Run against
nitro-web, the unfiltered data produced ~800 false positives.

So the "has no effect unless…" diagnostic is limited to
`VETTED_DEPENDENCIES` in `src/usageRules.ts` — rules confirmed in Playbook's
source. The rest are shown only as a "Used together with…" hover note. A test
fails if a vetted rule disappears from the synced data.

**To widen it:** find where the kit reads the prop, confirm it's ignored without
the other, and add `"<rails_kit>.<camelProp>"`. A machine-readable "this prop
is inert without that one" flag upstream would replace the list.

## 5. Schema values that are wrong for one platform

`SCHEMA_CORRECTIONS` in `src/metadata.ts` removes enum values that Playbook's
schema publishes for both platforms but that only fit one. Currently:

- `tooltip.position` — React's value is the CSS strategy (`absolute`/`fixed`);
  Rails passes it through as the placement (`"top"`, `"bottom"`, …). Without the
  correction every Rails tooltip is flagged.

**Recheck:** `node -e 'console.log(require("./data/ai/all-schemas.json").kits.tooltip.props.position)'`
— if `values` becomes a `{ react, rails }` split, delete the entry.

## 6. Form-builder-level props come from an unreliable extraction

Builder method *names*, kits and docs come from Playbook's own contract
(`forms.json`). But props that the builder accepts beyond its kit's props
(`label` on `check_box`, `input_options`, `validation_message`, …) are not in
that contract. They still come from `data/form-builders.json`, which
`scripts/extract-form-builders.ts` built by regex over Ruby source — and which
turned out to be keyed by *file* names (`checkbox_field.rb` defines `check_box`)
and to include props that don't belong (`variant` on a checkbox). Extra props
there only make validation more lenient, never stricter.

**Fix:** have `forms.json` list each method's builder-level props, then delete
`form-builders.json` and the extraction script.

## 7. Playbook's deprecations aren't in the published schema

`dist/ai` carries a kit-level `status` (everything is `stable`) but nothing for
deprecated *props* — Playbook only records those in Ruby (`prop :x, deprecated:
true`) and React comments. The extension's deprecated-prop warnings, quick
fixes and "Find Deprecated Usages" therefore read `data/deprecations.json`,
generated by `npm run sync:data` from a Playbook checkout
(`PLAYBOOK_REPO_PATH`). If the extension is synced without a checkout, that
file is left as it was.

**Recheck:** `grep -il deprecat node_modules/playbook-ui/dist/ai/kits/*.json`
— if the schema starts carrying it, read it in `transformProp` and drop the
source scan.

## 8. Regression guard: JSX in Rails examples

This was fixed upstream (see "Resolved"). If it comes back, hover docs for the
affected kits will show broken Rails code:

```bash
node -e '
  const data = require("./data/ai/all-schemas.json");
  for (const [name, kit] of Object.entries(data.kits || {})) {
    if (name.startsWith("$")) continue;
    const ex = kit.usage?.rails?.example || "";
    if (/<[A-Z][\w.]*[\s/>]/.test(ex)) console.log(name);
  }
'
```

Any output means the leak is back — it needs fixing upstream, not papering over
with a filter here.

## 9. Icons: the Font Awesome fallback can't be checked

The Icon kit resolves a name to a custom SVG from `@powerhome/playbook-icons` when one exists and otherwise falls back to a Font Awesome class. The extension can enumerate the first set but not Font Awesome, so an icon name that isn't in playbook-icons may still be valid. Unknown names are therefore only flagged when they have a close match (a probable typo).

The playbook-icons package is private, so its icons are never bundled; icon completions, previews and checks need it on disk (installed in the workspace, or `playbook.icons.path`). **Fix:** if Font Awesome's icon list is made available alongside the icons, validate against both and flag any name missing from both.

## 10. Color swatches only cover color props we can verify

Token names are matched to colors only on props whose name says color or background *and* whose values are mostly token names. Semantic values (`Body color="default"`, `Pill variant="primary"`) mean something kit-specific that isn't the same-named token, so they get no swatch rather than a wrong one. Icon and Legend `color` are the exception: they have no enum, so their names are derived from the kit's SCSS (`npm run sync:data`) and checked exactly. Other kits with an untyped color prop would need the same. **Fix:** a token reference per prop value in Playbook's metadata would let every color prop show a swatch without per-kit extraction.

## 11. Bootstrap detection is by class name

`row`, `table`, `card` and similar names are also used by apps' own CSS, so *Find Bootstrap Markup* results are leads to review. It reads `class=`, `className=` and `class:` strings; classes assembled at runtime (`<%= %>`, `#{}`, `${}`) are skipped rather than guessed at.

## 12. required_indicator: apps' own input wrappers

A wrapper such as an app's own `InputField` may or may not forward `requiredIndicator`, so a `*` in its label is left alone. **Fix:** list known wrappers that forward it (or read it from their prop types).
