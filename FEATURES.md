# Playbook UI Extension - Feature Guide

## 🎯 Intelligent Autocomplete

### Component Name Completion

Get instant suggestions for all 107 Playbook components as you type.

**Rails/ERB:**

```erb
<%= pb_rails("bu...") %>
             ↑ Press Ctrl+Space to see button, button_toolbar
```

**React:**

```tsx
<Bu... />
 ↑ Press Ctrl+Space to see Button, ButtonToolbar with snippets
```

### Prop Name Completion

Context-aware prop suggestions based on the component you're using.

**Rails/ERB:**

```erb
<%= pb_rails("button", props: { v... }) %>
                                ↑ See variant, vertical_align
```

**React:**

```tsx
<Button v... />
        ↑ See variant, verticalAlign with type hints
```

### Enum Value Completion

Automatic suggestions for enum props with default values prioritized.

**Rails/ERB:**

```erb
<%= pb_rails("button", props: { variant: "..." }) %>
                                          ↑ See primary, secondary, link
```

**React:**

```tsx
<Button variant="..." />
                ↑ See primary, secondary, link with defaults first
```

### Boolean Completion

Quick true/false choices for boolean props.

**React:**

```tsx
<Button disabled={...} />
                  ↑ See true, false
```

---

## 🎯 Hover Documentation

### Component Documentation

Hover over any Playbook component name to see:

- Component description
- Usage examples for Rails and React
- Available props
- Prop types and valid values

**Example:**

```erb
<%= pb_rails("button", props: {}) %>
         ↑ Hover here to see Button docs
```

```tsx
<Button text="Click me" />
  ↑ Hover here to see Button docs
```

### Prop Documentation

Hover over prop names to see:

- Prop type (enum, boolean, string, etc.)
- Valid values for enums
- Default value
- Whether it's required

**Example:**

```erb
<%= pb_rails("button", props: { variant: "primary" }) %>
                                ↑ Hover here to see variant docs
```

```tsx
<Button variant="primary" />
         ↑ Hover here to see variant docs
```

---

## ✅ Prop Validation

The extension validates your Playbook component usage in real-time.

### Unknown Component Warning

```erb
<%= pb_rails("unknown_component", props: {}) %>
              ⚠️ Warning: Unknown Playbook component
```

### Unknown Prop Warning

```erb
<%= pb_rails("button", props: {
  invalid_prop: "value"
  ⚠️ Warning: Unknown prop "invalid_prop" for component "button"
}) %>
```

### Invalid Enum Value Warning

```erb
<%= pb_rails("button", props: {
  variant: "invalid"
  ⚠️ Warning: Invalid value "invalid" for prop "variant"
     Valid values: "primary", "secondary", "link", "danger", "reaction"
}) %>
```

**Checking Errors:**

- View → Problems (Cmd+Shift+M / Ctrl+Shift+M)
- Yellow squiggly underlines in editor
- Hover over underlined code for details

---

## 🔗 Go to Definition

Jump directly to Playbook documentation from your code.

### How to Use

**Method 1: Cmd/Ctrl + Click**

- Hold Cmd (Mac) or Ctrl (Windows/Linux)
- Click on any component name
- Opens Playbook docs in browser

**Method 2: F12 or Right-Click**

- Place cursor on component name
- Press F12
- Or right-click → "Go to Definition"

**Example:**

```erb
<%= pb_rails("button", props: {}) %>
         ↑ Cmd+Click to open https://playbook.powerhrg.com/kits/button/react
```

```tsx
<Button text="Click" />
  ↑ F12 to open Button documentation
```

---

## 🚀 Complete Workflow Example

### ERB Example

```erb
<!-- 1. Start typing a snippet -->
pb_button<Tab>

<!-- 2. Snippet expands with IntelliSense -->
<%= pb_rails("button", props: {
  variant: "${1|primary,secondary,link,danger,reaction|}",
  text: "${2}",
  ⬆️ Use Tab to move through fields
}) %>

<!-- 3. Hover over component for docs -->
<%= pb_rails("button", props: {
         ↑ Hover: See Button component documentation
  variant: "primary",
  text: "Click me"
}) %>

<!-- 4. Validation catches errors -->
<%= pb_rails("button", props: {
  invalid: "error"
  ⚠️ Real-time warning appears
}) %>

<!-- 5. Go to definition -->
<%= pb_rails("button", props: {}) %>
         ↑ Cmd+Click to open docs
```

### React/TSX Example

```tsx
// 1. Start typing
pbButton<Tab>

// 2. Snippet expands
<Button
  variant={"primary"}
  ⬆️ IntelliSense shows valid values
  text="${2}"
  $0
/>

// 3. Hover for docs
<Button variant="primary" />
  ↑         ↑
  |         Hover: See variant prop info
  Hover: See Button component docs

// 4. Validation
<Button invalidProp="error" />
        ⚠️ Warning: Unknown prop

// 5. Go to definition
<Button />
  ↑ F12 to view docs
```

---

## 🎨 Tips & Tricks

### Combine with IntelliSense

1. Type snippet prefix
2. Use Tab to navigate through fields
3. Hover on props for valid values
4. Cmd+Click for full documentation

### Quick Error Fixing

1. See warning in Problems panel
2. Hover over error for details
3. Check valid values in hover tooltip
4. Cmd+Click to see full component docs

### Keyboard Shortcuts

- `Tab` - Expand snippet / Next field
- `Shift+Tab` - Previous field
- `Cmd/Ctrl+Click` - Go to definition
- `F12` - Go to definition
- `Cmd/Ctrl+Shift+M` - Toggle Problems panel
- `Cmd/Ctrl+K Cmd/Ctrl+I` - Show hover info

---

## 🔧 Configuration

The extension works automatically with no configuration needed!

**Requirements:**

- Playbook metadata file at `data/playbook.json`
- Generated by running `npm run sync`

**Updating:**

```bash
# When Playbook changes, re-sync
npm run sync

# Recompile extension
npm run compile

# Reload VS Code extension (F5 in dev mode, or restart)
```

---

## 📚 Supported Components

All 107+ Playbook components including:

- Avatar, Badge, Button, Card
- DatePicker, Dropdown, FileUpload
- AdvancedTable, BarGraph, CircleChart
- Flex, Layout, Nav
- TextInput, Select, Checkbox
- ...and many more!

Run `npm run sync` to ensure you have the latest components from Playbook.
