/**
 * Finds Bootstrap classes in markup and names the Playbook kit or prop that
 * replaces them. Pure text scanning, no VS Code dependency.
 *
 * Detection is by class name only. Some names (`row`, `table`, `card`) are also
 * used by apps' own CSS, so results are leads to review, not certainties.
 */

export interface BootstrapFamily {
  id: string
  /** What the classes do in Bootstrap. */
  label: string
  /** The Playbook replacement. */
  playbook: string
  /** Class tokens that belong to this family. */
  matches: RegExp
}

export const BOOTSTRAP_FAMILIES: BootstrapFamily[] = [
  {
    id: "button",
    label: "Buttons (btn, btn-*)",
    playbook: "Button — pb_rails(\"button\") / <Button>",
    matches: /^btn(-(primary|secondary|default|success|info|warning|danger|link|lg|sm|xs|block|outline-[a-z]+))?$/,
  },
  {
    id: "badge",
    label: "Badges and labels (badge, label-*)",
    playbook: "Badge, Pill or LabelPill",
    matches: /^(badge(-[a-z]+)?|label-(default|primary|success|info|warning|danger))$/,
  },
  {
    id: "alert",
    label: "Alerts (alert, alert-*)",
    playbook: "Message (or Toast for transient notices)",
    matches: /^alert(-[a-z]+)?$/,
  },
  {
    id: "card",
    label: "Panels and cards (panel-*, card-*)",
    playbook: "Card, with Title and Body inside",
    matches: /^(panel(-(default|primary|success|info|warning|danger|heading|body|footer|title|group))?|card(-(header|body|footer|title|text|group|deck))?)$/,
  },
  {
    id: "grid",
    label: "Grid (row, col-*-N, container)",
    playbook: "Flex with FlexItem, or the Layout kit",
    matches: /^(row|col-(xs|sm|md|lg|xl)-(\d{1,2}|auto)|col-\d{1,2}|container(-fluid)?)$/,
  },
  {
    id: "flex",
    label: "Flex utilities (d-flex, justify-content-*, align-items-*)",
    playbook: "Flex kit, or the justifyContent / alignItems global props",
    matches: /^(d-flex|d-inline-flex|justify-content-(start|end|center|between|around)|align-items-(start|end|center|baseline|stretch)|flex-(row|column|wrap|nowrap|fill))$/,
  },
  {
    id: "form",
    label: "Forms (form-control, form-group, input-group)",
    playbook: "TextInput, Textarea, Select, FormGroup (or pb_form_with)",
    matches: /^(form-(control|group|inline|horizontal|check(-input|-label)?)|input-group(-[a-z]+)?|control-label)$/,
  },
  {
    id: "table",
    label: "Tables (table, table-*)",
    playbook: "Table (or AdvancedTable)",
    matches: /^table(-(striped|bordered|hover|condensed|responsive|sm))?$/,
  },
  {
    id: "text",
    label: "Text utilities (text-muted, text-center, pull-right, …)",
    playbook: "Body, Caption or Title with color; textAlign global prop",
    matches: /^(text-(muted|primary|success|info|warning|danger|center|left|right|uppercase|lowercase|capitalize|nowrap)|pull-(left|right)|font-weight-(bold|normal)|lead|small)$/,
  },
  {
    id: "spacing",
    label: "Spacing utilities (mt-3, px-2, …)",
    playbook: "margin / padding global props (marginTop=\"sm\", paddingX=\"xs\")",
    matches: /^[mp][trblxy]?-([0-5]|auto)$/,
  },
  {
    id: "nav",
    label: "Navigation (nav, navbar, breadcrumb, pagination)",
    playbook: "Nav, BreadCrumbs or Pagination",
    matches: /^(nav(-(tabs|pills|stacked|item|link))?|navbar(-[a-z-]+)?|breadcrumb(-item)?|pagination|page-(item|link))$/,
  },
  {
    id: "progress",
    label: "Progress bars",
    playbook: "ProgressSimple, ProgressPills or ProgressStep",
    matches: /^progress(-bar(-[a-z]+)?)?$/,
  },
  {
    id: "modal",
    label: "Modals",
    playbook: "Dialog",
    matches: /^modal(-(dialog|content|header|body|footer|title|lg|sm))?$/,
  },
  {
    id: "dropdown",
    label: "Dropdowns",
    playbook: "Dropdown",
    matches: /^dropdown(-(menu|toggle|item|divider|header))?$/,
  },
  {
    id: "list",
    label: "List groups",
    playbook: "List and ListItem",
    matches: /^(list-group(-item(-[a-z]+)?)?|list-unstyled|list-inline)$/,
  },
  {
    id: "visibility",
    label: "Visibility (hidden-*, d-none)",
    playbook: "display global prop (with responsive breakpoints)",
    matches: /^((hidden|visible)-(xs|sm|md|lg)(-[a-z]+)?|d-(none|block|inline|inline-block)|invisible)$/,
  },
  {
    id: "icon",
    label: "Icon classes (glyphicon, fa-*)",
    playbook: "Icon (icon=\"name\")",
    matches: /^(glyphicon(-[a-z-]+)?|fa[srbl]?|fa-[a-z0-9-]+)$/,
  },
]

