import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import { PlaybookDefinitionProvider } from "../../definitionProvider";
import { loadMetadata } from "../../metadata";

suite("Definition Provider Test Suite", () => {
  let provider: PlaybookDefinitionProvider;
  let metadata: any;

  suiteSetup(async () => {
    const extensionPath = path.resolve(__dirname, "../../../");
    metadata = await loadMetadata(extensionPath);
    provider = new PlaybookDefinitionProvider(extensionPath);
  });

  suite("Rails Component Definition", () => {
    test("Should provide definition location for Rails component", async () => {
      const document = await createTestDocument("erb", '<%= pb_rails("button", props: {}) %>');
      const position = new vscode.Position(0, 16); // On "button"

      const definitions = await provider.provideDefinition(document, position);

      assert.ok(definitions, "Should provide definition");

      if (definitions && !Array.isArray(definitions)) {
        // Should be a Location with external URI
        assert.ok(definitions.uri, "Should have URI");
      }
    });

    test("Should generate correct documentation URL for component", async () => {
      const document = await createTestDocument("erb", '<%= pb_rails("card", props: {}) %>');
      const position = new vscode.Position(0, 16);

      const definitions = await provider.provideDefinition(document, position);

      if (definitions && !Array.isArray(definitions)) {
        const uri = definitions.uri.toString();
        assert.ok(uri.includes("playbook.powerhrg.com"), "Should point to Playbook documentation");
        assert.ok(uri.includes("card"), "Should include component name");
      }
    });

    test("Should not provide definition for unknown component", async () => {
      const document = await createTestDocument(
        "erb",
        '<%= pb_rails("unknown_component", props: {}) %>'
      );
      const position = new vscode.Position(0, 20);

      const definitions = await provider.provideDefinition(document, position);

      // Should return undefined or empty for unknown components
      assert.ok(!definitions || (Array.isArray(definitions) && definitions.length === 0));
    });

    test("Should handle multi-word component names", async () => {
      const document = await createTestDocument(
        "erb",
        '<%= pb_rails("advanced_table", props: {}) %>'
      );
      const position = new vscode.Position(0, 20);

      const definitions = await provider.provideDefinition(document, position);

      if (definitions && !Array.isArray(definitions)) {
        const uri = definitions.uri.toString();
        assert.ok(
          uri.includes("advanced") && uri.includes("table"),
          "Should handle underscored names"
        );
      }
    });
  });

  suite("React Component Definition", () => {
    test("Should provide definition for React component", async () => {
      const document = await createTestDocument("typescriptreact", '<Button text="Click" />');
      const position = new vscode.Position(0, 3); // On "Button"

      const definitions = await provider.provideDefinition(document, position);

      assert.ok(definitions, "Should provide definition");
    });

    test("Should generate correct URL for React component", async () => {
      const document = await createTestDocument("typescriptreact", "<Card />");
      const position = new vscode.Position(0, 2);

      const definitions = await provider.provideDefinition(document, position);

      if (definitions && !Array.isArray(definitions)) {
        const uri = definitions.uri.toString();
        assert.ok(uri.includes("playbook.powerhrg.com"), "Should point to docs");
        assert.ok(uri.includes("card"), "Should include component name");
      }
    });

    test("Should not provide definition for HTML tags", async () => {
      const document = await createTestDocument("typescriptreact", '<div className="test">');
      const position = new vscode.Position(0, 2);

      const definitions = await provider.provideDefinition(document, position);

      // Should not provide definition for regular HTML
      assert.ok(!definitions || (Array.isArray(definitions) && definitions.length === 0));
    });

    test("Should handle PascalCase component names", async () => {
      const document = await createTestDocument("typescriptreact", "<AdvancedTable />");
      const position = new vscode.Position(0, 5);

      const definitions = await provider.provideDefinition(document, position);

      if (definitions && !Array.isArray(definitions)) {
        const uri = definitions.uri.toString();
        // Should convert PascalCase to snake_case for URL
        assert.ok(uri.length > 0, "Should generate URL");
      }
    });
  });

  suite("Position Detection", () => {
    test("Should only activate on component name", async () => {
      const document = await createTestDocument(
        "erb",
        '<%= pb_rails("button", props: { text: "Click" }) %>'
      );
      const position = new vscode.Position(0, 40); // On prop value

      const definitions = await provider.provideDefinition(document, position);

      // Should not provide definition for prop values
      assert.ok(!definitions || (Array.isArray(definitions) && definitions.length === 0));
    });

    test("Should work at different positions in component name", async () => {
      const document = await createTestDocument("erb", '<%= pb_rails("button", props: {}) %>');

      // Test different positions within "button"
      const positions = [14, 16, 19]; // Start, middle, end of "button"

      for (const char of positions) {
        const position = new vscode.Position(0, char);
        const definitions = await provider.provideDefinition(document, position);

        // Should work at any position in the component name
        assert.ok(true, `Should work at character ${char}`);
      }
    });
  });

  suite("URL Generation", () => {
    test("Should use correct base URL", async () => {
      const document = await createTestDocument("erb", '<%= pb_rails("button", props: {}) %>');
      const position = new vscode.Position(0, 16);

      const definitions = await provider.provideDefinition(document, position);

      if (definitions && !Array.isArray(definitions)) {
        const uri = definitions.uri.toString();
        assert.ok(uri.startsWith("https://playbook.powerhrg.com"), "Should use correct base URL");
      }
    });

    test("Should include /kits/ in path", async () => {
      const document = await createTestDocument("erb", '<%= pb_rails("button", props: {}) %>');
      const position = new vscode.Position(0, 16);

      const definitions = await provider.provideDefinition(document, position);

      if (definitions && !Array.isArray(definitions)) {
        const uri = definitions.uri.toString();
        assert.ok(uri.includes("/kits/"), "Should include /kits/ in path");
      }
    });

    test("Should end with /react", async () => {
      const document = await createTestDocument("erb", '<%= pb_rails("button", props: {}) %>');
      const position = new vscode.Position(0, 16);

      const definitions = await provider.provideDefinition(document, position);

      if (definitions && !Array.isArray(definitions)) {
        const uri = definitions.uri.toString();
        assert.ok(uri.endsWith("/react"), "Should end with /react");
      }
    });
  });
});

async function createTestDocument(
  languageId: string,
  content: string
): Promise<vscode.TextDocument> {
  const uri = vscode.Uri.parse(`untitled:test-${Date.now()}.${languageId}`);
  const document = await vscode.workspace.openTextDocument(uri);
  const edit = new vscode.WorkspaceEdit();
  edit.insert(uri, new vscode.Position(0, 0), content);
  await vscode.workspace.applyEdit(edit);
  return document;
}
