import * as path from "node:path";
import * as vscode from "vscode";
import {
  type HelmingwayConfig,
  type HelmingwayTreeNode,
  type ReleaseTreeNode,
  isReleaseNode,
  joinPreviewResourceManifests,
  loadHelmingwayConfig,
} from "./models";
import { getPrimaryWorkspaceFolder, getReleaseManifestContent } from "./utils/vscode";
import { HelmService } from "./helm/service";
import { ManifestDocumentProvider } from "./providers/manifest-document";
import { HelmingwaySyncScheduler } from "./helmingway-sync-scheduler";
import { ReleaseExplorerProvider } from "./providers/release-explorer";
import { resolveWorkspacePath } from "./utils/path";

export function activate(context: vscode.ExtensionContext) {
  console.log("Helmingway extension is now active.");

  const helmService = new HelmService();
  const releaseExplorerProvider = new ReleaseExplorerProvider(helmService);
  const manifestDocumentProvider = new ManifestDocumentProvider((node) =>
    getRenderedReleaseManifestContent(releaseExplorerProvider, node),
  );
  const cacheSyncScheduler = new HelmingwaySyncScheduler(async () => {
    const currentConfig = await syncHelmTemplateCache(releaseExplorerProvider, helmService);
    if (currentConfig) {
      manifestDocumentProvider.refreshOpenReleaseDocuments();
    }
    return currentConfig;
  });

  const releaseExplorerView = vscode.window.createTreeView("helmingway.preview", {
    treeDataProvider: releaseExplorerProvider,
    canSelectMany: true,
  });

  let hasInitializedReleaseExplorer = false;
  let selectedReleases: ReleaseTreeNode[] = [];

  context.subscriptions.push(
    releaseExplorerView,
    cacheSyncScheduler,
    vscode.workspace.registerTextDocumentContentProvider(
      "helmingway-preview",
      manifestDocumentProvider,
    ),
    vscode.commands.registerCommand("helmingway.openReleasePreview", (node) => {
      if (!isReleaseNode(node)) {
        return;
      }

      return openReleaseManifestDocument(manifestDocumentProvider, releaseExplorerProvider, node);
    }),
    vscode.commands.registerCommand("helmingway.openReleaseValueFile", (node) => {
      if (!isReleaseNode(node)) {
        return;
      }

      return openReleaseValueFile(releaseExplorerProvider, node);
    }),
    vscode.commands.registerCommand("helmingway.toggleReleaseResources", (node) => {
      if (!isReleaseNode(node)) {
        return;
      }

      const didToggle = releaseExplorerProvider.toggleReleaseResources(node);
      if (!didToggle) {
        return;
      }

      return openReleaseManifestDocument(manifestDocumentProvider, releaseExplorerProvider, node);
    }),
    vscode.commands.registerCommand("helmingway.compareSelectedReleases", () =>
      compareSelectedReleases(
        manifestDocumentProvider,
        releaseExplorerProvider,
        selectedReleases,
      ),
    ),
    vscode.commands.registerCommand("helmingway.syncHelmTemplateCache", () =>
      cacheSyncScheduler.syncNow(),
    ),
    vscode.commands.registerCommand("helmingway.closeAllPreviews", closeAllManifestDocuments),

    // Keep the current release-only explorer selection so Compare command can use it.
    // VS Code does not pass the full multi-selection to the command handler reliably.
    releaseExplorerView.onDidChangeSelection((event) => {
      selectedReleases = event.selection.filter(isReleaseNode);
    }),
    // Keep resource checkbox state and open manifest documents in sync.
    // Checkbox changes update the per-release checked resource set first,
    // then refresh any affected release manifest documents.
    releaseExplorerView.onDidChangeCheckboxState((event) => {
      releaseExplorerProvider.updateResourceCheckboxes(event);
      reopenManifestDocumentsForCheckboxChanges(
        manifestDocumentProvider,
        releaseExplorerProvider,
        event,
      );
    }),
    // Warm the manifest cache once, when the Release Explorer is first revealed.
    releaseExplorerView.onDidChangeVisibility(async (event) => {
      if (!event.visible || hasInitializedReleaseExplorer) {
        return;
      }

      hasInitializedReleaseExplorer = true;
      await cacheSyncScheduler.syncNow();
    }),
  );
}

export function deactivate() {}

/**
 * Get the rendered manifest content for the given release node, if available.
 */
function getRenderedReleaseManifestContent(
  releaseExplorerProvider: ReleaseExplorerProvider,
  node: ReleaseTreeNode,
): string | undefined {
  const manifestView = releaseExplorerProvider.getReleaseManifestView(node);
  if (manifestView.status !== "rendered") {
    return undefined;
  }

  return joinPreviewResourceManifests(
    manifestView.resources.map((resourceNode) => resourceNode.resource),
  );
}

