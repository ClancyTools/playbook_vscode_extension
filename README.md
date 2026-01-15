# Playbook UI VS Code Extension

Developer experience enhancements for the [Playbook UI](https://github.com/powerhome/playbook) design system.

## Installation

### From VS Code Marketplace

1. Open VS Code
2. Press `Cmd+Shift+X` (Mac) or `Ctrl+Shift+X` (Windows/Linux) to open Extensions
3. Search for "Playbook UI Helper"
4. Click "Install"

**OR**

Install from the command line:

```bash
code --install-extension clancytools.playbook-vscode
```

The extension will automatically activate when you open files with these languages:

- Ruby (`.rb`)
- ERB (`.erb`, `.html.erb`)
- JavaScript React (`.jsx`)
- TypeScript React (`.tsx`)

## Overview

Playbook UI is an open-source design system built and maintained internally, used primarily in our Ruby on Rails monolith for both Rails views (ERB/Ruby) and React components (JSX/TSX). This VS Code extension improves the authoring experience by providing intelligent snippets, autocomplete, and documentation.

## Features

### ✅ Implemented

#### Dynamic Snippets (107 Components!)

**Automatically generated from the Playbook UI repository**

The extension now syncs with the actual Playbook UI codebase and generates snippets for all 107+ components, including:

**Rails/ERB** - All components available with `pb_<component_name>` prefix:

- `pb_button` → Button with variant, size, and prop suggestions
- `pb_card` → Card component
- `pb_flex` → Flex layout
- `pb_avatar` → Avatar component
- `pb_advanced_table` → Advanced Table
- `pb_date_picker` → Date Picker
- ...and 100+ more!

**React (JSX/TSX)** - All components available with `pb<ComponentName>` prefix:

- `pbButton` → Button component
- `pbCard` → Card component
- `pbFlex` → Flex layout
- `pbAvatar` → Avatar component
- `pbAdvancedTable` → Advanced Table
- `pbDatePicker` → Date Picker
- `pbImport` → Import statement
- ...and 100+ more!

**Smart Features:**

- ✅ Enum prop values with IntelliSense (e.g., `variant: primary|secondary|link`)
- ✅ Boolean props with true/false suggestions
- ✅ Default values pre-filled when available
- ✅ Automatic detection of block/children components
- ✅ Tab stops for easy navigation

All snippets are **automatically updated** when you run `npm run sync` to match the latest Playbook UI repository.

#### Hover Documentation

**Intelligent inline documentation**

Hover over any Playbook component or prop to see:

- Component description and usage examples
- Available props with types and valid values
- Default values and required props
- Both Rails and React syntax examples

Works for:

- Component names in `pb_rails("button", ...)` calls
- React component tags `<Button />`
- Prop names in both Rails and React

#### Intelligent Autocomplete

**Context-aware suggestions as you type**

Get intelligent autocomplete for:

- **Component Names**: All 107 Playbook components with documentation
  - Rails: Type `pb_rails("bu...`)` → See button, button_toolbar
  - React: Type `<Bu...` → See Button, ButtonToolbar with snippets
- **Prop Names**: Context-aware props based on the component
  - Rails: Type `variant: ...` inside props → See valid values
  - React: Type `variant=...` → See enum choices with defaults first
- **Enum Values**: Automatic suggestions with default values prioritized
- **Boolean Values**: Quick true/false completion

Autocomplete triggers:

- Component names: After `pb_rails("` or `<`
- Prop names: After `:` in Rails or inside component tags in React
- Prop values: After `=` or `"`

#### Prop Validation

**Real-time error detection**

Get instant feedback on:

- Unknown component names
- Invalid prop names
- Invalid enum values (e.g., using `variant: "invalid"` when only `primary|secondary|link` are valid)
- Type mismatches

Errors appear as warnings in VS Code's Problems panel and inline squiggly underlines.

#### Go to Definition

**Jump to documentation**

- Cmd+Click (Mac) or Ctrl+Click (Windows) on any component name
- Or use F12 / "Go to Definition"
- Opens Playbook documentation in your browser

## Supported Languages

- Ruby (`.rb`)
- ERB (`.erb`)
- JavaScript React (`.jsx`)
- TypeScript React (`.tsx`)

## Quick Start

Once installed, the extension works automatically:

1. **Open a Rails view** (`.erb` file) or **React component** (`.jsx`/`.tsx` file)
2. **Type a snippet prefix**:
   - Rails: `pb_button` then press Tab
   - React: `pbButton` then press Tab
3. **Hover over components** to see documentation
4. **Cmd/Ctrl+Click** on component names to open docs
5. **Get autocomplete** suggestions as you type

That's it! No configuration needed.

## License

MIT - See [LICENSE](LICENSE) file for details

## Links

- [GitHub Repository](https://github.com/mclancy96/playbook_vscode_extension)
- [Issue Tracker](https://github.com/mclancy96/playbook_vscode_extension/issues)
- [Playbook UI Documentation](https://playbook.powerhrg.com/)
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=clancytools.playbook-vscode)

## Support

For issues or questions:

- [GitHub Issues](https://github.com/mclancy96/playbook_vscode_extension/issues)
- Internal Slack: #playbook-ui
