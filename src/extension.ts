import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { parse } from "yaml";
import { parseChartSource } from "./chart-source";
import { AliasRenderStore } from "./alias-render-store";
import { aliasRenderStatusPresentation } from "./alias-render-status";
import { refreshPreview } from "./preview-refresh";
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
const previewCache = new AliasRenderStore();

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

  const provider = new HelmingwayPreviewProvider(previewCache);
  const treeView = vscode.window.createTreeView("helmingway.preview", {
    treeDataProvider: provider,
  });
  previewDocumentProvider = new HelmingwayPreviewDocumentProvider();
  let hasInitializedPreview = false;

  context.subscriptions.push(
    treeView,
    vscode.workspace.registerTextDocumentContentProvider("helmingway-preview", previewDocumentProvider),
    vscode.commands.registerCommand("helmingway.openPreview", openPreview),
    vscode.commands.registerCommand("helmingway.refresh", () => runPreviewRefresh(provider)),
    // Warm the preview cache once, when the Helmingway view is first revealed.
    treeView.onDidChangeVisibility(async (event) => {
      if (!event.visible || hasInitializedPreview) {
        return;
      }

      hasInitializedPreview = true;
      await runPreviewRefresh(provider);
    }),
  );
}

export function deactivate() {}

/**
 * Provide Helmingway sidebar tree shown in VS Code Side View.
 */
export class HelmingwayPreviewProvider implements vscode.TreeDataProvider<HelmingwayTreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<HelmingwayTreeNode | undefined>();

  constructor(private readonly renderStore: AliasRenderStore) {}

  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  /**
   * Build each row in the tree.
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
    const entry = this.renderStore.get(element.chartName, element.aliasName);
    const status = entry?.status ?? "idle";
    const presentation = aliasRenderStatusPresentation[status];
    item.iconPath = presentation.icon;
    item.description = presentation.description;
    if (entry?.errorMessage) {
      item.tooltip = entry.errorMessage;
    }
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

  const entry = previewCache.get(node.chartName, node.aliasName);
  if (!entry || entry.status === "idle") {
    vscode.window.showInformationMessage("Helmingway: preview はまだレンダリングされていません。Refresh を実行してください。");
    return;
  }
  if (entry.status === "rendering") {
    vscode.window.showInformationMessage("Helmingway: preview はレンダリング中です。完了後にもう一度開いてください。");
    return;
  }
  if (entry.status === "failed") {
    vscode.window.showErrorMessage(`Helmingway: preview のレンダリングに失敗しました: ${entry.errorMessage ?? "unknown error"}`);
    return;
  }
  if (entry.content === undefined) {
    vscode.window.showErrorMessage("Helmingway: preview のキャッシュ内容が見つかりませんでした。Refresh を実行してください。");
    return;
  }

  const uri = vscode.Uri.from({
    scheme: "helmingway-preview",
    path: `/${node.aliasName}.yaml`,
  });

  previewDocumentProvider.setContent(uri, entry.content);

  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.languages.setTextDocumentLanguage(document, "yaml");
  await vscode.window.showTextDocument(document, {
    preview: false,
    viewColumn: vscode.window.activeTextEditor?.viewColumn,
  });
}

async function runPreviewRefresh(provider: HelmingwayPreviewProvider): Promise<void> {
  const workspaceFolder = getPrimaryWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  currentConfig = await readHelmingwayConfig();
  await refreshPreview({
    provider,
    workspacePath: workspaceFolder.uri.fsPath,
    config: currentConfig,
    cache: previewCache,
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
          source: parseChartSource(chart.source),
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
