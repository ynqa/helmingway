import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { parse } from "yaml";
import type { ChartConfig, HelmingwayConfig, HelmingwayTreeNode } from "./types";
import { toAliasTreeNodes, toChartTreeNode } from "./tree-node";

let previewDocumentProvider: HelmingwayPreviewDocumentProvider;

/**
 * Provide read-only preview content through `helmingway-preview` virtual document scheme.
 */
class HelmingwayPreviewDocumentProvider implements vscode.TextDocumentContentProvider {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  private readonly documents = new Map<string, string>();

  readonly onDidChange = this.onDidChangeEmitter.event;

  setContent(uri: vscode.Uri, content: string): void {
    this.documents.set(uri.toString(), content);
    this.onDidChangeEmitter.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.documents.get(uri.toString()) ?? "";
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log("Helmingway extension is now active.");

  const provider = new HelmingwayPreviewProvider();
  previewDocumentProvider = new HelmingwayPreviewDocumentProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("helmingway.preview", provider),
    vscode.workspace.registerTextDocumentContentProvider("helmingway-preview", previewDocumentProvider),
    vscode.commands.registerCommand("helmingway.openPreview", openPreview),
  );
}

export function deactivate() {}

/**
 * Provide Helmingway sidebar tree shown in VS Code Side View.
 */
class HelmingwayPreviewProvider implements vscode.TreeDataProvider<HelmingwayTreeNode> {
  private charts: ChartConfig[] = [];
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
      this.charts = config.helm?.charts ?? [];
      return this.charts.map(toChartTreeNode);
    }

    if (element.type === "chart") {
      const chart = this.charts.find((chart) => chart.name === element.chartName);
      return chart ? toAliasTreeNodes(chart) : [];
    }

    return [];
  }
}

/**
 * Open a preview document for the given alias node.
 */
async function openPreview(node: Extract<HelmingwayTreeNode, { type: "alias" }>): Promise<void> {
  if (node.type !== "alias") {
    return;
  }

  const content = [
    "# Helmingway Preview",
    `alias: ${node.aliasName}`,
    "",
    "preview coming soon",
  ].join("\n");
  const uri = vscode.Uri.from({
    scheme: "helmingway-preview",
    path: `/${node.aliasName}.yaml`,
  });

  previewDocumentProvider.setContent(uri, content);

  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.languages.setTextDocumentLanguage(document, "yaml");
  await vscode.window.showTextDocument(document, {
    preview: true,
    viewColumn: vscode.window.activeTextEditor?.viewColumn,
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
