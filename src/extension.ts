import * as vscode from "vscode";
import { type AliasTreeNode, type HelmingwayTreeNode } from "./types";
import { AliasRenderStore } from "./alias-render-store";
import { HelmingwayPreviewDocumentProvider } from "./providers/preview-document-provider";
import { HelmingwayTreeDataProvider } from "./providers/tree-data-provider";
import { getPrimaryWorkspaceFolder } from "./vscode-workspace";
import { joinRenderedResourceContent } from "./rendered-resource";
import { refreshPreview as refreshPreviewInternal } from "./preview-refresh";

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

  await previewDocumentProvider.showAliasPreview(node, previewContent);
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
