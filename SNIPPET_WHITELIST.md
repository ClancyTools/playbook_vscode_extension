# Snippet Whitelist Configuration

## Overview

The snippet system now automatically includes **required props** for all components (based on `required: true` in the Rails `.rb` definition), plus any **optional props** you specify in the whitelist. This ensures snippets always have the props needed for the component to function, while still allowing you to add commonly-used optional props for convenience.

### How It Works

**Required Props (Automatic):**

- Props marked with `required: true` in the Rails `.rb` file are automatically included in **both Rails and React** snippets
- The Ruby definition is the single source of truth - React/TypeScript definitions are NOT checked for required status
- These appear first in the snippet and are always present

**Whitelisted Props (Manual):**

- Optional props you frequently use can be added to the whitelist
- These appear after required props in the snippet
- If a prop is already included as required, it won't be duplicated

## Configuration File

Location: `snippet-whitelist.json`

## Structure

```json
{
  "rails": {
    "component_name": [
      { "name": "prop_name", "placeholder": "default value or null" }
    ]
  },
  "react": {
    "ComponentName": [
      { "name": "prop_name", "placeholder": "default value or null" }
    ]
  }
}
```

## Properties

- **name**: The snake_case prop name as it appears in the component's prop definition
- **placeholder**:
  - If a string: Will be used as the default placeholder value
  - If `null`: Will use the prop's enum values (if available) or let user fill in

## Examples

### Example 1: Component with required props + whitelist

The Link component has `href` marked as `required: true` in Rails, and we add `text` via whitelist:

```json
{
  "rails": {
    "link": [
      { "name": "text", "placeholder": "" }
    ]
  },
  "react": {
    "Link": [
      { "name": "text", "placeholder": "" }
    ]
  }
}
```

Generated snippet (notice `href` comes first as it's required):

**Rails:**

```erb
<%= pb_rails("link", props: {
  href: "$1",
  text: "$2",
  $0
}) %>
```

**React:**

```jsx
<Link href="$1" text="$2" $0/>
```

### Example 2: Component with only optional whitelisted props

To add optional props to a component with no required props:

```json
{
  "rails": {
    "button": [
      { "name": "text", "placeholder": "Click me" },
      { "name": "variant", "placeholder": "" }
    ]
  },
  "react": {
    "Button": [
      { "name": "text", "placeholder": "Click me" },
      { "name": "variant", "placeholder": "" }
    ]
  }
}
```

This will generate:

**Rails:**

```erb
<%= pb_rails("button", props: {
  text: "${1:Click me}",
  variant: "${2|primary,secondary,link|}",
  $0
}) %>
```

**React:**

```jsx
<Button
  text="${1:Click me}"
  variant={${2|"primary","secondary","link"|}}
  $0
/>
```

## Default Behavior

### Components Without Whitelist Entry

Components not in the whitelist will still include any **required props** (marked `required: true` in the Rails definition).

**Example: DatePicker (has `picker_id` required, no whitelist):**

Rails:

```erb
<%= pb_rails("date_picker", props: {
  picker_id: "$1",
  $0
}) %>
```

React:

```jsx
<DatePicker pickerId="$1" $0/>
```

**Example: Avatar (no required props, no whitelist):**

Rails:

```erb
<%= pb_rails("avatar", props: {}) $0%>
```

React:

```jsx
<Avatar $0/>
```

## Regenerating Snippets

After modifying the whitelist, regenerate snippets by running:

```bash
npm run sync
```

## Notes

- **Required props are automatic:** Any prop with `required: true` in the Rails `.rb` file will be included in both Rails and React snippets
- **Rails is the source of truth:** React/TypeScript definitions are NOT checked for required status - only the Rails `.rb` file determines which props are required
- Component names in the whitelist must match exactly:
  - Rails: Use snake_case (e.g., `button`, `text_input`)
  - React: Use PascalCase (e.g., `Button`, `TextInput`)
- Props will only be added if they exist in the component's prop definition
- The order of props in the whitelist determines their tab order (they appear after required props)
- Whitelisted props are ideal for commonly-used optional props that users rarely want to delete
- If a prop is already included as required, it won't be duplicated by the whitelist