export interface BootstrapHit {
  family: string
  /** The Bootstrap classes of this family found in the attribute. */
  classes: string[]
  /** Offset of the first class of this family. */
  start: number
  end: number
}

/** A `class=` / `className=` / `class:` string and where its text starts. */
const CLASS_ATTRIBUTE = /\b(?:class|className)\s*(?:=|:)\s*(?:\{\s*)?(["'])([^"'\n]*)\1/g

function familyOf(token: string): BootstrapFamily | undefined {
  return BOOTSTRAP_FAMILIES.find((family) => family.matches.test(token))
}

/**
 * Bootstrap classes in the text: one hit per family per class attribute (so
 * `class="btn btn-primary btn-sm"` is a single button hit, not three).
 * Dynamic fragments (`<%= x %>`, `#{x}`, `${x}`) are skipped, not guessed at.
 */
export function scanBootstrap(text: string): BootstrapHit[] {
  const hits: BootstrapHit[] = []
  let attribute: RegExpExecArray | null
  CLASS_ATTRIBUTE.lastIndex = 0

  while ((attribute = CLASS_ATTRIBUTE.exec(text)) !== null) {
    const value = attribute[2]
    const valueStart = attribute.index + attribute[0].lastIndexOf(value)
    const byFamily = new Map<string, BootstrapHit>()

    for (const token of value.matchAll(/\S+/g)) {
      if (/<%|%>|#\{|\$\{|\{\{/.test(token[0])) {
        continue
      }
      const family = familyOf(token[0])
      if (!family) {
        continue
      }
      const start = valueStart + (token.index ?? 0)
      const existing = byFamily.get(family.id)
      if (existing) {
        existing.classes.push(token[0])
        existing.end = start + token[0].length
      } else {
        byFamily.set(family.id, { family: family.id, classes: [token[0]], start, end: start + token[0].length })
      }
    }
    hits.push(...byFamily.values())
  }
  return hits.sort((a, b) => a.start - b.start)
}

export function familyById(id: string): BootstrapFamily | undefined {
  return BOOTSTRAP_FAMILIES.find((f) => f.id === id)
}

/** A Playbook Button variant for a Bootstrap btn-* class set, where there is a clear one. */
export function buttonVariant(classes: string[]): string | undefined {
  const map: Record<string, string> = {
    "btn-primary": "primary",
    "btn-secondary": "secondary",
    "btn-default": "secondary",
    "btn-link": "link",
    "btn-danger": "danger",
  }
  return classes.map((c) => map[c]).find(Boolean)
}

export function describeHit(hit: BootstrapHit): string {
  const family = familyById(hit.family)
  let message = `Bootstrap "${hit.classes.join(" ")}" → Playbook ${family?.playbook ?? ""}`
  if (hit.family === "button") {
    const variant = buttonVariant(hit.classes)
    if (variant) {
      message += ` (variant: "${variant}")`
    }
  }
  return message
}
