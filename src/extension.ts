import * as vscode from "vscode";
import { PlaybookHoverProvider } from "./hoverProvider";
import { PlaybookDefinitionProvider } from "./definitionProvider";
import { PlaybookDiagnostics } from "./diagnostics";
import { PlaybookCompletionProvider } from "./completionProvider";
import { PlaybookQuickFixProvider } from "./quickFixes";
import { SpacingHints } from "./spacingHints";
import { AxisHints } from "./axisHints";
import { PlaybookStatusBar } from "./statusBar";
import { KitTreeProvider, browseKits, runKitActions } from "./kitBrowser";
import { findDeprecatedUsages } from "./deprecatedUsages";
import { resetMetadataCache } from "./metadata";

export function activate(context: vscode.ExtensionContext) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Playbook UI extension activating...`);
  console.log(`[${timestamp}] Extension path: ${context.extensionPath}`);

  const supportedLanguages = [
    "ruby",
    "erb",
    "html.erb",
    "html",
    "javascript",
    "javascriptreact",
    "typescript",
    "typescriptreact"
  ];
  console.log(`[${timestamp}] Playbook UI: Registering for languages:`, supportedLanguages);

  console.log(`[${timestamp}] Creating hover provider...`);
  const hoverProvider = new PlaybookHoverProvider(context.extensionPath);
  const hoverDisposable = vscode.languages.registerHoverProvider(supportedLanguages, hoverProvider);
  context.subscriptions.push(hoverDisposable);
  console.log(
    `[${timestamp}] ✓ Hover provider registered for ${supportedLanguages.length} languages`
  );

  console.log(`[${timestamp}] Creating definition provider...`);
  const definitionProvider = new PlaybookDefinitionProvider(context.extensionPath);
  const definitionDisposable = vscode.languages.registerDefinitionProvider(
    supportedLanguages,
    definitionProvider
  );
  context.subscriptions.push(definitionDisposable);
  console.log(
    `[${timestamp}] ✓ Definition provider registered for ${supportedLanguages.length} languages`
  );

  console.log(`[${timestamp}] Creating completion provider...`);
  const completionProvider = new PlaybookCompletionProvider(context.extensionPath);
  const completionTriggers = ['"', "'", "<", " ", ":", "="];
  console.log(`[${timestamp}] Completion triggers: ${completionTriggers.join(", ")}`);
  const completionDisposable = vscode.languages.registerCompletionItemProvider(
    supportedLanguages,
    completionProvider,
    ...completionTriggers
  );
  context.subscriptions.push(completionDisposable);
  console.log(
    `[${timestamp}] ✓ Completion provider registered for ${supportedLanguages.length} languages`
  );

  console.log(`[${timestamp}] Creating diagnostics provider...`);
  const diagnostics = new PlaybookDiagnostics(context.extensionPath);
  context.subscriptions.push(diagnostics);

  console.log(`[${timestamp}] Registering diagnostics event listeners...`);
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      console.log(
        `[Diagnostics] Text changed in ${event.document.languageId} file: ${event.document.uri.toString()}`
      );
      diagnostics.updateDiagnostics(event.document);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      console.log(
        `[Diagnostics] Document opened: ${document.languageId} - ${document.uri.toString()}`
      );
      diagnostics.updateDiagnostics(document);
    })
  );

  const openDocs = vscode.workspace.textDocuments;
  console.log(`[${timestamp}] Running diagnostics on ${openDocs.length} already-open documents...`);
  openDocs.forEach((document) => {
    console.log(
      `[Diagnostics] Processing open document: ${document.languageId} - ${document.uri.toString()}`
    );
    diagnostics.updateDiagnostics(document);
  });

  console.log(`[${timestamp}] ✓ Prop validation diagnostics registered`);

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      supportedLanguages,
      new PlaybookQuickFixProvider(context.extensionPath),
      { providedCodeActionKinds: PlaybookQuickFixProvider.providedCodeActionKinds }
    )
  );

  const spacingHints = new SpacingHints(context.extensionPath);
  const axisHints = new AxisHints(context.extensionPath);
  const statusBar = new PlaybookStatusBar(context.extensionPath);
  const kitTree = new KitTreeProvider(context.extensionPath);
  context.subscriptions.push(
    spacingHints,
    axisHints,
    statusBar,
    vscode.window.registerTreeDataProvider("playbookKits", kitTree)
  );

  /** Re-discover which Playbook version is in use and refresh everything built from it. */
  const reload = () => {
    resetMetadataCache();
    vscode.workspace.textDocuments.forEach((document) => diagnostics.updateDiagnostics(document));
    statusBar.update();
    kitTree.refresh();
    spacingHints.refreshAll();
    axisHints.refreshAll();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("playbook.browseKits", () =>
      browseKits(context.extensionPath)
    ),
    vscode.commands.registerCommand("playbook.kitActions", (railsName: string) =>
      runKitActions(context.extensionPath, railsName)
    ),
    vscode.commands.registerCommand("playbook.findDeprecated", () =>
      findDeprecatedUsages(context.extensionPath)
    ),
    vscode.commands.registerCommand("playbook.reloadMetadata", () => {
      reload();
      vscode.window.showInformationMessage("Playbook metadata reloaded.");
    }),
    vscode.commands.registerCommand("playbook.showInfo", async () => {
      const choice = await vscode.window.showQuickPick(
        [
          { label: "$(symbol-class) Browse kits", command: "playbook.browseKits" },
          { label: "$(warning) Find deprecated usages", command: "playbook.findDeprecated" },
          { label: "$(refresh) Reload Playbook metadata", command: "playbook.reloadMetadata" }
        ],
        { title: statusBar.describe().text.replace("$(book) ", ""), placeHolder: statusBar.describe().tooltip.split("\n")[0] }
      );
      if (choice) {
        await vscode.commands.executeCommand(choice.command);
      }
    })
  );

  // Installing or upgrading playbook-ui changes its lockfile / manifest. (Files in
  // node_modules are excluded from VS Code's watcher, so watch those instead.)
  const manifestWatcher = vscode.workspace.createFileSystemWatcher(
    "**/{package.json,yarn.lock,package-lock.json,pnpm-lock.yaml}"
  );
  context.subscriptions.push(
    manifestWatcher,
    manifestWatcher.onDidChange(reload),
    manifestWatcher.onDidCreate(reload),
    manifestWatcher.onDidDelete(reload),
    vscode.workspace.onDidChangeWorkspaceFolders(reload),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("playbook.diagnostics")) {
        vscode.workspace.textDocuments.forEach((document) =>
          diagnostics.updateDiagnostics(document)
        );
      }
    })
  );

  console.log(
    `[${timestamp}] ✨ Playbook UI extension fully activated with snippets, autocomplete, hover, validation, and definition support!`
  );
  console.log(`[${timestamp}] Extension ready to use.`);
}

export function deactivate() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Playbook UI extension is now deactivating...`);
}
