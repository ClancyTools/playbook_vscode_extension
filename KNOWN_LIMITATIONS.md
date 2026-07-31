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

## 2. `table.schema.json`'s Rails usage example is JSX, not `pb_rails`

`kits/table.schema.json`'s `usage.rails.example` embeds `<Table.Head>` /
`<Table.Row>` JSX inside an `.erb` code block instead of the real
`pb_rails("table/table_row", ...)` nested-helper syntax used in actual Rails
code. This looks like an upstream documentation bug, separate from #1.

**Recheck:**

```bash
grep -A2 '"rails"' node_modules/playbook-ui/dist/ai/kits/table.schema.json | grep -i '<table'
```

If this returns nothing, the example has been fixed to real Rails syntax —
worth checking whether the fix shipped alongside real subcomponent schemas
(see #1).

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
