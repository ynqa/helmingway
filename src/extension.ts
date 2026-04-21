import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { parse } from "yaml";
import { findAliasConfig, findChartConfig } from "./config-lookup";
import { renderHelmTemplate } from "./helm-template";
import { toAliasTreeNodes, toChartTreeNode } from "./tree-node";
import type {
  ChartConfig,
  HelmingwayConfig,
  HelmingwayTreeNode,
  RawHelmingwayConfig,
} from "./types";
import { getPrimaryWorkspaceFolder } from "./vscode-workspace";

let previewDocumentProvider: HelmingwayPreviewDocumentProvider;
let currentConfig: HelmingwayConfig = {};

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
      const item = new vscode.TreeItem(element.chartName, vscode.TreeItemCollapsibleState.Collapsed);
      // Show chart path as description in the sidebar.
      item.description = element.chartPath;
      item.iconPath = new vscode.ThemeIcon("package");
      return item;
    }

    const item = new vscode.TreeItem(element.aliasName, vscode.TreeItemCollapsibleState.None);
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
      currentConfig = await readHelmingwayConfig();
      return (currentConfig.helm?.charts ?? []).map(toChartTreeNode);
    }

    if (element.type === "chart") {
      const chart = (currentConfig.helm?.charts ?? []).find((chart) => chart.name === element.chartName);
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

  const workspaceFolder = getPrimaryWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  const chart = findChartConfig(currentConfig, node.chartName);
  const alias = findAliasConfig(currentConfig, node.chartName, node.aliasName);
  if (!chart || !alias) {
    vscode.window.showErrorMessage("Helmingway: preview 対象の設定が見つかりませんでした。");
    return;
  }

  let content: string;

  try {
    content = await renderHelmTemplate({
      workspacePath: workspaceFolder.uri.fsPath,
      chart,
      alias,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Helmingway: ${message}`);
    return;
  }

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
  const workspaceFolder = getPrimaryWorkspaceFolder();
  if (!workspaceFolder) {
    return {};
  }

  const configPath = path.join(workspaceFolder.uri.fsPath, "helmingway.yaml");

  try {
    const content = await fs.readFile(configPath, "utf8");
    const raw = parse(content) as RawHelmingwayConfig;

    return {
      helm: {
        charts: (raw.helm?.charts ?? []).map((chart) => ({
          name: chart.name,
          source: toHelmChartSource(chart.source),
          releaseName: chart.releaseName,
          namespace: chart.namespace,
          aliases: chart.aliases,
        })),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Helmingway: 設定ファイルを読み込めませんでした: ${message}`);
    return {};
  }
}

function toHelmChartSource(source: string): ChartConfig["source"] {
  if (source.startsWith("oci://")) {
    return {
      kind: "oci",
      ref: source,
    };
  }

  if (source.startsWith("http://") || source.startsWith("https://")) {
    return {
      kind: "url",
      url: source,
    };
  }

  if (source.endsWith(".tgz")) {
    return {
      kind: "packaged",
      filePath: source,
    };
  }

  if (source.includes("/") || source.startsWith(".")) {
    return {
      kind: "directory",
      directoryPath: source,
    };
  }

  return {
    kind: "reference",
    ref: source,
  };
}
