import * as fs from "node:fs/promises";
import * as vscode from "vscode";
import {
  type GitCommitTreeNode,
  getTextFileContentAtRef,
  getWorkspaceRepository,
  resolveReleaseAtRef,
} from "./git/service";
import { type HelmingwayTreeNode, type ReleaseTreeNode, isReleaseNode } from "./models";
import { getPrimaryWorkspaceFolder, getReleaseManifestContent } from "./vscode-helpers";
import { HelmService } from "./helm/service";
import { HelmingwayGitHistoryTreeDataProvider } from "./providers/git-history-tree-data-provider";
import { HelmingwayPreviewDocumentProvider } from "./providers/preview-document-provider";
import { HelmingwayTreeDataProvider } from "./providers/tree-data-provider";
import { runHelmTemplate } from "./helm/template";

export function activate(context: vscode.ExtensionContext) {
  console.log("Helmingway extension is now active.");

  const helmService = new HelmService();
  const previewDocumentProvider = new HelmingwayPreviewDocumentProvider();
  const treeDataProvider = new HelmingwayTreeDataProvider(helmService);
  const gitHistoryTreeDataProvider = new HelmingwayGitHistoryTreeDataProvider();

  const treeView = vscode.window.createTreeView("helmingway.preview", {
    treeDataProvider,
    canSelectMany: true,
  });
  const gitHistoryTreeView = vscode.window.createTreeView("helmingway.history", {
    treeDataProvider: gitHistoryTreeDataProvider,
    canSelectMany: false,
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

      return openReleasePreview(previewDocumentProvider, treeDataProvider, node);
    }),
    vscode.commands.registerCommand("helmingway.toggleReleaseResources", (node) => {
      if (!isReleaseNode(node)) {
        return;
      }

      const didToggle = treeDataProvider.toggleReleaseResources(node);
      if (!didToggle) {
        return;
      }

      return openReleasePreview(previewDocumentProvider, treeDataProvider, node);
    }),
    vscode.commands.registerCommand("helmingway.compareSelectedReleases", () =>
      compareSelectedReleases(previewDocumentProvider, treeDataProvider, selectedReleases),
    ),
    vscode.commands.registerCommand("helmingway.compareSelectedReleaseWithGitCommit", (node) =>
      compareSelectedReleaseWithGitCommit(
        previewDocumentProvider,
        treeDataProvider,
        selectedReleases,
        node as GitCommitTreeNode | undefined,
      ),
    ),
    vscode.commands.registerCommand("helmingway.rebuildHelmTemplateCache", () =>
      rebuildHelmTemplateCache(treeDataProvider, helmService),
    ),
    vscode.commands.registerCommand("helmingway.refreshGitHistory", () =>
      gitHistoryTreeDataProvider.refresh(),
    ),
    vscode.commands.registerCommand("helmingway.closeAllPreviews", closeAllPreviews),

    // Keep the current release-only tree selection so Compare command can use it.
    // VS Code does not pass the full multi-selection to the command handler reliably.
    gitHistoryTreeView,
    treeView.onDidChangeSelection((event) => {
      selectedReleases = event.selection.filter(isReleaseNode);
    }),
    // Keep resource checkbox state and open release previews in sync.
    // Checkbox changes update the per-release checked resource set first,
    // then refresh any affected release preview documents.
    treeView.onDidChangeCheckboxState((event) => {
      treeDataProvider.updateResourceCheckboxes(event);
      openReleasePreviewsForCheckboxChanges(previewDocumentProvider, treeDataProvider, event);
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
  treeDataProvider: HelmingwayTreeDataProvider,
  selectedReleases: ReleaseTreeNode[],
): Promise<void> {
  if (selectedReleases.length !== 2) {
    vscode.window.showInformationMessage("Helmingway: Select exactly two releases to compare.");
    return;
  }

  const [leftRelease, rightRelease] = selectedReleases;
  const leftContent = getReleaseManifestContent(treeDataProvider, leftRelease);
  if (!leftContent) {
    return;
  }

  const rightContent = getReleaseManifestContent(treeDataProvider, rightRelease);
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
 * Compare the currently selected release with the given Git commit.
 */
async function compareSelectedReleaseWithGitCommit(
  previewDocumentProvider: HelmingwayPreviewDocumentProvider,
  treeDataProvider: HelmingwayTreeDataProvider,
  selectedReleases: ReleaseTreeNode[],
  node?: GitCommitTreeNode,
): Promise<void> {
  if (selectedReleases.length !== 1) {
    vscode.window.showInformationMessage(
      "Helmingway: Select exactly one release before comparing with Git history.",
    );
    return;
  }

  if (!node) {
    vscode.window.showInformationMessage("Helmingway: Select a Git commit to compare.");
    return;
  }

  const workspaceFolder = getPrimaryWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  const repository = getWorkspaceRepository(workspaceFolder);
  if (!repository) {
    vscode.window.showInformationMessage("Helmingway: VS Code Git repository was not found.");
    return;
  }

  const release = selectedReleases[0];
  const currentManifest = getReleaseManifestContent(treeDataProvider, release);
  if (!currentManifest) {
    return;
  }

  await openHelmingwayConfigDiff(
    previewDocumentProvider,
    repository,
    workspaceFolder.uri.fsPath,
    node,
  );

  try {
    const historicalRelease = await resolveReleaseAtRef(
      repository,
      node.commit.hash,
      release.chartName,
      release.releaseName,
    );
    if (!historicalRelease) {
      vscode.window.showInformationMessage(
        `Helmingway: ${node.commit.hash.slice(0, 7)} does not contain ${release.chartName}/${release.releaseName}. Manifest comparison was skipped.`,
      );
      return;
    }

    try {
      const previousManifest = await runHelmTemplate({
        workspacePath: historicalRelease.tempWorkspacePath,
        chart: historicalRelease.chart,
        release: historicalRelease.release,
      });
      await previewDocumentProvider.showTextComparison({
        leftPath: `/git/${node.commit.hash.slice(0, 7)}/${release.chartName}-${release.releaseName}.yaml`,
        leftContent: previousManifest,
        rightPath: `/working/${release.chartName}-${release.releaseName}.yaml`,
        rightContent: currentManifest,
        title: `${release.releaseName} @ ${node.commit.hash.slice(0, 7)} ↔ working tree`,
        language: "yaml",
      });
    } finally {
      await historicalRelease.dispose();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(
      `Helmingway: Failed to compare ${release.chartName}/${release.releaseName}: ${message}`,
    );
  }
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
  treeDataProvider: HelmingwayTreeDataProvider,
  node: ReleaseTreeNode,
): Promise<void> {
  const previewContent = getReleaseManifestContent(treeDataProvider, node);
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
    void openReleasePreview(previewDocumentProvider, treeDataProvider, releaseNode);
  }
}

async function openHelmingwayConfigDiff(
  previewDocumentProvider: HelmingwayPreviewDocumentProvider,
  repository: ReturnType<typeof getWorkspaceRepository>,
  workspacePath: string,
  node: GitCommitTreeNode,
): Promise<void> {
  if (!repository) {
    return;
  }

  const [previousConfig, currentConfig] = await Promise.all([
    getTextFileContentAtRef(repository, node.commit.hash, "helmingway.yaml"),
    fs.readFile(`${workspacePath}/helmingway.yaml`, "utf8").catch(() => ""),
  ]);

  await previewDocumentProvider.showTextComparison({
    leftPath: `/git/${node.commit.hash.slice(0, 7)}/helmingway.yaml`,
    leftContent: previousConfig ?? "",
    rightPath: "/working/helmingway.yaml",
    rightContent: currentConfig,
    title: `helmingway.yaml @ ${node.commit.hash.slice(0, 7)} ↔ working tree`,
    language: "yaml",
  });
}
