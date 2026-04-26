/* eslint-disable sort-imports */
import * as vscode from "vscode";
import {
  type HelmingwayTreeNode,
  type ReleaseTreeNode,
  isReleaseNode,
  joinPreviewResourceManifests,
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
  let selectedReleases: ReleaseTreeNode[] = [];

  context.subscriptions.push(
    treeView,
    vscode.workspace.registerTextDocumentContentProvider(
      "helmingway-preview",
      previewDocumentProvider,
    ),
    vscode.commands.registerCommand("helmingway.openReleasePreview", (node) => {
      if (!isReleaseNode(node)) {
        return;
      }

      return openReleasePreview(previewDocumentProvider, helmService, treeDataProvider, node);
    }),
    vscode.commands.registerCommand("helmingway.compareSelectedReleases", () =>
      compareSelectedReleases(previewDocumentProvider, helmService, selectedReleases),
    ),
    vscode.commands.registerCommand("helmingway.rebuildHelmTemplateCache", () =>
      rebuildHelmTemplateCache(treeDataProvider, helmService),
    ),
    vscode.commands.registerCommand("helmingway.closeAllPreviews", closeAllPreviews),

    // Keep the current release-only tree selection so Compare command can use it.
    // VS Code does not pass the full multi-selection to the command handler reliably.
    treeView.onDidChangeSelection((event) => {
      selectedReleases = event.selection.filter(isReleaseNode);
    }),
    // Keep resource checkbox state and open release previews in sync.
    // Checkbox changes update the per-release checked resource set first,
    // then refresh any affected release preview documents.
    treeView.onDidChangeCheckboxState((event) => {
      treeDataProvider.updateResourceCheckboxes(event);
      openReleasePreviewsForCheckboxChanges(
        previewDocumentProvider,
        helmService,
        treeDataProvider,
        event,
      );
    }),
    // Warm the preview cache once, when Helmingway view is first revealed.
    treeView.onDidChangeVisibility(async (event) => {
      if (!event.visible || hasInitializedPreview) {
        return;
      }

      hasInitializedPreview = true;
      await rebuildHelmTemplateCache(treeDataProvider, helmService);
    }),
  );
}

export function deactivate() {}

/**
 * Compare the rendered content of the two selected releases in a diff editor.
 */
async function compareSelectedReleases(
  previewDocumentProvider: HelmingwayPreviewDocumentProvider,
  helmService: HelmService,
  selectedReleases: ReleaseTreeNode[],
): Promise<void> {
  if (selectedReleases.length !== 2) {
    vscode.window.showInformationMessage("Helmingway: Select exactly two releases to compare.");
    return;
  }

  const [leftRelease, rightRelease] = selectedReleases;
  const leftContent = getRenderedReleaseContent(helmService, leftRelease);
  if (!leftContent) {
    return;
  }

  const rightContent = getRenderedReleaseContent(helmService, rightRelease);
  if (!rightContent) {
    return;
  }

  await previewDocumentProvider.showReleaseComparison(
    leftRelease,
    leftContent,
    rightRelease,
    rightContent,
  );
}

/**
 * Rebuild the rendered Helm template cache and update the tree view.
 */
async function rebuildHelmTemplateCache(
  treeDataProvider: HelmingwayTreeDataProvider,
  helmService: HelmService,
): Promise<void> {
  const workspaceFolder = getPrimaryWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  const currentConfig = await treeDataProvider.loadConfig();
  await helmService.rebuildHelmTemplateCache({
    onCacheChanged: () => treeDataProvider.refresh(),
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


/**
 * Open a preview document for the given release node.
 */
async function openReleasePreview(
  previewDocumentProvider: HelmingwayPreviewDocumentProvider,
  helmService: HelmService,
  treeDataProvider: HelmingwayTreeDataProvider,
  node: ReleaseTreeNode,
): Promise<void> {
  const previewContent = getFilteredReleasePreviewContent(helmService, treeDataProvider, node);
  if (previewContent === undefined) {
    return;
  }

  await previewDocumentProvider.showReleasePreview(node, previewContent);
}

/**
 * Reopen previews for releases whose resource checkbox state changed.
 */
function openReleasePreviewsForCheckboxChanges(
  previewDocumentProvider: HelmingwayPreviewDocumentProvider,
  helmService: HelmService,
  treeDataProvider: HelmingwayTreeDataProvider,
  event: vscode.TreeCheckboxChangeEvent<HelmingwayTreeNode>,
): void {
  const releasesToRefresh = new Map<string, ReleaseTreeNode>();

  for (const [node] of event.items) {
    if (node.type !== "resource") {
      continue;
    }

    const key = `${node.chartName}/${node.releaseName}`;

    releasesToRefresh.set(key, {
      type: "release",
      chartName: node.chartName,
      releaseName: node.releaseName,
    });
  }

  for (const releaseNode of releasesToRefresh.values()) {
    void openReleasePreview(previewDocumentProvider, helmService, treeDataProvider, releaseNode);
  }
}

function getFilteredReleasePreviewContent(
  helmService: HelmService,
  treeDataProvider: HelmingwayTreeDataProvider,
  node: ReleaseTreeNode,
): string | undefined {
  const content = getRenderedReleaseContent(helmService, node);
  if (content === undefined) {
    return undefined;
  }

  const checkedResources = treeDataProvider.getCheckedResources(node);
  return joinPreviewResourceManifests(
    checkedResources.map((resourceNode) => resourceNode.resource),
  );
}

/**
 * Get the rendered content for the given release node from the preview cache.
 * If the content is not available, show an information or error message and return undefined.
 */
function getRenderedReleaseContent(
  helmService: HelmService,
  node: ReleaseTreeNode,
): string | undefined {
  const entry = helmService.getHelmTemplateCacheEntry(node.chartName, node.releaseName);
  if (!entry || entry.status === "idle") {
    vscode.window.showInformationMessage(
      `Helmingway: ${node.chartName}/${node.releaseName} is not rendered yet. Run Refresh first.`,
    );
    return undefined;
  }
  if (entry.status === "rendering") {
    vscode.window.showInformationMessage(
      `Helmingway: ${node.chartName}/${node.releaseName} is still rendering.`,
    );
    return undefined;
  }
  if (entry.status === "failed") {
    vscode.window.showErrorMessage(
      `Helmingway: Failed to render ${node.chartName}/${node.releaseName}: ${entry.helmTemplateErrorMessage ?? "unknown error"}`,
    );
    return undefined;
  }
  if (entry.content === undefined) {
    vscode.window.showErrorMessage(
      `Helmingway: Preview cache content was not found for ${node.chartName}/${node.releaseName}.`,
    );
    return undefined;
  }

  return entry.content;
}
