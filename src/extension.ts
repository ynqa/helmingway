import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import type {
  AliasTreeNode,
  HelmingwayConfig,
  HelmingwayTreeNode,
  RawHelmingwayConfig,
  ResourceTreeNode,
} from "./types";
import { joinRenderedResourceContent, parseRenderedResources } from "./rendered-resource";
import { toAliasTreeNodes, toChartTreeNode } from "./tree-node";
import { AliasRenderStore } from "./alias-render-store";
import { aliasRenderStatusPresentation } from "./alias-render-status";
import { getPrimaryWorkspaceFolder } from "./vscode-workspace";
import { parse } from "yaml";
import { parseChartSource } from "./chart-source";
import { refreshPreview as refreshPreviewInternal } from "./preview-refresh";
import { showPreviewDocument } from "./preview-document";

export function activate(context: vscode.ExtensionContext) {
  console.log("Helmingway extension is now active.");

  const previewCache = new AliasRenderStore();
  const previewDocumentProvider = new HelmingwayPreviewDocumentProvider();
  const treeDataProvider = new HelmingwayTreeDataProvider(previewCache);

  const treeView = vscode.window.createTreeView("helmingway.preview", {
    treeDataProvider,
    canSelectMany: true,
  });

  let hasInitializedPreview = false;
  let selectedAliases: Array<Extract<HelmingwayTreeNode, { type: "alias" }>> = [];

  context.subscriptions.push(
    treeView,
    vscode.workspace.registerTextDocumentContentProvider("helmingway-preview", previewDocumentProvider),
    vscode.commands.registerCommand("helmingway.openAliasPreview", (node) =>
      openAliasPreview(previewDocumentProvider, previewCache, treeDataProvider, node),
    ),
    vscode.commands.registerCommand("helmingway.compareSelectedAliases", () =>
      compareSelectedAliases(previewDocumentProvider, previewCache, selectedAliases),
    ),
    vscode.commands.registerCommand("helmingway.refreshPreview", () =>
      refreshPreview(treeDataProvider, previewCache),
    ),
    vscode.commands.registerCommand("helmingway.closeAllPreviews", closeAllPreviews),

    // Keep the current alias-only tree selection so the Compare command can use it.
    // VS Code does not pass the full multi-selection to the command handler reliably.
    treeView.onDidChangeSelection((event) => {
      selectedAliases = event.selection.filter(
        (node): node is Extract<HelmingwayTreeNode, { type: "alias" }> => node.type === "alias",
      );
    }),
    // Keep resource checkbox selection and open alias previews in sync.
    // Checkbox changes update the per-alias selected resource set first,
    // then refresh any affected alias preview documents.
    treeView.onDidChangeCheckboxState((event) => {
      treeDataProvider.updateResourceCheckboxes(event);
      refreshAliasPreviewsForCheckboxChanges(previewDocumentProvider, previewCache, treeDataProvider, event);
    }),
    // Warm the preview cache once, when the Helmingway view is first revealed.
    treeView.onDidChangeVisibility(async (event) => {
      if (!event.visible || hasInitializedPreview) {
        return;
      }

      hasInitializedPreview = true;
      await refreshPreview(treeDataProvider, previewCache);
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
class HelmingwayTreeDataProvider implements vscode.TreeDataProvider<HelmingwayTreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<HelmingwayTreeNode | undefined>();
  private readonly selectedResourceKeysByAlias = new Map<string, Set<string>>();
  private currentConfig: HelmingwayConfig = {};

  constructor(private readonly renderStore: AliasRenderStore) {}

  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  updateResourceCheckboxes(event: vscode.TreeCheckboxChangeEvent<HelmingwayTreeNode>): void {
    for (const [node, state] of event.items) {
      if (node.type !== "resource") {
        continue;
      }

      const aliasKey = toAliasSelectionKey(node);
      const selectedKeys = this.selectedResourceKeysByAlias.get(aliasKey) ?? new Set<string>();
      if (state === vscode.TreeItemCheckboxState.Checked) {
        selectedKeys.add(node.resource.resourceId);
      } else {
        selectedKeys.delete(node.resource.resourceId);
      }

      if (selectedKeys.size === 0) {
        this.selectedResourceKeysByAlias.delete(aliasKey);
      } else {
        this.selectedResourceKeysByAlias.set(aliasKey, selectedKeys);
      }
    }

    this.refresh();
  }

  getSelectedResources(node: AliasTreeNode): ResourceTreeNode[] {
    const selectedKeys = this.selectedResourceKeysByAlias.get(toAliasSelectionKey(node));
    if (!selectedKeys || selectedKeys.size === 0) {
      return [];
    }

    return this.getResourceChildren(node).filter((resourceNode) => selectedKeys.has(resourceNode.resource.resourceId));
  }

  async refreshConfig(): Promise<HelmingwayConfig> {
    this.currentConfig = await readHelmingwayConfig();
    return this.currentConfig;
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
      const resources = this.getResourceChildren(element);
      const collapsibleState =
        resources.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
      const item = new vscode.TreeItem(element.aliasName, collapsibleState);
      const entry = this.renderStore.get(element.chartName, element.aliasName);
      const status = entry?.status ?? "idle";
      const presentation = aliasRenderStatusPresentation[status];
      const selectedCount = this.getSelectedResources(element).length;
      item.contextValue = "alias";
      item.iconPath = presentation.icon;
      item.description = selectedCount > 0 ? `${selectedCount} selected` : presentation.description;
      if (entry?.errorMessage) {
        item.tooltip = entry.errorMessage;
      }
      item.command = {
        command: "helmingway.openAliasPreview",
        title: "Open Preview",
        arguments: [element],
      };
      return item;
    } else if (element.type === "resource") {
      const item = new vscode.TreeItem(element.resource.resourceLabel, vscode.TreeItemCollapsibleState.None);
      item.id = `${element.chartName}/${element.aliasName}/${element.resource.resourceId}`;
      item.contextValue = "resource";
      item.iconPath = new vscode.ThemeIcon("symbol-object");
      item.checkboxState = this.isResourceSelected(element)
        ? vscode.TreeItemCheckboxState.Checked
        : vscode.TreeItemCheckboxState.Unchecked;
      return item;
    }

    throw new Error(`Unhandled tree node type: ${JSON.stringify(element)}`);
  }

  async getChildren(element?: HelmingwayTreeNode): Promise<HelmingwayTreeNode[]> {
    if (!element) {
      const currentConfig = await this.refreshConfig();
      return (currentConfig.helm?.charts ?? []).map(toChartTreeNode);
    }

    if (element.type === "chart") {
      const chart = (this.currentConfig.helm?.charts ?? []).find((chart) => chart.name === element.chartName);
      return chart ? toAliasTreeNodes(chart) : [];
    }

    if (element.type === "alias") {
      return this.getResourceChildren(element);
    }

    return [];
  }

  private getResourceChildren(node: AliasTreeNode): ResourceTreeNode[] {
    const entry = this.renderStore.get(node.chartName, node.aliasName);
    if (entry?.status !== "rendered" || entry.content === undefined) {
      return [];
    }

    return parseRenderedResources(entry.content).map((resource) => ({
      type: "resource",
      chartName: node.chartName,
      aliasName: node.aliasName,
      resource,
    }));
  }

  private isResourceSelected(node: ResourceTreeNode): boolean {
    return this.selectedResourceKeysByAlias.get(toAliasSelectionKey(node))?.has(node.resource.resourceId) ?? false;
  }
}

/**
 * Open a preview document for the given alias node.
 */
async function openAliasPreview(
  previewDocumentProvider: HelmingwayPreviewDocumentProvider,
  previewCache: AliasRenderStore,
  treeDataProvider: HelmingwayTreeDataProvider,
  node: HelmingwayTreeNode,
): Promise<void> {
  if (node.type !== "alias") {
    return;
  }

  const previewContent = getFilteredAliasPreviewContent(previewCache, treeDataProvider, node);
  if (previewContent === undefined) {
    return;
  }

  await showPreviewDocument({
    previewDocumentProvider,
    content: previewContent,
    path: `/${node.aliasName}.yaml`,
  });
}

/**
 * Compare the rendered content of the two selected aliases in a diff editor.
 */
async function compareSelectedAliases(
  previewDocumentProvider: HelmingwayPreviewDocumentProvider,
  previewCache: AliasRenderStore,
  selectedAliases: Array<Extract<HelmingwayTreeNode, { type: "alias" }>>,
): Promise<void> {
  if (selectedAliases.length !== 2) {
    vscode.window.showInformationMessage("Helmingway: Select exactly two aliases to compare.");
    return;
  }

  const [leftAlias, rightAlias] = selectedAliases;
  const leftContent = getRenderedAliasContent(previewCache, leftAlias);
  if (!leftContent) {
    return;
  }

  const rightContent = getRenderedAliasContent(previewCache, rightAlias);
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
async function refreshPreview(
  treeDataProvider: HelmingwayTreeDataProvider,
  previewCache: AliasRenderStore,
): Promise<void> {
  const workspaceFolder = getPrimaryWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  const currentConfig = await treeDataProvider.refreshConfig();
  await refreshPreviewInternal({
    provider: treeDataProvider,
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

function toAliasSelectionKey(node: Pick<AliasTreeNode, "chartName" | "aliasName">): string {
  return `${node.chartName}/${node.aliasName}`;
}

function refreshAliasPreviewsForCheckboxChanges(
  previewDocumentProvider: HelmingwayPreviewDocumentProvider,
  previewCache: AliasRenderStore,
  treeDataProvider: HelmingwayTreeDataProvider,
  event: vscode.TreeCheckboxChangeEvent<HelmingwayTreeNode>,
): void {
  const aliasesToRefresh = new Map<string, AliasTreeNode>();

  for (const [node] of event.items) {
    if (node.type !== "resource") {
      continue;
    }

    aliasesToRefresh.set(toAliasSelectionKey(node), {
      type: "alias",
      chartName: node.chartName,
      aliasName: node.aliasName,
    });
  }

  for (const aliasNode of aliasesToRefresh.values()) {
    const content = getFilteredAliasPreviewContent(previewCache, treeDataProvider, aliasNode);
    if (content === undefined) {
      continue;
    }

    const uri = vscode.Uri.from({
      scheme: "helmingway-preview",
      path: `/${aliasNode.aliasName}.yaml`,
    });
    previewDocumentProvider.setContent(uri, content);
  }
}

function getFilteredAliasPreviewContent(
  previewCache: AliasRenderStore,
  treeDataProvider: HelmingwayTreeDataProvider,
  node: AliasTreeNode,
): string | undefined {
  const content = getRenderedAliasContent(previewCache, node);
  if (content === undefined) {
    return undefined;
  }

  const selectedResources = treeDataProvider.getSelectedResources(node);
  if (selectedResources.length === 0) {
    return content;
  }

  return joinRenderedResourceContent(selectedResources.map((resourceNode) => resourceNode.resource));
}

/**
 * Get the rendered content for the given alias node from the preview cache.
 * If the content is not available, show an information or error message and return undefined.
 */
function getRenderedAliasContent(
  previewCache: AliasRenderStore,
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
