import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  console.log("Helmingway extension is now active.");

  const provider = new HelmingwayPreviewProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("helmingway.preview", provider),
  );
}

export function deactivate() {}

/**
 * Provides Helmingway sidebar tree shown in VS Code Side View.
 */
class HelmingwayPreviewProvider implements vscode.TreeDataProvider<never> {
  getTreeItem(element: never): vscode.TreeItem {
    return element;
  }

  getChildren(): never[] {
    return [];
  }
}