/**
 * Compare the rendered content of the two selected releases in a diff editor.
 */
async function compareSelectedReleases(
  manifestDocumentProvider: ManifestDocumentProvider,
  releaseExplorerProvider: ReleaseExplorerProvider,
  selectedReleases: ReleaseTreeNode[],
): Promise<void> {
  if (selectedReleases.length !== 2) {
    vscode.window.showInformationMessage("Helmingway: Select exactly two releases to compare.");
    return;
  }

  const [leftRelease, rightRelease] = selectedReleases;
  if (getReleaseManifestContent(releaseExplorerProvider, leftRelease) === undefined) {
    return;
  }

  if (getReleaseManifestContent(releaseExplorerProvider, rightRelease) === undefined) {
    return;
  }

  await manifestDocumentProvider.showReleaseComparison(leftRelease, rightRelease);
}

/**
 * Sync the rendered Helm template cache and update the Release Explorer.
 */
async function syncHelmTemplateCache(
  releaseExplorerProvider: ReleaseExplorerProvider,
  helmService: HelmService,
): Promise<HelmingwayConfig | undefined> {
  const workspaceFolder = getPrimaryWorkspaceFolder();
  if (!workspaceFolder) {
    return undefined;
  }

  const currentConfig = await loadConfig(workspaceFolder);
  if (!currentConfig) {
    return undefined;
  }

  releaseExplorerProvider.setConfig(currentConfig);
  await helmService.syncHelmTemplateCache({
    onCacheChanged: () => releaseExplorerProvider.refresh(),
    workspacePath: workspaceFolder.uri.fsPath,
    config: currentConfig,
  });

  return currentConfig;
}

/**
 * Load helmingway.yaml from the workspace root.
 */
async function loadConfig(
  workspaceFolder: vscode.WorkspaceFolder,
): Promise<HelmingwayConfig | undefined> {
  const configPath = path.join(workspaceFolder.uri.fsPath, "helmingway.yaml");

  try {
    return await loadHelmingwayConfig(configPath);
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT") {
      vscode.window.showErrorMessage("Helmingway: Failed to read config file: file not found");
      return {};
    }

    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Helmingway: Failed to read config file: ${message}`);
    return undefined;
  }
}

/**
 * Close only Helmingway manifest tabs and leave all other editor tabs untouched.
 */
async function closeAllManifestDocuments(): Promise<void> {
  const manifestTabs = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => {
      const input = tab.input;
      return input instanceof vscode.TabInputText && input.uri.scheme === "helmingway-preview";
    });

  if (manifestTabs.length === 0) {
    return;
  }

  await vscode.window.tabGroups.close(manifestTabs);
}

/**
 * Open a manifest document for the given release node.
 */
async function openReleaseManifestDocument(
  manifestDocumentProvider: ManifestDocumentProvider,
  releaseExplorerProvider: ReleaseExplorerProvider,
  node: ReleaseTreeNode,
): Promise<void> {
  if (getReleaseManifestContent(releaseExplorerProvider, node) === undefined) {
    return;
  }

  await manifestDocumentProvider.showReleaseManifest(node);
}

/**
 * Select and open one of the values files configured for the given release.
 */
async function openReleaseValueFile(
  releaseExplorerProvider: ReleaseExplorerProvider,
  node: ReleaseTreeNode,
): Promise<void> {
  const valueFiles = releaseExplorerProvider.getReleaseValueFiles(node);
  if (valueFiles.length === 0) {
    vscode.window.showInformationMessage(
      `Helmingway: ${node.chartName}/${node.releaseName} has no valueFiles.`,
    );
    return;
  }

  const valueFile = await selectReleaseValueFile(node, valueFiles);
  if (!valueFile) {
    return;
  }

  const workspaceFolder = getPrimaryWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  const filePath = resolveWorkspacePath(workspaceFolder.uri.fsPath, valueFile);
  try {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    await vscode.window.showTextDocument(document, { preview: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Helmingway: Failed to open values file: ${message}`);
  }
}

async function selectReleaseValueFile(
  node: ReleaseTreeNode,
  valueFiles: readonly string[],
): Promise<string | undefined> {
  if (valueFiles.length === 1) {
    return valueFiles[0];
  }

  const selected = await vscode.window.showQuickPick(
    valueFiles.map((valueFile) => ({
      label: valueFile,
      valueFile,
    })),
    {
      placeHolder: `Select values file for ${node.chartName}/${node.releaseName}`,
    },
  );

  return selected?.valueFile;
}

/**
 * Reopen manifest documents for releases whose resource checkbox state changed.
 */
function reopenManifestDocumentsForCheckboxChanges(
  manifestDocumentProvider: ManifestDocumentProvider,
  releaseExplorerProvider: ReleaseExplorerProvider,
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
    void openReleaseManifestDocument(manifestDocumentProvider, releaseExplorerProvider, releaseNode);
  }
}
