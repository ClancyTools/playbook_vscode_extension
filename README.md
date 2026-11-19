# Playbook UI VS Code Extension

Developer experience enhancements for the [Playbook UI](https://github.com/powerhome/playbook) design system.

## Features

### ✨ Smart Snippets for 150+ Components

**Rails/ERB Components** - Type `pb_<component_name>` and press Tab:

- `pb_button` → Button with variant, size, and prop suggestions
- `pb_card` → Card component with padding and spacing
- `pb_flex` → Flex layout with alignment options
- `pb_avatar` → Avatar component
- `pb_advanced_table` → Advanced Table
- `pb_date_picker` → Date Picker
- ...and 140+ more!

**React Components** - Type `pb<ComponentName>` and press Tab:

- `pbButton` → Button component
- `pbCard` → Card component
- `pbFlex` → Flex layout
- `pbAvatar` → Avatar component
- `pbAdvancedTable` → Advanced Table
- `pbDatePicker` → Date Picker
- `pbImport` → Import statement for any component
- ...and 140+ more!

### 📚 Hover Documentation

**Inline documentation as you code**

Hover over any Playbook component or prop to see:

- Component description and usage examples
- Available props with types and valid values
- Default values and required props
- Both Rails and React syntax examples

Works for:

- Component names: `pb_rails("button", ...)` or `<Button />`
- Prop names in both Rails and React syntax
- Global props like padding, margin, display, etc.

### 🎯 Intelligent Autocomplete

**Context-aware suggestions as you type**

Get intelligent autocomplete for:

**Component Names**

- Rails: Type `pb_rails("bu...)` → See button, button_toolbar with descriptions
- React: Type `<Bu...` → See Button, ButtonToolbar with snippets

**Prop Names**

- Rails: Type inside `props: {` → See all available props for that component
- React: Type inside component tags → See component-specific and global props
- Includes 60+ global props: padding, margin, dark, display, position, etc.

**Prop Values**

- Automatic suggestions for enum values
- Default values prioritized first
- Shows all valid options with documentation

**Global Props Available Everywhere:**

- Spacing: padding, margin (with all directional variants)
- Layout: display, position, vertical_align, text_align
- Flexbox: flex_direction, align_items, justify_content
- Styling: dark, shadow, border_radius, cursor
- And 50+ more!

### ⚠️ Real-Time Validation

**Catch errors before you run your code**

Get instant feedback on:

- Unknown component names
- Invalid prop names
- Invalid enum values (e.g., `variant: "invalid"` when only `primary`, `secondary`, `link` are valid)
- Works across single-line and multi-line props

Errors appear as:

- Yellow squiggly underlines in your code
- Problems panel entries with helpful messages
- Suggestions for valid values

### 💡 Quick Fixes

"Did you mean…?" for unknown props (`margin_botom` → `margin_bottom`), invalid values (`"primry"` → `"primary"`), unknown kits, and deprecated props that have a replacement. Press `Cmd/Ctrl+.` on the squiggle.

### ⚡ Presets, Kit Browser & Pixel Hints

- **Presets** — every Playbook playground preset is a completion (`<Dr` → `Dropdown: Create tags`)
- **Kit browser** — *Playbook: Browse Kits* (or the *Playbook Kits* Explorer view): search by name or by what it looks like, then insert an example or preset, copy it, or open the docs
- **Pixel hints** — `padding="md"` shows `24px`
- **Flex axis hints** — `justify="center"` shows `↔ center` in a row and `↕ middle` in a column, so you never have to remember which of `justify`/`align` is horizontal

### 🎨 Colors and Icons

- **Color swatches** — a small square with the real color after a Playbook color token (`background="bg_light"`) and after the `color` of Icon, Legend, Body, Caption, Title, Detail, Link and Overlay, Card `background` and Card header `header_color`. Names like `light` or `link` show that kit's own color, not the same-named token. A hover showing the token and its value. An Icon or Legend color, or a Card header `header_color`, that Playbook doesn't define (`color="secondary"` on an Icon) is flagged, since no color is applied.
- **Color completion** — color props complete with the names they accept, each shown with its color (`background="` on a Card lists the product and status colors; `color="` on an Icon or Legend lists the kit's colors, which the schema doesn't enumerate). With `playbook.colorSwatches` off the names stay but the colors are hidden.
- **Icons** — icon props complete from `@powerhome/playbook-icons` (with a preview of the highlighted icon), hover shows the icon, its category and alias, and a typo gets a "did you mean". The icon set is private, so nothing from it is bundled: it is read from the workspace's installed package, or from `playbook.icons.path` (for example a checkout of the repo). Names with no close match are never flagged, since the Icon kit falls back to Font Awesome.

### 🧹 Tidying Props

- **Combine paired spacing** — `paddingTop="sm" paddingBottom="sm"` → `paddingY="sm"` (and left/right, and margins), with a quick fix and *Combine all in this file*.
- **Required indicator** — a label ending in a hand-written `*` on a Playbook input (`label: "Name *"`) gets a quick fix that removes it and adds `required_indicator: true`.
- **Flex migration** — the deprecated Flex `horizontal`, `vertical` and `spacing` are rewritten to the right `justify`/`align` for the orientation.

### ⚠️ Deprecations

Deprecated props are struck through with the replacement named. *Playbook: Find Deprecated Usages* lists every one in the workspace.

### 🔎 Sweeps and References

- **Find Deprecated Usages** and **Find Bootstrap Markup** ask what to scan (this file, its folder, a folder you pick, or the whole workspace), or take a path: right-click a folder in the Explorer, or run the command with an argument.
- **Find Bootstrap Markup** matches Bootstrap classes (`btn btn-primary`, `panel`, `col-md-6`, …) to the Playbook kit that replaces them and opens a summary report by kind, folder and file.
- **Show Global Props** opens the complete global props reference, grouped and alphabetized, with every value shown. The kit hover lists the same props compactly.

### 🔄 Always the Right Version

The extension reads the newest `playbook-ui` installed in your workspace (monorepo `components/*` too). The status bar shows which version it is using, or "bundled" if none was found.

### Turning features off

Everything is on by default and every feature can be switched off, so you can keep just the parts you want. Set `playbook.enabled` to `false` to turn them all off at once, or switch off individual features in `settings.json`:

```jsonc
{
  "playbook.hover.enabled": false,             // all hovers
  "playbook.hover.kitGuidance": false,         //   just Playbook's notes in them (gotchas, presets, FAQs, …)
  "playbook.hover.globalProps": false,         //   just the global props list in a kit hover
  "playbook.hover.valuePreviews": false,       //   just the color / icon value previews
  "playbook.completion.enabled": false,        // all completions
  "playbook.completion.presets": false,        //   just the presets
  "playbook.completion.icons": false,          //   just icon names
  "playbook.diagnostics.enabled": false,       // every warning, hint and info
  "playbook.diagnostics.validation": false,    //   just the core checks (unknown kits/props, invalid values, …)
  "playbook.diagnostics.propOrder": false,     //   just the alphabetical prop order warning
  "playbook.quickFixes.enabled": false,
  "playbook.flexAxis.enabled": false,          // axis hints, hover, completion detail and the migration
  "playbook.spacingHints": false,
  "playbook.axisHints": false,
  "playbook.colorSwatches": false,
  "playbook.definition.enabled": false,
  "playbook.statusBar.enabled": false,
  "playbook.kitBrowser.enabled": false         // the Explorer view (the command stays available)
}
```

Each individual diagnostic (deprecations, prop dependencies, required indicator, unknown icons and colors, combine spacing, missing packages, Bootstrap) has its own `playbook.diagnostics.*` switch too. Snippets come from VS Code's own snippet system and stay available either way.

### Settings

| Setting | Default | |
|---|---|---|
| `playbook.spacingHints` | `true` | Pixel values after spacing tokens |
| `playbook.axisHints` | `true` | Which way `justify`/`align` values point |
| `playbook.colorSwatches` | `true` | A square with the real color after color tokens and Icon/Legend colors (turn off to hide) |
| `playbook.diagnostics.unknownColors` | `true` | Flag an Icon/Legend color Playbook doesn't define |
| `playbook.icons.path` | _empty_ | Folder with `icons/` and `aliases.json`, e.g. a checkout of playbook-icons |
| `playbook.icons.previewColor` | _empty_ | Color of icon previews in hovers (empty follows the theme) |
| `playbook.diagnostics.unknownIcons` | `true` | Flag icon names that look like a typo |
| `playbook.diagnostics.combineSpacing` | `true` | Hint when `paddingTop`+`paddingBottom` can be `paddingY` |
| `playbook.diagnostics.requiredIndicator` | `true` | Suggest `required_indicator` instead of a `*` in a label |
| `playbook.diagnostics.bootstrap` | `false` | Hint on Bootstrap classes with the Playbook equivalent |
| `playbook.diagnostics.deprecations` | `true` | Flag deprecated props |
| `playbook.diagnostics.propDependencies` | `true` | Flag props that do nothing without another |
| `playbook.diagnostics.externalDependencies` | `true` | Flag kits whose Highcharts/maplibre-gl isn't installed |

## Installation

### From VS Code Marketplace

1. Open VS Code
2. Press `Cmd+Shift+X` (Mac) or `Ctrl+Shift+X` (Windows/Linux)
3. Search for **"Playbook UI Helper"**
4. Click **Install**

### From Cursor Marketplace

1. Open Cursor
2. Press `Cmd+Shift+X` (Mac) or `Ctrl+Shift+X` (Windows/Linux)
3. Search for **"Playbook UI Helper"**
4. Click **Install**

### Auto-Activation

The extension automatically activates when you open:

- Ruby files (`.rb`)
- ERB files (`.erb`, `.html.erb`)
- JavaScript React (`.jsx`)
- TypeScript React (`.tsx`)

## Quick Start

### Rails/ERB Example

```erb
<!-- Type 'pb_button' and press Tab -->
<%= pb_rails("button", props: {
  text: "Click Me",
  variant: "primary",    <!-- Autocomplete shows: primary, secondary, link -->
  size: "md"             <!-- Autocomplete shows: sm, md, lg -->
}) %>
```

### React/JSX Example

```jsx
// Type 'pbButton' and press Tab
<Button
  text="Click Me"
  variant="primary"      // Autocomplete shows valid variants
  size="md"             // Autocomplete shows valid sizes
/>
```

### Using Autocomplete

1. **Start typing** a component name or prop
2. **Press Ctrl+Space** to trigger suggestions (or they appear automatically)
3. **Use arrow keys** to navigate options
4. **Press Enter or Tab** to insert

### Viewing Documentation

1. **Hover** over any component or prop name
2. **Read the popup** showing types, values, and examples
3. **Cmd/Ctrl+Click** to open full docs in browser

## Supported Languages

- Ruby (`.rb`)
- ERB (`.erb`, `.html.erb`)
- JavaScript React (`.jsx`)
- TypeScript React (`.tsx`)

## Links

- [Playbook UI Documentation](https://playbook.powerhrg.com/)
- [GitHub Repository](https://github.com/ClancyTools/playbook_vscode_extension)
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=clancytools.playbook-vscode)
- [Report an Issue](https://github.com/ClancyTools/playbook_vscode_extension/issues)

## Support

For questions or issues:

- [GitHub Issues](https://github.com/ClancyTools/playbook_vscode_extension/issues)

## License

MIT License - See [LICENSE](LICENSE) for details
