import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import { PlaybookHoverProvider } from "../../hoverProvider";
import { loadMetadata } from "../../metadata";
import { createTestDocument } from "./testHelpers";

suite("Hover Provider Test Suite", () => {
  let provider: PlaybookHoverProvider;
  let metadata: any;

  suiteSetup(async () => {
    const extensionPath = path.resolve(__dirname, "../../../");
    metadata = await loadMetadata(extensionPath);
    provider = new PlaybookHoverProvider(extensionPath);
  });

  suite("Rails Component Hover", () => {
    test("Should provide hover for Rails component name", async () => {
      const document = await createTestDocument("erb", '<%= pb_rails("button", props: {}) %>');
      const position = new vscode.Position(0, 16);

      const hover = await provider.provideHover(document, position);

      assert.ok(hover, "Should provide hover");
      assert.ok(hover.contents.length > 0, "Should have content");

      const content = (hover.contents[0] as vscode.MarkdownString).value;
      assert.ok(
        content.includes("Button") || content.includes("button"),
        "Should mention component"
      );
    });

    test("Should show props in component hover", async () => {
      const document = await createTestDocument("erb", '<%= pb_rails("button", props: {}) %>');
      const position = new vscode.Position(0, 16);

      const hover = await provider.provideHover(document, position);

      if (hover && hover.contents.length > 0) {
        const content = (hover.contents[0] as vscode.MarkdownString).value;
        assert.ok(content.includes("Props:") || content.includes("prop"), "Should list props");
      }
    });

    test("Should not provide hover for non-component text", async () => {
      const document = await createTestDocument("erb", '<div class="test"></div>');
      const position = new vscode.Position(0, 10);

      const hover = await provider.provideHover(document, position);

      assert.ok(!hover || hover.contents.length === 0, "Should not hover on non-Playbook code");
    });
  });

  suite("React Component Hover", () => {
    test("Should provide hover for React component", async () => {
      const document = await createTestDocument("typescriptreact", '<Button text="Click" />');
      const position = new vscode.Position(0, 3);

      const hover = await provider.provideHover(document, position);

      assert.ok(hover, "Should provide hover");
      assert.ok(hover.contents.length > 0, "Should have content");
    });

    test("Should show usage examples in hover", async () => {
      const document = await createTestDocument("typescriptreact", "<Card />");
      const position = new vscode.Position(0, 2);

      const hover = await provider.provideHover(document, position);

      if (hover && hover.contents.length > 0) {
        const content = (hover.contents[0] as vscode.MarkdownString).value;
        assert.ok(content.length > 0, "Should have detailed content");
      }
    });
  });

  suite("Rails Prop Hover", () => {
    test("Should provide hover for prop name", async () => {
      const document = await createTestDocument(
        "erb",
        '<%= pb_rails("button", props: { variant: "primary" }) %>'
      );
      const position = new vscode.Position(0, 34);

      const hover = await provider.provideHover(document, position);

      if (hover && hover.contents.length > 0) {
        const content = (hover.contents[0] as vscode.MarkdownString).value;
        assert.ok(
          content.includes("variant") || content.includes("Type:"),
          "Should show prop information"
        );
      }
    });

    test("Should show valid enum values in prop hover", async () => {
      const document = await createTestDocument(
        "erb",
        '<%= pb_rails("button", props: { variant: "primary" }) %>'
      );
      const position = new vscode.Position(0, 34);

      const hover = await provider.provideHover(document, position);

      assert.ok(hover, "Should provide hover for the variant prop");
      const content = (hover.contents[0] as vscode.MarkdownString).value;
      assert.ok(content.includes("Values:"), "Shows valid values for enum");
      assert.ok(content.includes("primary"), "Lists primary as a valid variant");
    });

    test("Should show default value if available", async () => {
      const document = await createTestDocument(
        "erb",
        '<%= pb_rails("button", props: { variant: "primary" }) %>'
      );
      const position = new vscode.Position(0, 34);

      const hover = await provider.provideHover(document, position);

      if (hover && hover.contents.length > 0) {
        const content = (hover.contents[0] as vscode.MarkdownString).value;
        assert.ok(content.length > 0, "Has prop documentation");
      }
    });
  });

  suite("React Prop Hover", () => {
    test("Should provide hover for React prop", async () => {
      const document = await createTestDocument("typescriptreact", '<Button variant="primary" />');
      const position = new vscode.Position(0, 10);

      const hover = await provider.provideHover(document, position);

      if (hover && hover.contents.length > 0) {
        const content = (hover.contents[0] as vscode.MarkdownString).value;
        assert.ok(content.length > 0, "Should provide prop documentation");
      }
    });

    test("Should handle camelCase props", async () => {
      const document = await createTestDocument(
        "typescriptreact",
        '<Component verticalAlign="top" />'
      );
      const position = new vscode.Position(0, 15);

      const hover = await provider.provideHover(document, position);

      assert.ok(!hover || hover.contents.length === 0, "Unknown component props should not produce hover");
    });
  });

  suite("Hover Range", () => {
    test("Should provide appropriate hover range", async () => {
      const document = await createTestDocument("erb", '<%= pb_rails("button", props: {}) %>');
      const position = new vscode.Position(0, 16);

      const hover = await provider.provideHover(document, position);

      if (hover && hover.range) {
        assert.ok(hover.range.start.character >= 0, "Should have valid start");
        assert.ok(hover.range.end.character > hover.range.start.character, "Should have valid end");
      }
    });
  });

  suite("Global props on subcomponents", () => {
    async function hoverText(languageId: string, content: string, marker: string): Promise<string | undefined> {
      const document = await createTestDocument(languageId, content);
      const hover = (await provider.provideHover(document, document.positionAt(content.indexOf(marker) + 1))) as vscode.Hover | null;
      return hover ? (hover.contents[0] as vscode.MarkdownString).value : undefined;
    }

    test("documents a global prop on a Rails subcomponent", async () => {
      const text = await hoverText("erb", '<%= pb_rails("card/card_body", props: { padding: "sm" }) %>', "padding");
      assert.ok(text?.includes("padding") && text.includes("Global prop"), text);
      assert.ok(text?.includes("card/card_body"), text);
    });

    test("documents a global prop on a React subcomponent", async () => {
      const text = await hoverText("typescriptreact", '<Card.Body paddingBottom="none" />', "paddingBottom");
      assert.ok(text?.includes("paddingBottom") && text.includes("Global prop"), text);
    });

    test("says nothing for a prop that isn't global, or under an unknown parent", async () => {
      assert.strictEqual(await hoverText("erb", '<%= pb_rails("card/card_body", props: { nonsense: "x" }) %>', "nonsense"), undefined);
      assert.strictEqual(await hoverText("erb", '<%= pb_rails("nope/card_body", props: { padding: "sm" }) %>', "padding"), undefined);
    });
  });
});
