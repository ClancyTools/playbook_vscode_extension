# Changelog

All notable changes to the Playbook UI VS Code extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-01-14

### Added

- **VS Code Marketplace Publication** 🎉
  - Extension now available on VS Code Marketplace
  - Automatic activation when working with Rails or React files
  - Professional icon and gallery presence
  - Comprehensive test suite with 66+ passing tests

### Changed

- Updated to semantic version 1.0.0 for initial marketplace release
- Improved extension activation to be automatic (no command line needed)
- Enhanced documentation for marketplace users

## [0.4.0] - 2026-01-14

### Added

- **Intelligent Autocomplete** 🎯
  - Component name completion for Rails (`pb_rails("...")`)
  - Component name completion for React (`<Component>`)
  - Prop name completion with type hints and valid values
  - Enum value completion with default values prioritized
  - Boolean value completion (true/false)
  - Snippet-based completions with tab stops for quick navigation
  - Context-aware suggestions based on cursor position
  - All 107 Playbook components available in autocomplete

## [0.3.0] - 2026-01-14

### Added

- **Hover Documentation** 🎉
  - Hover over component names to see full documentation
  - Hover over props to see type, valid values, and defaults
  - Works for both Rails/ERB and React components
  - Markdown-formatted docs with usage examples
- **Prop Validation** ✅
  - Real-time diagnostics for unknown components
  - Warnings for invalid prop names
  - Validation of enum values (e.g., variant must be primary|secondary|link)
  - Errors appear in Problems panel and inline
- **Go to Definition** 🔗
  - Cmd/Ctrl+Click on component names
  - F12 to jump to Playbook documentation
  - Opens component docs in browser

### Technical

- Created `src/metadata.ts` - Metadata loading and documentation generation
- Created `src/parser.ts` - Component and prop parsing for Rails and React
- Created `src/hoverProvider.ts` - Hover documentation provider
- Created `src/definitionProvider.ts` - Definition provider for doc links
- Created `src/diagnostics.ts` - Real-time prop validation
- All providers registered in `src/extension.ts`

## [0.2.0] - 2026-01-14

### Added

- **Dynamic snippet generation from Playbook UI repository** 🎉
  - Automatic parsing of all pb_* components from Playbook source code
  - 107+ Rails/ERB snippets generated from actual Ruby component files
  - 107+ React/TSX snippets with proper prop types
  - Sync script (`npm run sync`) to regenerate snippets from latest Playbook code
- **Smart snippet features:**
  - Enum prop values with IntelliSense choices (e.g., `variant: primary|secondary|link`)
  - Boolean props with true/false suggestions
  - Default values pre-filled from component definitions
  - Multi-line prop definition support in parser
  - Automatic detection of block/children components
- `scripts/sync-playbook.ts` - TypeScript script to parse Playbook and generate snippets
- Generated `data/playbook.json` with metadata for all 107 components

### Changed

- Snippets are now auto-generated (no manual editing required)
- Component metadata now reflects actual Playbook source code
- Documentation updated with sync workflow

### Technical

- Added ts-node dependency for running sync script
- Enhanced Ruby prop parser to handle multi-line definitions
- Improved enum value extraction from `%w[]` and array formats

## [0.1.0] - 2026-01-14

### Added

- Initial extension scaffold
- Rails/ERB snippets for common Playbook components:
  - Button, Card, Flex, Body, Title, Avatar, Icon
- React snippets for common Playbook components:
  - Button, Card, Flex, Body, Title, Avatar, Icon, Import
- Component metadata structure in `data/playbook.json`
- Extension activation for Ruby, ERB, JavaScript, JSX, TypeScript, TSX
- Debug configuration for local development
- Comprehensive README with usage and development instructions

### Technical

- TypeScript-based extension using VS Code Extension API
- Static metadata approach (no runtime introspection)
- Snippet contributions registered in `package.json`
- TODO comments for future autocomplete and hover providers
