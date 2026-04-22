import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { parse } from "yaml";
import { parseChartSource } from "./chart-source";
import { AliasRenderStore } from "./alias-render-store";
import { aliasRenderStatusPresentation } from "./alias-render-status";
import { refreshPreview as refreshPreviewInternal } from "./preview-refresh";
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
let selectedAliases: Array<Extract<HelmingwayTreeNode, { type: "alias" }>> = [];

export function activate(context: vscode.ExtensionContext) {
  console.log("Helmingway extension is now active.");

  const provider = new HelmingwayPreviewProvider(previewCache);
  const treeView = vscode.window.createTreeView("helmingway.preview", {
    treeDataProvider: provider,
    canSelectMany: true,
  });
  previewDocumentProvider = new HelmingwayPreviewDocumentProvider();
  let hasInitializedPreview = false;

  context.subscriptions.push(
    treeView,
    vscode.workspace.registerTextDocumentContentProvider("helmingway-preview", previewDocumentProvider),
    vscode.commands.registerCommand("helmingway.openPreview", openPreview),
    vscode.commands.registerCommand("helmingway.compareSelectedAliases", compareSelectedAliases),
    vscode.commands.registerCommand("helmingway.refreshPreview", () => refreshPreview(provider)),
    vscode.commands.registerCommand("helmingway.closeAllPreviews", closeAllPreviews),
    treeView.onDidChangeSelection((event) => {
      selectedAliases = event.selection.filter(
        (node): node is Extract<HelmingwayTreeNode, { type: "alias" }> => node.type === "alias",
      );
    }),
    // Warm the preview cache once, when the Helmingway view is first revealed.
    treeView.onDidChangeVisibility(async (event) => {
      if (!event.visible || hasInitializedPreview) {
        return;
      }

      hasInitializedPreview = true;
      await refreshPreview(provider);
    }),
  );
}

export function deactivate() {}

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

/**
 * Provide Helmingway sidebar tree shown in VS Code Side View.
 */
class HelmingwayPreviewProvider implements vscode.TreeDataProvider<HelmingwayTreeNode> {
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
    } else if (element.type === "alias") {
      const item = new vscode.TreeItem(element.aliasName, vscode.TreeItemCollapsibleState.None);
      const entry = this.renderStore.get(element.chartName, element.aliasName);
      const status = entry?.status ?? "idle";
      const presentation = aliasRenderStatusPresentation[status];
      item.contextValue = "alias";
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

    throw new Error(`Unhandled tree node type: ${JSON.stringify(element)}`);
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

  const content = getRenderedAliasContent(node);
  if (content === undefined) {
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
    preview: false,
    viewColumn: vscode.window.activeTextEditor?.viewColumn,
  });
}

/**
 * Compare the rendered content of the two selected aliases in a diff editor.
 */
async function compareSelectedAliases(): Promise<void> {
  if (selectedAliases.length !== 2) {
    vscode.window.showInformationMessage("Helmingway: Select exactly two aliases to compare.");
    return;
  }

  const [leftAlias, rightAlias] = selectedAliases;
  const leftContent = getRenderedAliasContent(leftAlias);
  if (!leftContent) {
    return;
  }

  const rightContent = getRenderedAliasContent(rightAlias);
  if (!rightContent) {
    return;
  }

  const leftUri = vscode.Uri.from({
    scheme: "helmingway-preview",
    path: `/compare/${leftAlias.chartName}-${leftAlias.aliasName}.yaml`,
  });
  const rightUri = vscode.Uri.from({
    scheme: "helmingway-preview",
    path: `/compare/${rightAlias.chartName}-${rightAlias.aliasName}.yaml`,
  });

  previewDocumentProvider.setContent(leftUri, leftContent);
  previewDocumentProvider.setContent(rightUri, rightContent);

  await vscode.commands.executeCommand(
    "vscode.diff",
    leftUri,
    rightUri,
    `${leftAlias.aliasName} ↔ ${rightAlias.aliasName}`,
  );
}

/**
 * Refresh the preview cache and update the tree view.
 */
async function refreshPreview(provider: HelmingwayPreviewProvider): Promise<void> {
  const workspaceFolder = getPrimaryWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  currentConfig = await readHelmingwayConfig();
  await refreshPreviewInternal({
    provider,
    workspacePath: workspaceFolder.uri.fsPath,
    config: currentConfig,
    cache: previewCache,
  });
}

/**
 * Close only Helmingway preview tabs and leave all other editor tabs untouched.
 */
async function closeAllPreviews(): Promise<void> {
  const previewTabs = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => {
      const input = tab.input;
      return input instanceof vscode.TabInputText && input.uri.scheme === "helmingway-preview";
    });

  if (previewTabs.length === 0) {
    return;
  }

  await vscode.window.tabGroups.close(previewTabs);
}

/**
 * Get the rendered content for the given alias node from the preview cache.
 * If the content is not available, show an information or error message and return undefined.
 */
function getRenderedAliasContent(
  node: Extract<HelmingwayTreeNode, { type: "alias" }>,
): string | undefined {
  const entry = previewCache.get(node.chartName, node.aliasName);
  if (!entry || entry.status === "idle") {
    vscode.window.showInformationMessage(
      `Helmingway: ${node.chartName}/${node.aliasName} is not rendered yet. Run Refresh first.`,
    );
    return undefined;
  }
  if (entry.status === "rendering") {
    vscode.window.showInformationMessage(
      `Helmingway: ${node.chartName}/${node.aliasName} is still rendering.`,
    );
    return undefined;
  }
  if (entry.status === "failed") {
    vscode.window.showErrorMessage(
      `Helmingway: Failed to render ${node.chartName}/${node.aliasName}: ${entry.errorMessage ?? "unknown error"}`,
    );
    return undefined;
  }
  if (entry.content === undefined) {
    vscode.window.showErrorMessage(
      `Helmingway: Preview cache content was not found for ${node.chartName}/${node.aliasName}.`,
    );
    return undefined;
  }

  return entry.content;
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
    vscode.window.showErrorMessage(`Helmingway: Failed to read config file: ${message}`);
    return {};
  }
}
