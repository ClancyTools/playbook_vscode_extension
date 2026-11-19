import * as assert from "assert"
import { scanFormBuilderUsages, scanRailsUsages, scanReactUsages, ScannedUsage } from "../../usageScanner"

function names(usage: ScannedUsage): string[] {
  return usage.props.map((p) => p.name)
}

function valueOf(usage: ScannedUsage, name: string): string | undefined {
  return usage.props.find((p) => p.name === name)?.valueText
}

suite("Usage Scanner Test Suite", () => {
  suite("React", () => {
    test("scans string, expression and shorthand props", () => {
      const [usage] = scanReactUsages('<Button text="Hi" count={3} loading />')

      assert.strictEqual(usage.component, "Button")
      assert.deepStrictEqual(names(usage), ["text", "count", "loading"])
      assert.strictEqual(valueOf(usage, "text"), '"Hi"')
      assert.strictEqual(valueOf(usage, "count"), "{3}")
      assert.strictEqual(valueOf(usage, "loading"), undefined, "shorthand has no value")
    })

    test("reports offsets that slice back to the name and value", () => {
      const text = 'xx <Badge variant="primary" /> yy'
      const [usage] = scanReactUsages(text)
      const prop = usage.props[0]

      assert.strictEqual(text.slice(usage.componentStart, usage.componentEnd), "Badge")
      assert.strictEqual(text.slice(prop.nameStart, prop.nameEnd), "variant")
      assert.strictEqual(text.slice(prop.valueStart, prop.valueEnd), '"primary"')
    })

    test("scans props across multiple lines", () => {
      const [usage] = scanReactUsages(`<Dropdown
        label="Country"
        multiSelect
        options={options}
      />`)
      assert.deepStrictEqual(names(usage), ["label", "multiSelect", "options"])
    })

    test("does not stop at => inside an arrow function handler", () => {
      const [usage] = scanReactUsages(
        '<Button onClick={() => setOpen(true)} text="Open" />'
      )
      assert.deepStrictEqual(names(usage), ["onClick", "text"])
      assert.strictEqual(valueOf(usage, "text"), '"Open"')
    })

    test("handles nested braces, strings and template literals in values", () => {
      const [usage] = scanReactUsages(
        '<Card padding={{ default: "sm", md: "lg" }} id={`row-${id}`} text="a}b" />'
      )
      assert.deepStrictEqual(names(usage), ["padding", "id", "text"])
      assert.strictEqual(valueOf(usage, "padding"), '{{ default: "sm", md: "lg" }}')
      assert.strictEqual(valueOf(usage, "id"), "{`row-${id}`}")
      assert.strictEqual(valueOf(usage, "text"), '"a}b"')
    })

    test("flags spreads", () => {
      const [usage] = scanReactUsages("<Button {...rest} text={t} />")
      assert.ok(usage.hasSpread)
      assert.deepStrictEqual(names(usage), ["text"])
    })

    test("does not flag usages without spreads", () => {
      assert.strictEqual(scanReactUsages('<Button text="a" />')[0].hasSpread, false)
    })

    test("reads subcomponents with dot notation", () => {
      const [usage] = scanReactUsages('<Table.Row sideHighlightColor="info">')
      assert.strictEqual(usage.component, "Table.Row")
      assert.deepStrictEqual(names(usage), ["sideHighlightColor"])
    })

    test("finds every component in a document, including nested ones", () => {
      const usages = scanReactUsages(`<Card padding="sm">
        <Title text="Hello" size={3} />
        <Button text="Go" />
      </Card>`)
      assert.deepStrictEqual(
        usages.map((u) => u.component),
        ["Card", "Title", "Button"]
      )
      assert.deepStrictEqual(names(usages[0]), ["padding"])
    })

    test("ignores TypeScript generics", () => {
      const usages = scanReactUsages(
        "const [x, setX] = useState<Foo>(null); const y: Array<Bar> = []; <Button />"
      )
      assert.deepStrictEqual(
        usages.map((u) => u.component),
        ["Button"]
      )
    })

    test("ignores lowercase HTML elements", () => {
      assert.deepStrictEqual(scanReactUsages('<div className="a"><span /></div>'), [])
    })

    test("handles aria- and data- attributes", () => {
      const [usage] = scanReactUsages('<Button aria-label="Close" data-test-id="x" />')
      assert.deepStrictEqual(names(usage), ["aria-label", "data-test-id"])
    })

    test("skips comments between attributes", () => {
      const [usage] = scanReactUsages(`<Button
        // a comment with a > in it
        text="Hi"
        /* block > comment */
        variant="link"
      />`)
      assert.deepStrictEqual(names(usage), ["text", "variant"])
    })

    test("copes with an unterminated tag", () => {
      const [usage] = scanReactUsages('<Button text="Hi" ')
      assert.deepStrictEqual(names(usage), ["text"])
    })

    test("does not mistake a less-than comparison for a component", () => {
      assert.deepStrictEqual(scanReactUsages("if (a <B) {}"), [])
    })
  })

  suite("Rails", () => {
    test("scans a single-line props hash", () => {
      const [usage] = scanRailsUsages(
        '<%= pb_rails("button", props: { text: "Hi", variant: "primary", loading: true }) %>'
      )
      assert.strictEqual(usage.component, "button")
      assert.deepStrictEqual(names(usage), ["text", "variant", "loading"])
      assert.strictEqual(valueOf(usage, "variant"), '"primary"')
      assert.strictEqual(valueOf(usage, "loading"), "true")
    })

    test("reports offsets that slice back to the name and value", () => {
      const text = '<%= pb_rails("badge", props: { variant: "primary" }) %>'
      const [usage] = scanRailsUsages(text)
      const prop = usage.props[0]

      assert.strictEqual(text.slice(usage.componentStart, usage.componentEnd), "badge")
      assert.strictEqual(text.slice(prop.nameStart, prop.nameEnd), "variant")
      assert.strictEqual(text.slice(prop.valueStart, prop.valueEnd), '"primary"')
    })

    test("scans a multi-line props hash with comments", () => {
      const [usage] = scanRailsUsages(`<%= pb_rails("pill", props: {
        text: "Hello", # greeting
        variant: "neutral",
      }) %>`)
      assert.deepStrictEqual(names(usage), ["text", "variant"])
      assert.strictEqual(valueOf(usage, "text"), '"Hello"', "trailing comment is excluded")
    })

    test("treats nested hashes, arrays and calls as one value", () => {
      const [usage] = scanRailsUsages(
        '<%= pb_rails("card", props: { data: { a: 1, b: [1, 2] }, id: dom_id(item, :x), padding: "sm" }) %>'
      )
      assert.deepStrictEqual(names(usage), ["data", "id", "padding"])
      assert.strictEqual(valueOf(usage, "data"), "{ a: 1, b: [1, 2] }")
      assert.strictEqual(valueOf(usage, "id"), "dom_id(item, :x)")
    })

    test("handles string interpolation containing braces and commas", () => {
      const [usage] = scanRailsUsages(
        '<%= pb_rails("title", props: { text: "Hi #{user.name}, welcome", size: 3 }) %>'
      )
      assert.deepStrictEqual(names(usage), ["text", "size"])
      assert.strictEqual(valueOf(usage, "text"), '"Hi #{user.name}, welcome"')
    })

    test("flags a ** spread", () => {
      const [usage] = scanRailsUsages('<%= pb_rails("button", props: { text: "a", **extra }) %>')
      assert.ok(usage.hasSpread)
      assert.deepStrictEqual(names(usage), ["text"])
    })

    test("flags a non-literal props argument", () => {
      const [usage] = scanRailsUsages('<%= pb_rails("button", props: button_props) %>')
      assert.ok(usage.hasSpread)
      assert.deepStrictEqual(usage.props, [])
    })

    test("accepts quoted and hash-rocket keys", () => {
      const [usage] = scanRailsUsages(
        `<%= pb_rails("button", props: { "text": "a", :variant => "link" }) %>`
      )
      assert.deepStrictEqual(names(usage), ["text", "variant"])
    })

    test("handles a usage with no props", () => {
      const [usage] = scanRailsUsages('<%= pb_rails("section_separator") %>')
      assert.strictEqual(usage.component, "section_separator")
      assert.deepStrictEqual(usage.props, [])
      assert.strictEqual(usage.hasSpread, false)
    })

    test("finds several calls, one per component", () => {
      const usages = scanRailsUsages(`<%= pb_rails("card", props: { padding: "sm" }) do %>
        <%= pb_rails("title", props: { text: "A" }) %>
      <% end %>`)
      assert.deepStrictEqual(
        usages.map((u) => u.component),
        ["card", "title"]
      )
      assert.deepStrictEqual(names(usages[0]), ["padding"])
      assert.deepStrictEqual(names(usages[1]), ["text"])
    })

    test("supports subcomponent names", () => {
      const [usage] = scanRailsUsages('<%= pb_rails("table/table_row", props: { tag: "div" }) %>')
      assert.strictEqual(usage.component, "table/table_row")
    })

    test("stops cleanly on an unterminated hash", () => {
      const [usage] = scanRailsUsages('<%= pb_rails("button", props: { text: "a", ')
      assert.deepStrictEqual(names(usage), ["text"])
    })
  })

  suite("Form builder", () => {
    test("scans a paren-less call on one line", () => {
      const [usage] = scanFormBuilderUsages('<%= f.text_field :email, props: { label: true, required: true } %>')
      assert.strictEqual(usage.component, "text_field")
      assert.ok(usage.form)
      assert.deepStrictEqual(names(usage), ["label", "required"])
    })

    test("scans a multi-line props hash", () => {
      const [usage] = scanFormBuilderUsages(`<%= f.text_field :name, props: {
        label: "Name",
        mask: "ssn"
      } %>`)
      assert.deepStrictEqual(names(usage), ["label", "mask"])
      assert.strictEqual(valueOf(usage, "mask"), '"ssn"')
    })

    test("scans a parenthesised call", () => {
      const [usage] = scanFormBuilderUsages('<%= f.text_field(:email, props: { label: true }) %>')
      assert.deepStrictEqual(names(usage), ["label"])
    })

    test("does not borrow props from the next call", () => {
      const usages = scanFormBuilderUsages(`<%= f.date_picker :starts_on %>
<%= pb_rails("table", props: { size: "sm", container: false }) %>
<%= f.text_field :name, props: { label: true } %>`)
      assert.strictEqual(usages.length, 2)
      assert.deepStrictEqual(usages[0].props, [], "date_picker passes no props")
      assert.deepStrictEqual(names(usages[1]), ["label"])
    })

    test("does not borrow props from a following multi-line call", () => {
      const usages = scanFormBuilderUsages(`<%= f.check_box :agree %>
<%= pb_rails("card", props: {
  padding: "sm"
}) %>`)
      assert.deepStrictEqual(usages[0].props, [])
    })

    test("follows a call continued with a trailing comma", () => {
      const [usage] = scanFormBuilderUsages(`<%= f.select :country, choices,
  {},
  props: { label: true } %>`)
      assert.deepStrictEqual(names(usage), ["label"])
    })

    test("ignores props nested inside another argument", () => {
      const [usage] = scanFormBuilderUsages(
        '<%= f.select :country, options_for(props: { x: 1 }), props: { label: true } %>'
      )
      assert.deepStrictEqual(names(usage), ["label"])
    })

    test("flags a non-literal props argument", () => {
      const [usage] = scanFormBuilderUsages("<%= f.text_field :email, props: field_props %>")
      assert.ok(usage.hasSpread)
    })

    test("accepts the form and builder receivers", () => {
      assert.strictEqual(scanFormBuilderUsages("<%= form.text_field :a %>").length, 1)
      assert.strictEqual(scanFormBuilderUsages("<%= builder.text_field :a %>").length, 1)
    })

    test("ignores other receivers and non-calls", () => {
      assert.deepStrictEqual(scanFormBuilderUsages("<%= user.name %> <%= other.text_field :a %>"), [])
      assert.deepStrictEqual(scanFormBuilderUsages("f.text_field"), [])
    })

    test("reports offsets that slice back to the name and value", () => {
      const text = '<%= f.text_field :a, props: { mask: "ssn" } %>'
      const [usage] = scanFormBuilderUsages(text)
      assert.strictEqual(text.slice(usage.componentStart, usage.componentEnd), "text_field")
      assert.strictEqual(text.slice(usage.props[0].valueStart, usage.props[0].valueEnd), '"ssn"')
    })
  })
})
