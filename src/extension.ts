import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { parse } from "yaml";
import type { HelmingwayConfig, HelmingwayTreeNode } from "./types";

export function activate(context: vscode.ExtensionContext) {
  console.log("Helmingway extension is now active.");

  const provider = new HelmingwayPreviewProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("helmingway.preview", provider),
    vscode.commands.registerCommand("helmingway.openPreview", openPreview),
  );
}

export function deactivate() {}

/**
 * Provide Helmingway sidebar tree shown in VS Code Side View.
 */
class HelmingwayPreviewProvider implements vscode.TreeDataProvider<HelmingwayTreeNode> {
  /**
   * Build each row in the tree.
   *
   * Current UI example:
   *
   *   ▾ package my-chart    ./charts/my-chart
   *       tag dev
   *       tag staging
   *       tag prod
   *
   * ThemeIcon reference:
   * - https://code.visualstudio.com/api/references/icons-in-labels
   */
  getTreeItem(element: HelmingwayTreeNode): vscode.TreeItem {
    if (element.type === "chart") {
      const item = new vscode.TreeItem(element.chart.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = element.chart.path;
      item.iconPath = new vscode.ThemeIcon("package");
      return item;
    }

    const item = new vscode.TreeItem(element.alias.name, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon("tag");
    item.command = {
      command: "helmingway.openPreview",
      title: "Open Preview",
      arguments: [element],
    };
    return item;
  }

  async getChildren(element?: HelmingwayTreeNode): Promise<HelmingwayTreeNode[]> {
    if (!element) {
      const config = await readHelmingwayConfig();
      return (config.helm?.charts ?? []).map((chart) => ({
        type: "chart",
        chart,
      }));
    }

    if (element.type === "chart") {
      return (element.chart.aliases ?? []).map((alias) => ({
        type: "alias",
        chart: element.chart,
        alias,
      }));
    }

    return [];
  }
}

/**
 * Open a preview document for the given alias node.
 */
async function openPreview(
  node: Extract<HelmingwayTreeNode, { type: "alias" }> & { chart: { name: string } },
): Promise<void> {
  if (node.type !== "alias") {
    return;
  }

  const document = await vscode.workspace.openTextDocument({
    language: "yaml",
    content: [
      "# Helmingway Preview",
      `alias: ${node.alias.name}`,
      "",
      "preview coming soon",
    ].join("\n"),
  });

  await vscode.window.showTextDocument(document, {
    preview: true,
    viewColumn: vscode.ViewColumn.Beside,
  });
}

/**
 * Read and parse helmingway.yaml from workspace folder.
 * If the file is missing or invalid, show an error message and return an empty config.
 */
async function readHelmingwayConfig(): Promise<HelmingwayConfig> {
  // TODO: Support reading helmingway.yaml from multiple VS Code workspace folders.
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showInformationMessage("Helmingway: ワークスペースを開いてください。");
    return {};
  }

  const configPath = path.join(workspaceFolder.uri.fsPath, "helmingway.yaml");

  try {
    const content = await fs.readFile(configPath, "utf8");
    return parse(content) as HelmingwayConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Helmingway: 設定ファイルを読み込めませんでした: ${message}`);
    return {};
  }
}
