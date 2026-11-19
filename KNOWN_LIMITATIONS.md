# Known Limitations

Gaps in this extension that are blocked on Playbook's shared metadata
(`node_modules/playbook-ui/dist/ai/`), not on this codebase. Each entry lists
the concrete check to re-run — if the check's answer changes, the limitation
may be fixable here.

Last audited: 2026-07-31, against `playbook-ui`'s `dist/ai/` output as
installed in nitro-web.

## 1. Subcomponent props aren't validated

`pb_rails("table/table_row", ...)`, `<Dialog.Header>`, etc. are recognized as
valid (see `findRailsSubcomponent`/`findReactSubcomponent` in
`src/metadata.ts`), but their own props (e.g. `table_row`'s `sideHighlightColor`,
`collapsible`, `dragId`) are never checked. Diagnostics deliberately skip prop
validation for subcomponents rather than validate against the *parent* kit's
schema, which would produce a different set of false positives.

**Why:** Playbook's `dist/ai` doesn't publish a schema for the subcomponent
itself — no props, no Rails name, nothing — anywhere in `index.json`,
`all-schemas.json`, or `kits/*.schema.json`. The only place subcomponents
appear at all is inside `playgrounds/<kit>.json`'s
`structureModes.modes.subcomponents.template`, and that's a plain JSX string
(`<Table.Head>`), not structured data.

**Recheck:**

```bash
# Does any kit schema now define its own subcomponents with props?
grep -l 'subComponents\|"table_row"\|"dialog_header"' \
  node_modules/playbook-ui/dist/ai/kits/*.schema.json \
  node_modules/playbook-ui/dist/ai/index.json
```

If this starts returning hits, add real prop validation for subcomponents in
`diagnostics.ts` (replace the "skip validation" branch) and extend
`ComponentMetadata`/`transformSchema` in `metadata.ts` to carry the
subcomponent's own prop list.

## 2. 15 of 108 kits' Rails usage examples are JSX, not `pb_rails`

Not just `table` — as of this audit, 15 of 108 kits in `all-schemas.json`
have a `usage.rails.example` that embeds raw JSX children (e.g.
`<Caption text="A" />`, `<Table.Row>`, `<NavItem link="#" text="Photos" />`)
inside the `.erb` code block, instead of the real nested `pb_rails(...)`
syntax actual Rails code would use. Affected kits: `bread_crumbs`,
`button_toolbar`, `flex`, `form_group`, `full_screen`, `layout`, `list`,
`nav`, `overlay`, `progress_step`, `radio`, `selectable_card`,
`selectable_list`, `table`, `timeline`. All of them are container-style kits
whose example has nested children — the leak looks specific to however
Playbook's doc generator renders a kit's *children* into the Rails example,
not something specific to `table`.

Since `generateComponentDocs` shows a kit's real `railsExample` verbatim
(see CHANGELOG "Real Usage Examples in Hover Docs"), hovering any of these
15 kits currently shows broken/misleading Rails code. This extension
intentionally does not paper over it with a heuristic filter — the example
data itself should be corrected upstream so every consumer of the schema
(not just this extension) gets the fix.

**Why:** upstream schema/doc-generation bug in Playbook, not this codebase.

**Recheck:**

```bash
# Flags any kit whose rails example contains a bare <Uppercase...> tag —
# real ERB never has one (Rails helpers are invoked through <%= %>).
node -e '
  const data = require("./data/all-schemas.json");
  for (const [name, kit] of Object.entries(data.kits || {})) {
    if (name.startsWith("$")) continue;
    const ex = kit.usage?.rails?.example || "";
    if (/<[A-Z][\w.]*[\s/>]/.test(ex)) console.log(name);
  }
'
```

Run the same check against `node_modules/playbook-ui/dist/ai/all-schemas.json`
in a consuming app for the live (non-bundled) schema. If either returns
nothing, the leak has been fixed upstream.

## 3. No authoritative list of subcomponent names to offer as completions

Real Rails subcomponent names don't follow one consistent pattern relative to
their kit name — `table/table_row`, `advanced_table/table_row` (not
`advanced_table_table_row`), `layout/header` (no prefix at all), `flex/flex_item`.
Because there's no formula, `completionProvider.ts` doesn't attempt to
autocomplete subcomponent names — guessing would insert wrong syntax.

**Recheck:** same as #1 — a real per-kit subcomponent list (with each
subcomponent's actual Rails name) would let completions offer real options
instead of guessing.

## 4. `PropMetadata.required` is always `undefined`

The `required` field exists on the `PropMetadata` type and is rendered in
hover docs (`generatePropDocs`) and snippet generation, but no kit in the
current schema ever sets it — it's effectively dead data right now.

**Recheck:**

```bash
grep -l '"required"' node_modules/playbook-ui/dist/ai/kits/*.schema.json
```

If this returns hits, verify `transformSchema` in `metadata.ts` actually reads
`propData.required` (it currently doesn't — only `type`, `values`, `default`,
`platforms` are copied) and wire it through.

## 5. `playgrounds/*.json` and `visual-index.json` are unused

These carry presets, hints, and structure-mode templates (including the only
subcomponent JSX examples that exist upstream — see #1) plus a
screenshot-to-kit index. They matter more for AI codegen agents (per
`nitro-web/.agents/rules/playbook-ui.mdc`) than for this hover/completion/
diagnostics extension, so they're intentionally not loaded. Revisit only if
this extension grows a codegen-style feature (e.g. "insert a preset").
