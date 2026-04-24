/* eslint-disable sort-imports */
import * as vscode from "vscode";
import {
  type AliasTreeNode,
  type HelmingwayTreeNode,
  isAliasNode,
  joinRenderedResourceContent,
} from "./models";
import { HelmService } from "./helm/service";
import { HelmingwayPreviewDocumentProvider } from "./providers/preview-document-provider";
import { HelmingwayTreeDataProvider } from "./providers/tree-data-provider";
import { getPrimaryWorkspaceFolder } from "./vscode-workspace";

export function activate(context: vscode.ExtensionContext) {
  console.log("Helmingway extension is now active.");

  const helmService = new HelmService();
  const previewDocumentProvider = new HelmingwayPreviewDocumentProvider();
  const treeDataProvider = new HelmingwayTreeDataProvider(helmService);

  const treeView = vscode.window.createTreeView("helmingway.preview", {
    treeDataProvider,
    canSelectMany: true,
  });

  let hasInitializedPreview = false;
  let selectedAliases: AliasTreeNode[] = [];

  context.subscriptions.push(
    treeView,
    vscode.workspace.registerTextDocumentContentProvider("helmingway-preview", previewDocumentProvider),
    vscode.commands.registerCommand("helmingway.openAliasPreview", (node) => {
      if (!isAliasNode(node)) {
        return;
      }

      return openAliasPreview(previewDocumentProvider, helmService, treeDataProvider, node);
    }),
    vscode.commands.registerCommand("helmingway.compareSelectedAliases", () =>
      compareSelectedAliases(previewDocumentProvider, helmService, selectedAliases),
    ),
    vscode.commands.registerCommand("helmingway.refreshPreview", () =>
      refreshPreview(treeDataProvider, helmService),
    ),
    vscode.commands.registerCommand("helmingway.closeAllPreviews", closeAllPreviews),

    // Keep the current alias-only tree selection so the Compare command can use it.
    // VS Code does not pass the full multi-selection to the command handler reliably.
    treeView.onDidChangeSelection((event) => {
      selectedAliases = event.selection.filter(isAliasNode);
    }),
    // Keep resource checkbox selection and open alias previews in sync.
    // Checkbox changes update the per-alias selected resource set first,
    // then refresh any affected alias preview documents.
    treeView.onDidChangeCheckboxState((event) => {
      treeDataProvider.updateResourceCheckboxes(event);
      refreshAliasPreviewsForCheckboxChanges(previewDocumentProvider, helmService, treeDataProvider, event);
    }),
    // Warm the preview cache once, when the Helmingway view is first revealed.
    treeView.onDidChangeVisibility(async (event) => {
      if (!event.visible || hasInitializedPreview) {
        return;
      }

      hasInitializedPreview = true;
      await refreshPreview(treeDataProvider, helmService);
    }),
  );
}

export function deactivate() {}

/**
 * Open a preview document for the given alias node.
 */
async function openAliasPreview(
  previewDocumentProvider: HelmingwayPreviewDocumentProvider,
  helmService: HelmService,
  treeDataProvider: HelmingwayTreeDataProvider,
  node: AliasTreeNode,
): Promise<void> {
  const previewContent = getFilteredAliasPreviewContent(helmService, treeDataProvider, node);
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
  helmService: HelmService,
  selectedAliases: AliasTreeNode[],
): Promise<void> {
  if (selectedAliases.length !== 2) {
    vscode.window.showInformationMessage("Helmingway: Select exactly two aliases to compare.");
    return;
  }

  const [leftAlias, rightAlias] = selectedAliases;
  const leftContent = getRenderedAliasContent(helmService, leftAlias);
  if (!leftContent) {
    return;
  }

  const rightContent = getRenderedAliasContent(helmService, rightAlias);
  if (!rightContent) {
    return;
  }

  await previewDocumentProvider.showAliasComparison(leftAlias, leftContent, rightAlias, rightContent);
}

/**
 * Refresh the preview cache and update the tree view.
 */
async function refreshPreview(
  treeDataProvider: HelmingwayTreeDataProvider,
  helmService: HelmService,
): Promise<void> {
  const workspaceFolder = getPrimaryWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  const currentConfig = await treeDataProvider.refreshConfig();
  await helmService.rebuildHelmTemplateCache({
    provider: treeDataProvider,
    workspacePath: workspaceFolder.uri.fsPath,
    config: currentConfig,
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

function refreshAliasPreviewsForCheckboxChanges(
  previewDocumentProvider: HelmingwayPreviewDocumentProvider,
  helmService: HelmService,
  treeDataProvider: HelmingwayTreeDataProvider,
  event: vscode.TreeCheckboxChangeEvent<HelmingwayTreeNode>,
): void {
  const aliasesToRefresh = new Map<string, AliasTreeNode>();

  for (const [node] of event.items) {
    if (node.type !== "resource") {
      continue;
    }

    const key = `${node.chartName}/${node.aliasName}`;

    aliasesToRefresh.set(key, {
      type: "alias",
      chartName: node.chartName,
      aliasName: node.aliasName,
    });
  }

  for (const aliasNode of aliasesToRefresh.values()) {
    void openAliasPreview(previewDocumentProvider, helmService, treeDataProvider, aliasNode);
  }
}

function getFilteredAliasPreviewContent(
  helmService: HelmService,
  treeDataProvider: HelmingwayTreeDataProvider,
  node: AliasTreeNode,
): string | undefined {
  const content = getRenderedAliasContent(helmService, node);
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
  helmService: HelmService,
  node: AliasTreeNode,
): string | undefined {
  const entry = helmService.getHelmTemplateCacheEntry(node.chartName, node.aliasName);
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
      `Helmingway: Failed to render ${node.chartName}/${node.aliasName}: ${entry.helmTemplateErrorMessage ?? "unknown error"}`,
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
