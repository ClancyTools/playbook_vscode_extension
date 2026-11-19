import * as assert from "assert";
import * as vscode from "vscode";
import { parseRailsComponent, parseReactComponent, parseRailsProps } from "../../parser";
import { createTestDocument } from "./testHelpers";

suite("Parser Test Suite", () => {
  suite("Rails Component Parsing", () => {
    test("Should parse pb_rails component", async () => {
      const doc = await createTestDocument(
        "erb",
        '<%= pb_rails("button", props: { text: "Click" }) %>'
      );
      const position = new vscode.Position(0, 16);

      const result = parseRailsComponent(doc, position);

      assert.ok(result, "Should parse Rails component");
      assert.strictEqual(result?.componentName, "button", "Should extract component name");
    });

    test("Should parse component at different positions", async () => {
      const doc = await createTestDocument("erb", '<%= pb_rails("avatar", props: {}) %>');
      const position = new vscode.Position(0, 18);

      const result = parseRailsComponent(doc, position);

      assert.ok(result, "Should parse component");
      assert.strictEqual(result?.componentName, "avatar", "Should extract avatar component");
    });

    test("Should return null for non-component line", async () => {
      const doc = await createTestDocument("erb", "<p>Regular HTML</p>");
      const position = new vscode.Position(0, 5);

      const result = parseRailsComponent(doc, position);

      assert.strictEqual(result, null, "Should not parse regular HTML");
    });

    test("Should parse nested components", async () => {
      const doc = await createTestDocument(
        "erb",
        '<%= pb_rails("card", props: { body: pb_rails("button") }) %>'
      );
      const position = new vscode.Position(0, 16);

      const result = parseRailsComponent(doc, position);

      assert.ok(result, "Should parse outer component");
      assert.strictEqual(result?.componentName, "card", "Should extract card component");
    });

    test("Should handle incomplete component", async () => {
      const doc = await createTestDocument("erb", '<%= pb_rails("but');
      const position = new vscode.Position(0, 16);

      const result = parseRailsComponent(doc, position);

      assert.strictEqual(result, null, "An unterminated pb_rails(\"but has no component yet");
    });

    test("Should parse component with underscores", async () => {
      const doc = await createTestDocument("erb", '<%= pb_rails("flex_item", props: {}) %>');
      const position = new vscode.Position(0, 20);

      const result = parseRailsComponent(doc, position);

      assert.ok(result, "Should parse component with underscores");
      assert.strictEqual(result?.componentName, "flex_item", "Should preserve underscores");
    });

    test("Should parse multiline component", async () => {
      const doc = await createTestDocument(
        "erb",
        '<%= pb_rails("button",\n  props: { text: "Click" }) %>'
      );
      const position = new vscode.Position(0, 16);

      const result = parseRailsComponent(doc, position);

      assert.ok(result, "Should parse multiline component");
      assert.strictEqual(result?.componentName, "button", "Should extract component name");
    });

    test("Should handle component with various prop types", async () => {
      const doc = await createTestDocument(
        "erb",
        '<%= pb_rails("button", props: { text: "Click", size: :lg, disabled: false }) %>'
      );
      const position = new vscode.Position(0, 16);

      const result = parseRailsComponent(doc, position);

      assert.ok(result, "Should parse component with mixed props");
      assert.strictEqual(result?.componentName, "button", "Should extract component name");
    });
  });

  suite("Rails Prop Parsing", () => {
    test("Should parse the first prop of a single-line props hash", async () => {
      const doc = await createTestDocument("erb", '<%= pb_rails("button", props: { variant: "primary", text: "Hi" }) %>');
      const result = parseRailsProps(doc, new vscode.Position(0, 34));

      assert.strictEqual(result?.propName, "variant", "props: { must not swallow the first prop");
      assert.strictEqual(result?.value, "primary");
    });

    test("Should not treat the props: key itself as a prop value", async () => {
      const doc = await createTestDocument("erb", '<%= pb_rails("button", props: { text: "Hi" }) %>');
      const result = parseRailsProps(doc, new vscode.Position(0, 25));

      assert.strictEqual(result, null, "the props: key is not a Playbook prop");
    });

    test("Should parse later props on the same line", async () => {
      const doc = await createTestDocument("erb", '<%= pb_rails("button", props: { variant: "primary", text: "Hi" }) %>');
      const result = parseRailsProps(doc, new vscode.Position(0, 52));

      assert.strictEqual(result?.propName, "text");
    });
  });

  suite("React Component Parsing", () => {
    test("Should parse React component", async () => {
      const doc = await createTestDocument("typescriptreact", '<Button text="Click" />');
      const position = new vscode.Position(0, 3);

      const result = parseReactComponent(doc, position);

      assert.ok(result, "Should parse React component");
      assert.strictEqual(result?.componentName, "Button", "Should extract component name");
    });

    test("Should parse self-closing component", async () => {
      const doc = await createTestDocument("typescriptreact", "<Avatar />");
      const position = new vscode.Position(0, 3);

      const result = parseReactComponent(doc, position);

      assert.ok(result, "Should parse self-closing component");
      assert.strictEqual(result?.componentName, "Avatar", "Should extract Avatar");
    });

    test("Should parse component with children", async () => {
      const doc = await createTestDocument("typescriptreact", "<Card><Button /></Card>");
      const position = new vscode.Position(0, 3);

      const result = parseReactComponent(doc, position);

      assert.ok(result, "Should parse component with children");
      assert.strictEqual(result?.componentName, "Card", "Should extract Card component");
    });

    test("Should return null for HTML tag", async () => {
      const doc = await createTestDocument("typescriptreact", "<div>Content</div>");
      const position = new vscode.Position(0, 3);

      const result = parseReactComponent(doc, position);

      assert.strictEqual(result, null, "Lowercase HTML tags are not components");
    });

    test("Should parse component with props", async () => {
      const doc = await createTestDocument(
        "typescriptreact",
        '<Button text="Click" variant="primary" />'
      );
      const position = new vscode.Position(0, 3);

      const result = parseReactComponent(doc, position);

      assert.ok(result, "Should parse component with props");
      assert.strictEqual(result?.componentName, "Button", "Should extract Button");
    });

    test("Should handle incomplete React component", async () => {
      const doc = await createTestDocument("typescriptreact", "<But");
      const position = new vscode.Position(0, 3);

      const result = parseReactComponent(doc, position);

      assert.strictEqual(result?.componentName, "But", "Partial tag name is still parsed");
    });

    test("Should parse multiline React component", async () => {
      const doc = await createTestDocument("typescriptreact", '<Button\n  text="Click"\n/>');
      const position = new vscode.Position(0, 3);

      const result = parseReactComponent(doc, position);

      assert.ok(result, "Should parse multiline component");
      assert.strictEqual(result?.componentName, "Button", "Should extract Button");
    });

    test("Should handle JSX fragments", async () => {
      const doc = await createTestDocument("typescriptreact", "<><Button /></>");
      const position = new vscode.Position(0, 4);

      const result = parseReactComponent(doc, position);

      assert.strictEqual(result?.componentName, "Button", "Component inside a fragment is parsed");
    });
  });
});
