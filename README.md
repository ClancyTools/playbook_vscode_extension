# Playbook UI VS Code Extension

Developer experience enhancements for the [Playbook UI](https://github.com/powerhome/playbook) design system.

## Installation

### From VS Code Marketplace

1. Open VS Code
2. Press `Cmd+Shift+X` (Mac) or `Ctrl+Shift+X` (Windows/Linux) to open Extensions
3. Search for "Playbook UI"
4. Click "Install"

**OR**

Install from the command line:

```bash
code --install-extension mclancy96.playbook-vscode
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

## Development & Contributing

### Prerequisites

- Node.js 18.x or higher
- VS Code 1.75.0 or higher

### Local Development

1. **Clone and install:**

   ```bash
   cd playbook_extension
   npm install
   ```

2. **Compile TypeScript:**

   ```bash
   npm run compile
   ```

   Or watch for changes:

   ```bash
   npm run watch
   ```

3. **Run the extension:**
   - Press `F5` in VS Code to open a new Extension Development Host window
   - Or use the "Run Extension" debug configuration

4. **Test snippets:**
   - Create a `.erb` or `.tsx` file
   - Type a snippet prefix (e.g., `pb_button` or `pbButton`)
   - Press Tab to expand

### Syncing with Playbook UI

The extension generates snippets dynamically from the Playbook UI repository. To update snippets with the latest components:

1. **Ensure Playbook repo is cloned:**

   ```bash
   # The sync script expects the Playbook repo at:
   # ../playbook/playbook/app/pb_kits/playbook

   # Or set a custom path:
   export PLAYBOOK_REPO_PATH="/path/to/playbook/playbook/app/pb_kits/playbook"
   ```

2. **Run the sync command:**

   ```bash
   npm run sync
   ```

This will:

- Scan all pb_* directories in the Playbook repo
- Parse Ruby component files to extract props and metadata
- Generate snippets for both Rails/ERB and React
- Update `data/playbook.json` with component metadata
- Create 107+ snippets automatically!

**When to sync:**

- After pulling latest changes from Playbook UI
- When new components are added to Playbook
- When component props change

The sync process is safe and can be run anytime. Generated files can be committed to version control.

## Architecture

### Directory Structure

```
playbook_extension/
├── src/
│   └── extension.ts        # Extension entry point
├── scripts/
│   └── sync-playbook.ts    # Sync script to generate snippets from Playbook repo
├── snippets/
│   ├── rails.json          # Generated Rails/ERB snippets (107+ components)
│   └── react.json          # Generated React snippets (107+ components)
├── data/
│   └── playbook.json       # Generated component metadata
├── .vscode/
│   └── launch.json         # Debug configuration
├── package.json            # Extension manifest
├── tsconfig.json           # TypeScript configuration
└── README.md
```

### Design Principles

1. **Dynamic generation from source**: Snippets auto-generated from Playbook repo Ruby files
2. **Incremental development**: Snippets first, then autocomplete and hover
3. **Simplicity**: Minimal dependencies, straightforward implementation
4. **Maintainability**: Clear code structure, extensive TODO comments for future work

## Extending the Extension

### Adding New Snippets

Edit `snippets/rails.json` or `snippets/react.json`:

```json
{
  "snippet_name": {
    "prefix": "trigger_text",
    "body": [
      "line 1 with ${1:placeholder}",
      "line 2 with ${2|option1,option2|}"
    ],
    "description": "What this snippet does"
  }
}
```

### Adding Component Metadata

Edit `data/playbook.json` to add or update component definitions:

```json
{
  "components": {
    "YourComponent": {
      "rails": "your_component",
      "react": "YourComponent",
      "description": "Component description",
      "category": "layout|typography|actions|content",
      "props": {
        "propName": {
          "type": "string|enum|boolean|number|function",
          "description": "Prop description",
          "required": true,
          "default": "defaultValue"
        }
      }
    }
  }
}
```

This metadata will be used for future autocomplete and hover features.

## Contributing

### Before You Start

- Familiarize yourself with the [VS Code Extension API](https://code.visualstudio.com/api)
- Review `src/extension.ts` for TODO comments marking planned features
- Check `data/playbook.json` for the component metadata schema

### Development Workflow

1. Make changes to source files
2. Run `npm run compile` (or keep `npm run watch` running)
3. Press F5 to test in Extension Development Host
4. Iterate and test thoroughly

## Roadmap

### Phase 1: Snippets ✅

- [x] Rails/ERB snippets
- [x] React snippets
- [x] Component metadata structure

### Phase 2: Autocomplete (Next)

- [ ] Component name completion for `pb_rails("...")`
- [ ] Component name completion for `<Component`
- [ ] Prop name completion
- [ ] Prop value completion for enums

### Phase 3: Documentation

- [ ] Hover provider for components
- [ ] Hover provider for props
- [ ] Link to Playbook docs

### Phase 4: Validation

- [ ] Diagnostic warnings for invalid props
- [ ] Required prop validation

## License

MIT - See [LICENSE](LICENSE) file for details

## Links

- [GitHub Repository](https://github.com/mclancy96/playbook_vscode_extension)
- [Issue Tracker](https://github.com/mclancy96/playbook_vscode_extension/issues)
- [Playbook UI Documentation](https://playbook.powerhrg.com/)
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=mclancy96.playbook-vscode)

## Support

For issues or questions:

- [GitHub Issues](https://github.com/mclancy96/playbook_vscode_extension/issues)
- Internal Slack: #playbook-ui
